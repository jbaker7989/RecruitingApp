/**
 * OAuth 2.0 Service — Google and LinkedIn social login for applicants.
 *
 * Implements the authorization code flow:
 *   1. Initiate  → redirect to IdP authorization endpoint
 *   2. Callback  → exchange code for id_token, extract claims, upsert applicant
 *
 * State parameter (CSRF protection): stored in an in-memory Map with 10-min TTL.
 * Production: replace with Redis or signed HttpOnly cookie.
 */
import { randomBytes } from 'crypto';
import { addObservabilityEntry, generateId, now } from '../models/store.js';
import { readStore, writeStore } from '../models/store.js';
import { signApplicantToken } from './tokenService.js';

// ─── IdP configuration ────────────────────────────────────────────────────────

interface OIDCConfig {
  issuer: string;
  authorizationURL: string;
  tokenURL: string;
  userInfoURL: string;
  scope: string;
  grantType: string;
}

function googleConfig(redirectUri: string): OIDCConfig {
  return {
    issuer: 'https://accounts.google.com',
    authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenURL: 'https://oauth2.googleapis.com/token',
    userInfoURL: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    grantType: 'authorization_code',
  };
}

function linkedinConfig(redirectUri: string): OIDCConfig {
  return {
    issuer: 'https://linkedin.com',
    authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoURL: 'https://api.linkedin.com/v2/userinfo',
    scope: 'openid email profile',
    grantType: 'authorization_code',
  };
}

// ─── State store (CSRF) ───────────────────────────────────────────────────────
// ponytail: in-memory Map with TTL. Replace with Redis/session store in prod.

const stateStore = new Map<string, { createdAt: number; provider: string }>();

function cleanExpiredStates() {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
  for (const [key, val] of stateStore) {
    if (val.createdAt < cutoff) stateStore.delete(key);
  }
}

function generateState(): string {
  cleanExpiredStates();
  const state = randomBytes(32).toString('hex');
  // Auto-cleanup after 10 minutes
  const timer = setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);
  timer.unref(); // don't keep process alive
  return state;
}

function validateState(state: string): boolean {
  const entry = stateStore.get(state);
  if (!entry) return false;
  stateStore.delete(state);
  return true;
}

// ─── Core flow ────────────────────────────────────────────────────────────────

export interface OAuthUserInfo {
  email: string;
  firstName: string;
  lastName: string;
  provider: 'google' | 'linkedin';
  providerId: string; // sub claim from IdP
}

function buildAuthorizationUrl(config: OIDCConfig, clientId: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scope,
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${config.authorizationURL}?${params.toString()}`;
}

async function exchangeCodeForTokens(
  config: OIDCConfig,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ idToken: string; accessToken: string | null }> {
  const res = await fetch(config.tokenURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: config.grantType,
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }

  const data = await res.json() as { id_token?: string; access_token?: string };
  if (!data.id_token) throw new Error('No id_token in token response');

  return { idToken: data.id_token, accessToken: data.access_token ?? null };
}

// Decode a base64url JWT payload without verification (for extracting claims only)
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

async function fetchUserInfo(token: string, userInfoUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`UserInfo fetch failed: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface InitiateResult {
  redirectTo: string;
}

export interface CallbackResult {
  token: string;
  expiresIn: number;
  applicantId: string;
  isNewApplicant: boolean;
}

/** Build the Google OAuth authorization URL and store state. */
export function initiateGoogle(baseUrl: string): InitiateResult {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/google/callback`;
  const config = googleConfig(redirectUri);
  const state = generateState();
  stateStore.set(state, { createdAt: Date.now(), provider: 'google' });

  return { redirectTo: buildAuthorizationUrl(config, clientId, state, redirectUri) };
}

/** Build the LinkedIn OAuth authorization URL and store state. */
export function initiateLinkedIn(baseUrl: string): InitiateResult {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error('LINKEDIN_CLIENT_ID is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/linkedin/callback`;
  const config = linkedinConfig(redirectUri);
  const state = generateState();
  stateStore.set(state, { createdAt: Date.now(), provider: 'linkedin' });

  return { redirectTo: buildAuthorizationUrl(config, clientId, state, redirectUri) };
}

/** Handle Google OAuth callback: validate state, exchange code, upsert applicant, return JWT. */
export async function handleGoogleCallback(
  code: string,
  state: string,
  baseUrl: string,
): Promise<CallbackResult> {
  if (!validateState(state)) throw new Error('Invalid or expired OAuth state (CSRF check failed)');

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/google/callback`;
  const config = googleConfig(redirectUri);

  const { idToken } = await exchangeCodeForTokens(config, code, clientId, clientSecret, redirectUri);
  const claims = decodeJwtPayload(idToken);

  const email = (claims['email'] as string | undefined)?.toLowerCase();
  if (!email) throw new Error('Google did not return an email address');

  return upsertOAuthApplicant({
    email,
    firstName: (claims['given_name'] as string | undefined) ?? '',
    lastName: (claims['family_name'] as string | undefined) ?? '',
    provider: 'google',
    providerId: claims['sub'] as string,
  });
}

/** Handle LinkedIn OAuth callback: validate state, exchange code, upsert applicant, return JWT. */
export async function handleLinkedInCallback(
  code: string,
  state: string,
  baseUrl: string,
): Promise<CallbackResult> {
  if (!validateState(state)) throw new Error('Invalid or expired OAuth state (CSRF check failed)');

  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
  if (!clientSecret) throw new Error('LINKEDIN_CLIENT_SECRET is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/linkedin/callback`;
  const config = linkedinConfig(redirectUri);

  // LinkedIn returns id_token with openid scope
  const { idToken, accessToken } = await exchangeCodeForTokens(config, code, clientId, clientSecret, redirectUri);
  const idClaims = decodeJwtPayload(idToken);

  const email = (idClaims['email'] as string | undefined)?.toLowerCase();
  if (!email) throw new Error('LinkedIn did not return an email address');

  // Fetch full profile using access token (optional — fall back to id_token claims)
  let firstName = (idClaims['given_name'] as string | undefined) ?? '';
  let lastName = (idClaims['family_name'] as string | undefined) ?? '';
  if (accessToken) {
    try {
      const profile = await fetchUserInfo(accessToken, config.userInfoURL);
      firstName = (profile['given_name'] as string | undefined) ?? firstName;
      lastName = (profile['family_name'] as string | undefined) ?? lastName;
    } catch {
      // Fall back to id_token claims if userInfo endpoint is unavailable
    }
  }

  return upsertOAuthApplicant({
    email,
    firstName,
    lastName,
    provider: 'linkedin',
    providerId: idClaims['sub'] as string,
  });
}

// ─── Upsert applicant ──────────────────────────────────────────────────────────

/** Find existing applicant by email, or create a new one. */
async function upsertOAuthApplicant(info: OAuthUserInfo): Promise<CallbackResult> {
  const store = await readStore();

  const existingApplicant = store.applicants.find(a => a.email?.toLowerCase() === info.email.toLowerCase());
  const isNewApplicant = !existingApplicant;

  const newApplicant: typeof store.applicants[0] = {
    id: generateId(),
    firstName: info.firstName,
    lastName: info.lastName,
    email: info.email,
    passwordHash: null, // no password — OAuth only
    phone: '',
    preferredContactMethod: 'email' as const,
    address: { state: '', zip: '' },
    educationHistory: [],
    employmentHistory: [],
    rightToWork: false,
    requiresSponsorship: false,
    expectedPay: 0,
    notificationToManager: false,
    hireRecords: [],
    oauthProvider: info.provider,
    oauthProviderId: info.providerId,
    createdAt: now(),
    updatedAt: now(),
  };

  const applicant: typeof store.applicants[0] = existingApplicant ?? newApplicant;

  if (isNewApplicant) {
    store.applicants.push(applicant);
    await writeStore(store);
  } else {
    // Update name if it changed, link OAuth provider if not already linked
    let updated = false;
    if (info.firstName && applicant.firstName !== info.firstName) {
      applicant.firstName = info.firstName;
      updated = true;
    }
    if (info.lastName && applicant.lastName !== info.lastName) {
      applicant.lastName = info.lastName;
      updated = true;
    }
    if (!applicant.oauthProvider) {
      applicant.oauthProvider = info.provider;
      applicant.oauthProviderId = info.providerId;
      updated = true;
    }
    if (updated) {
      applicant.updatedAt = now();
      await writeStore(store);
    }
  }

  // Issue JWT — hasCredentials: false (no password)
  const token = await signApplicantToken(applicant.id, false);

  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'oauth_login',
    entityType: 'Applicant',
    entityId: applicant.id,
    userId: applicant.id,
    details: { provider: info.provider, email: info.email, isNewApplicant },
    outcome: 'success',
  });

  return { token, expiresIn: 604800, applicantId: applicant.id, isNewApplicant };
}
