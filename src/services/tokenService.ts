/**
 * Token Service — JWT signing and verification for production token patterns.
 *
 * Uses HS256 (HMAC-SHA256) signed JWTs.
 * User tokens: 8-hour expiry (28800s).
 * Applicant tokens: 7-day expiry (604800s).
 *
 * Migration path: verifyToken() accepts both new JWTs and legacy opaque tokens
 * (raw user.id / applicant.id) until all clients migrate.
 */
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { readStore } from '../models/store.js';
import { isRevoked } from './revocationService.js';

// Use separate secrets per audience so a leaked applicant secret doesn't
// allow User token forgery (defense in depth).
const USER_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-user-jwt-secret-change-in-production',
);
const APPLICANT_SECRET = new TextEncoder().encode(
  process.env.APPLICANT_JWT_SECRET ?? 'dev-applicant-jwt-secret-change-in-production',
);

// ─── Signing ─────────────────────────────────────────────────────────────────

export interface UserTokenPayload extends JWTPayload {
  sub: string;
  role: string;
  companyId?: string;
  jti: string;
}

export interface ApplicantTokenPayload extends JWTPayload {
  sub: string;
  hasCredentials: boolean;
  jti: string;
}

/** Sign a JWT for an authenticated User (recruiter, hiring-manager, etc.). */
export async function signUserToken(
  userId: string,
  role: string,
  companyId?: string,
): Promise<string> {
  const jti = randomUUID();
  const payload: UserTokenPayload = {
    sub: userId,
    role,
    ...(companyId ? { companyId } : {}),
    jti,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .setJti(jti)
    .sign(USER_SECRET);
}

/** Sign a JWT for an authenticated Applicant. */
export async function signApplicantToken(
  applicantId: string,
  hasCredentials: boolean,
): Promise<string> {
  const jti = randomUUID();
  const payload: ApplicantTokenPayload = {
    sub: applicantId,
    hasCredentials,
    jti,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .setJti(jti)
    .sign(APPLICANT_SECRET);
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a JWT and return its decoded payload.
 * Throws if the token is invalid, expired, malformed, or revoked.
 */
export async function verifyUserToken(token: string): Promise<UserTokenPayload> {
  const { payload } = await jwtVerify(token, USER_SECRET, { algorithms: ['HS256'] });
  const userPayload = payload as UserTokenPayload;
  // Check revocation before trusting the token
  try {
    if (await isRevoked(userPayload.jti)) {
      throw new Error('Token has been revoked');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Token has been revoked') throw err;
    // Graceful degradation: revocation check failed, accept token but log warning
    console.warn('[revocation] Graceful degradation — could not check revocation, accepting token:', msg);
  }
  return userPayload;
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws if the token is invalid, expired, malformed, or revoked.
 */
export async function verifyApplicantToken(token: string): Promise<ApplicantTokenPayload> {
  const { payload } = await jwtVerify(token, APPLICANT_SECRET, { algorithms: ['HS256'] });
  const appPayload = payload as ApplicantTokenPayload;
  // Check revocation before trusting the token
  try {
    if (await isRevoked(appPayload.jti)) {
      throw new Error('Token has been revoked');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Token has been revoked') throw err;
    // Graceful degradation: revocation check failed, accept token but log warning
    console.warn('[revocation] Graceful degradation — could not check revocation, accepting token:', msg);
  }
  return appPayload;
}

/** Returns true if `token` looks like a JWT (three base64url segments). */
export function isJwt(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Verify any token — tries JWT first, falls back to legacy opaque ID.
 * Returns { type: 'user', id } or { type: 'applicant', id } or throws.
 *
 * Migration path: during the dual-acceptance window, both JWTs and old
 * opaque tokens (raw user.id / applicant.id) are accepted.
 */
export async function verifyAnyToken(token: string): Promise<{
  type: 'user' | 'applicant';
  id: string;
  // Raw JWT payload when verified as JWT (for logging/debugging); absent for opaque tokens
  jwtPayload?: UserTokenPayload | ApplicantTokenPayload;
}> {
  if (isJwt(token)) {
    // Try User JWT first
    try {
      const payload = await verifyUserToken(token);
      return { type: 'user', id: payload.sub, jwtPayload: payload };
    } catch {
      // Not a User JWT — try Applicant JWT
    }
    try {
      const payload = await verifyApplicantToken(token);
      return { type: 'applicant', id: payload.sub, jwtPayload: payload };
    } catch {
      // Valid JWT format but signature/alg mismatch — reject outright
      throw new Error('Invalid token');
    }
  }

  // Legacy opaque token — look up in store
  const store = await readStore();
  const user = store.users.find(u => u.id === token);
  if (user) {
    return { type: 'user', id: user.id };
  }
  const applicant = store.applicants.find(a => a.id === token && a.email !== null);
  if (applicant) {
    return { type: 'applicant', id: applicant.id };
  }
  throw new Error('Invalid token');
}
