/**
 * Password Reset Service — generates and validates one-time reset tokens.
 *
 * Reset token format: crypto-random hex (64 chars) — unguessable, no JWT overhead.
 * TTL: 1 hour (3600 seconds) — balances convenience with security window.
 * Single-use: `usedAt` timestamp marks token consumed after first successful reset.
 */
import { randomBytes } from 'crypto';
import { readStore, writeStore, generateId, now } from '../models/store.js';

const RESET_TOKEN_TTL_SECONDS = 3600; // 1 hour

/** Generate a new reset token for an applicant and persist it. */
export async function createResetToken(applicantId: string, email: string): Promise<string> {
  const store = await readStore();
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
  store.passwordResetTokens.push(entry);
  await writeStore(store);
  return token;
}

/** Validate AND consume a reset token in a single atomic read-modify-write. */
export async function validateAndConsumeResetToken(
  token: string,
): Promise<{ valid: true; applicantId: string } | { valid: false; reason: string }> {
  const store = await readStore();
  const index = store.passwordResetTokens.findIndex(t => t.token === token);

  if (index === -1) {
    return { valid: false, reason: 'Invalid reset token' };
  }
  const entry = store.passwordResetTokens[index];

  if (entry.usedAt !== null) {
    return { valid: false, reason: 'Reset token has already been used' };
  }
  if (new Date(entry.expiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: 'Reset token has expired' };
  }

  // Mark consumed and persist in the same write
  store.passwordResetTokens[index] = { ...entry, usedAt: now() };
  await writeStore(store);

  return { valid: true, applicantId: entry.applicantId };
}
