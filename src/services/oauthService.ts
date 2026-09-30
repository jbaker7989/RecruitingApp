/**
 * OAuth 2.0 Service — Google, LinkedIn, and Facebook social login for applicants.
 *
 * Implements the authorization code flow:
 *   1. Initiate  → redirect to IdP authorization endpoint
 *   2. Callback  → exchange code for id_token, extract claims, upsert applicant
 *
 * State parameter (CSRF protection): stored in Redis (if REDIS_URL configured)
 * or in-memory Map with 10-min TTL as fallback.
 */
import { randomBytes } from 'crypto';
import { addObservabilityEntry, generateId, now } from '../models/store.js';
import { readStore, writeStore } from '../models/store.js';
import { signApplicantToken } from './tokenService.js';

// ─── Redis state store (CSRF) ─────────────────────────────────────────────────

let redisClient: unknown = null;
let useRedis = false;

async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      lazyConnect: true,
    });
    await (redisClient as any).connect();
    useRedis = true;
    console.log('[oauth] Redis state store enabled');
  } catch (err) {
    console.warn('[oauth] Redis connection failed, falling back to in-memory:', (err as Error).message);
    useRedis = false;
  }
}

const STATE_TTL_SECONDS = 600; // 10 minutes
const inMemoryStateStore = new Map<string, { createdAt: number; provider: string }>();

async function storeState(state: string, provider: string): Promise<void> {
  if (useRedis && redisClient) {
    await (redisClient as any).setex(`oauth:state:${state}`, STATE_TTL_SECONDS, provider);
  } else {
    inMemoryStateStore.set(state, { createdAt: Date.now(), provider });
  }
}

async function validateState(state: string): Promise<boolean> {
  if (useRedis && redisClient) {
    const result = await (redisClient as any).getdel(`oauth:state:${state}`);
    return result !== null;
  } else {
    const entry = inMemoryStateStore.get(state);
    if (!entry) return false;
    inMemoryStateStore.delete(state);
    return true;
  }
}

function generateState(): string {
  return randomBytes(32).toString('hex');
}

// Initialize Redis on module load (non-blocking)
initRedis();

// Periodic cleanup for in-memory fallback
setInterval(() => {
  const cutoff = Date.now() - STATE_TTL_SECONDS * 1000;
  for (const [key, val] of inMemoryStateStore.entries()) {
    if (val.createdAt < cutoff) inMemoryStateStore.delete(key);
  }
}, 60 * 1000).unref();

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

function facebookConfig(redirectUri: string): OIDCConfig {
  return {
    issuer: 'https://www.facebook.com',
    authorizationURL: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenURL: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoURL: 'https://graph.facebook.com/v18.0/me?fields=id,name,email,first_name,last_name',
    scope: 'email,public_profile',
    grantType: 'authorization_code',
  };
}

// ─── Core flow ────────────────────────────────────────────────────────────────

export interface OAuthUserInfo {
  email: string;
  firstName: string;
  lastName: string;
  provider: 'google' | 'linkedin' | 'facebook';
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
export async function initiateGoogle(baseUrl: string): Promise<InitiateResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/google/callback`;
  const config = googleConfig(redirectUri);
  const state = generateState();
  await storeState(state, 'google');

  return { redirectTo: buildAuthorizationUrl(config, clientId, state, redirectUri) };
}

/** Build the LinkedIn OAuth authorization URL and store state. */
export async function initiateLinkedIn(baseUrl: string): Promise<InitiateResult> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error('LINKEDIN_CLIENT_ID is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/linkedin/callback`;
  const config = linkedinConfig(redirectUri);
  const state = generateState();
  await storeState(state, 'linkedin');

  return { redirectTo: buildAuthorizationUrl(config, clientId, state, redirectUri) };
}

/** Build the Facebook OAuth authorization URL and store state. */
export async function initiateFacebook(baseUrl: string): Promise<InitiateResult> {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) throw new Error('FACEBOOK_CLIENT_ID is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/facebook/callback`;
  const config = facebookConfig(redirectUri);
  const state = generateState();
  await storeState(state, 'facebook');

  return { redirectTo: buildAuthorizationUrl(config, clientId, state, redirectUri) };
}

/** Handle Google OAuth callback: validate state, exchange code, upsert applicant, return JWT. */
export async function handleGoogleCallback(
  code: string,
  state: string,
  baseUrl: string,
): Promise<CallbackResult> {
  if (!await validateState(state)) throw new Error('Invalid or expired OAuth state (CSRF check failed)');

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
  if (!await validateState(state)) throw new Error('Invalid or expired OAuth state (CSRF check failed)');

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

/** Handle Facebook OAuth callback: validate state, exchange code, upsert applicant, return JWT. */
export async function handleFacebookCallback(
  code: string,
  state: string,
  baseUrl: string,
): Promise<CallbackResult> {
  if (!await validateState(state)) throw new Error('Invalid or expired OAuth state (CSRF check failed)');

  const clientId = process.env.FACEBOOK_CLIENT_ID!;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET!;
  if (!clientSecret) throw new Error('FACEBOOK_CLIENT_SECRET is not configured');

  const redirectUri = `${baseUrl}/api/applicants/auth/facebook/callback`;
  const config = facebookConfig(redirectUri);

  // Facebook doesn't return id_token by default; use access token to get user info
  const tokenRes = await fetch(config.tokenURL, {
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

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${err}`);
  }

  const tokenData = await tokenRes.json() as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error('No access_token in Facebook token response');

  const profile = await fetchUserInfo(accessToken, config.userInfoURL);
  const email = (profile['email'] as string | undefined)?.toLowerCase();
  if (!email) throw new Error('Facebook did not return an email address');

  return upsertOAuthApplicant({
    email,
    firstName: (profile['first_name'] as string | undefined) ?? '',
    lastName: (profile['last_name'] as string | undefined) ?? '',
    provider: 'facebook',
    providerId: profile['id'] as string,
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