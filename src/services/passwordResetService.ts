/**
 * Password Reset Service — generates and validates one-time reset tokens.
 *
 * Reset token format: crypto-random hex (64 chars) — unguessable, no JWT overhead.
 * TTL: 1 hour (3600 seconds) — balances convenience with security window.
 * Single-use: `usedAt` timestamp marks token consumed after first successful reset.
 */
import { randomBytes } from 'crypto';
import { updateStore, generateId, now, type DataStore } from '../models/store.js';

const RESET_TOKEN_TTL_SECONDS = 3600; // 1 hour

/** Generate a new reset token for an applicant and persist it. */
export async function createResetToken(applicantId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString('hex'); // 64-char hex string
  const entry = {
    id: generateId(),
    applicantId,
    email: email.toLowerCase(),
    token,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000).toISOString(),
    usedAt: null,
    createdAt: now(),
  };
  await updateStore((store) => { store.passwordResetTokens.push(entry); });
  return token;
}

type ConsumeResult = { valid: true; applicantId: string } | { valid: false; reason: string };

/** Validate and mark a token used inside the given store snapshot (caller owns the transaction). */
function consumeInStore(store: DataStore, token: string): ConsumeResult {
  const index = store.passwordResetTokens.findIndex(t => t.token === token);
  if (index === -1) return { valid: false, reason: 'Invalid reset token' };
  const entry = store.passwordResetTokens[index];
  if (entry.usedAt !== null) return { valid: false, reason: 'Reset token has already been used' };
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return { valid: false, reason: 'Reset token has expired' };
  store.passwordResetTokens[index] = { ...entry, usedAt: now() };
  return { valid: true, applicantId: entry.applicantId };
}

/**
 * @deprecated Consumes the token without changing the password; a later failure burns the token.
 * Use resetPasswordWithToken, which does both atomically.
 */
export async function validateAndConsumeResetToken(token: string): Promise<ConsumeResult> {
  return updateStore((store) => consumeInStore(store, token));
}

export type ResetPasswordResult =
  | { ok: true; applicantId: string }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' | 'no_applicant' };

/**
 * Atomically consume a reset token AND set the applicant's password hash. If the applicant is gone
 * nothing is persisted (token stays unused). Hash with bcrypt before calling; no hashing happens
 * inside the transaction.
 */
export async function resetPasswordWithToken(token: string, newPasswordHash: string): Promise<ResetPasswordResult> {
  return updateStore((store): ResetPasswordResult => {
    const entry = store.passwordResetTokens.find(t => t.token === token);
    if (!entry) return { ok: false, reason: 'invalid' };
    if (entry.usedAt !== null) return { ok: false, reason: 'used' };
    if (new Date(entry.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    const applicant = store.applicants.find(a => a.id === entry.applicantId);
    if (!applicant) return { ok: false, reason: 'no_applicant' };
    const ts = now();
    entry.usedAt = ts;
    applicant.passwordHash = newPasswordHash;
    applicant.updatedAt = ts;
    return { ok: true, applicantId: applicant.id };
  });
}
