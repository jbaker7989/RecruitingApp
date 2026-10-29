/**
 * Token Service — JWT signing and verification for production token patterns.
 *
 * Uses HS256 (HMAC-SHA256) signed JWTs.
 * User tokens: 8-hour expiry (28800s).
 * Applicant tokens: 7-day expiry (604800s).
 */
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { isRevoked } from './revocationService.js';
import { DEV_USER_SECRET, DEV_APPLICANT_SECRET, secretProblem } from '../config/authSecrets.js';

// ─── Startup secret validation ────────────────────────────────────────────────
// Policy lives in config/authSecrets.ts so scripts/preflight.mjs can enforce the
// same rules at build/deploy time (NFR-056).

function validateSecret(envVar: string, devDefault: string): Uint8Array {
  const problem = secretProblem(envVar, devDefault);
  if (problem) throw new Error(problem);
  return new TextEncoder().encode(process.env[envVar]);
}

// In production, require non-default strong secrets.
// In development/test, fall back to dev secrets so local dev still works.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const USER_SECRET = IS_PRODUCTION
  ? validateSecret('JWT_SECRET', DEV_USER_SECRET)
  : new TextEncoder().encode(process.env.JWT_SECRET ?? DEV_USER_SECRET);

const APPLICANT_SECRET = IS_PRODUCTION
  ? validateSecret('APPLICANT_JWT_SECRET', DEV_APPLICANT_SECRET)
  : new TextEncoder().encode(process.env.APPLICANT_JWT_SECRET ?? DEV_APPLICANT_SECRET);

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
 *
 * Fail-closed: a revocation check failure throws (does not log-warn-and-accept).
 */
export async function verifyUserToken(token: string): Promise<UserTokenPayload> {
  const { payload } = await jwtVerify(token, USER_SECRET, { algorithms: ['HS256'] });
  const userPayload = payload as UserTokenPayload;
  // Check revocation before trusting the token — fail-closed if check errors
  if (await isRevoked(userPayload.jti)) {
    throw new Error('Token has been revoked');
  }
  return userPayload;
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws if the token is invalid, expired, malformed, or revoked.
 *
 * Fail-closed: a revocation check failure throws (does not log-warn-and-accept).
 */
export async function verifyApplicantToken(token: string): Promise<ApplicantTokenPayload> {
  const { payload } = await jwtVerify(token, APPLICANT_SECRET, { algorithms: ['HS256'] });
  const appPayload = payload as ApplicantTokenPayload;
  if (await isRevoked(appPayload.jti)) {
    throw new Error('Token has been revoked');
  }
  return appPayload;
}
