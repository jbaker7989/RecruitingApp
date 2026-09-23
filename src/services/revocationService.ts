/**
 * Revocation Service — in-memory token revocation with TTL-based auto-cleanup.
 *
 * Uses an in-memory Map for storage so no external dependency is required.
 * Redis can replace this implementation in production by swapping the
 * underlying storage adapter (SETEX + EXISTS in Redis give O(1) lookups).
 *
 * Two revocation mechanisms:
 * 1. Per-token revocation via jti (used for logout)
 * 2. Per-user password-changed-at timestamp (used for bulk revocation on password change)
 *
 * Graceful degradation: all operations return false/empty on error rather than
 * throwing, so the auth middleware never blocks requests due to revocation store issues.
 */
import { addObservabilityEntry, generateId, now } from '../models/store.js';

// ─── Storage ─────────────────────────────────────────────────────────────────

interface RevocationEntry {
  expiresAt: number; // Unix ms — auto-cleanup target
}

interface UserRevocationRecord {
  passwordChangedAt: number; // Unix ms — tokens issued before this are invalid
}

// jti → expiry (milliseconds)
const revokedTokens = new Map<string, RevocationEntry>();
// userType:userId → password-changed-at timestamp
const userPasswordChanged = new Map<string, UserRevocationRecord>();
// Periodic cleanup interval handle
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// ─── Core operations ───────────────────────────────────────────────────────────

/**
 * Revoke a specific token by its jti.
 * TTL = (exp * 1000) - now — the entry auto-expires when the token would have expired anyway.
 * No-op if already revoked.
 */
export async function revokeToken(jti: string, expSeconds: number, userId: string, userType: 'User' | 'Applicant'): Promise<void> {
  try {
    const expiresAt = expSeconds * 1000;
    revokedTokens.set(jti, { expiresAt });

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_revoked',
      entityType: userType,
      entityId: userId,
      userId,
      details: { jti, reason: 'logout', expiresAt },
      outcome: 'success',
    });
  } catch {
    // Graceful degradation: logging failure must not break logout
    console.warn('[revocation] Failed to log revocation event');
  }
}

/**
 * Check if a token's jti is revoked.
 * Returns false on any error (graceful degradation).
 */
export async function isRevoked(jti: string): Promise<boolean> {
  try {
    return revokedTokens.has(jti);
  } catch {
    console.warn('[revocation] isRevoked check failed — returning false (graceful degradation)');
    return false;
  }
}

/**
 * Check if a token was issued before the user's last password change.
 * Used for bulk revocation on password change.
 */
export async function isRevokedByPasswordChange(
  userId: string,
  userType: 'User' | 'Applicant',
  tokenIatSeconds: number,
): Promise<boolean> {
  try {
    const key = `${userType}:${userId}`;
    const record = userPasswordChanged.get(key);
    if (!record) return false;
    return tokenIatSeconds * 1000 < record.passwordChangedAt;
  } catch {
    return false;
  }
}

/**
 * Revoke all tokens for a user by recording the current time as passwordChangedAt.
 * Tokens with iat < passwordChangedAt will be rejected by isRevokedByPasswordChange.
 */
export async function revokeAllForUser(
  userId: string,
  userType: 'User' | 'Applicant',
  currentTokenJti?: string,
  currentTokenExp?: number,
): Promise<void> {
  try {
    const key = `${userType}:${userId}`;
    userPasswordChanged.set(key, { passwordChangedAt: Date.now() });

    // Revoke current token by jti as well (belt-and-suspenders)
    if (currentTokenJti && currentTokenExp) {
      await revokeToken(currentTokenJti, currentTokenExp, userId, userType);
    }

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_revoked',
      entityType: userType,
      entityId: userId,
      userId,
      details: { reason: 'password_change', jti: currentTokenJti ?? null },
      outcome: 'success',
    });
  } catch {
    console.warn('[revocation] revokeAllForUser failed');
  }
}

// ─── TTL Cleanup ──────────────────────────────────────────────────────────────

/** Remove expired entries from the revocation map. Call periodically. */
function cleanupExpired() {
  const nowMs = Date.now();
  for (const [jti, entry] of revokedTokens.entries()) {
    if (entry.expiresAt <= nowMs) {
      revokedTokens.delete(jti);
    }
  }
}

/** Start periodic cleanup (every 5 minutes). Safe to call multiple times. */
export function startCleanup(): void {
  if (cleanupInterval !== null) return;
  cleanupInterval = setInterval(cleanupExpired, 5 * 60 * 1000);
}

/** Stop cleanup. Exported for testing. */
export function stopCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/** Reset all state. Exported for testing only. */
export function resetRevocationState(): void {
  revokedTokens.clear();
  userPasswordChanged.clear();
}

// ─── Expose store for auth middleware checks ──────────────────────────────────

/**
 * Combined revocation check: checks both per-token revocation and
 * per-user password-change revocation.
 * Returns the reason string if revoked, or null if ok.
 */
export async function checkRevocation(
  jti: string,
  userId: string,
  userType: 'User' | 'Applicant',
  iatSeconds: number,
): Promise<string | null> {
  if (await isRevoked(jti)) {
    return 'Token has been revoked';
  }
  if (await isRevokedByPasswordChange(userId, userType, iatSeconds)) {
    return 'Token has been revoked';
  }
  return null;
}
