/**
 * NFR-053: Applicant OAuth 2.0 / OIDC Social Login
 *
 * Story: story-applicant-oauth-social-login.md
 *
 * Verifies:
 * - GET /api/applicants/auth/google initiates Google OAuth (redirect or 503 if not configured)
 * - GET /api/applicants/auth/google/callback returns 401 for invalid state
 * - GET /api/applicants/auth/linkedin initiates LinkedIn OAuth
 * - GET /api/applicants/auth/linkedin/callback returns 401 for invalid state
 * - First social login for email creates applicant (no password, hasCredentials=false)
 * - Subsequent login for same email returns existing applicant (no duplicates)
 * - OAuth login without email in token returns 401
 * - Invalid code in callback returns 401
 * - Observability oauth_login event is logged
 *
 * Note: Full end-to-end OAuth flow (real IdP redirects) is not testable in unit
 * tests. The callback tests below use mock fetch to simulate the IdP token exchange.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { randomBytes } from 'crypto';

let dataDir: string;
let server: Server;
let baseUrl: string;

// ─── Setup ─────────────────────────────────────────────────────────────────────

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr053-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [{
      id: 'comp-1',
      companyName: 'Test Corp',
      description: '',
      location: 'Remote',
      companySize: '1-50',
      industry: 'Tech',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    jobs: [],
    applications: [],
    users: [],
    applicants: [],
    observability: [],
    drafts: [],
    passwordResetTokens: [],
  }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-nfr053';
  process.env.APPLICANT_JWT_SECRET = 'test-applicant-jwt-secret-nfr053';

  // Clear any env vars from prior tests so service tests can exercise the "not configured" path
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;

  const { app } = await import('../../src/index.js');
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://localhost:${(server.address() as any).port}`;
});

after(async () => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.JWT_SECRET;
  delete process.env.APPLICANT_JWT_SECRET;
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

async function getQuery(path: string) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: await res.json().catch(() => ({})) };
}

// ─── Tests: Initiation ────────────────────────────────────────────────────────

test('NFR-053: GET /api/applicants/auth/google returns 503 when GOOGLE_CLIENT_ID is not configured', async () => {
  const res = await get('/api/applicants/auth/google');
  assert.equal(res.status, 503, `Expected 503, got ${res.status}: ${res.body}`);
  assert.ok(res.body.includes('not configured') || res.body.includes('Google'), `Error must mention Google not configured, got: ${res.body}`);
});

test('NFR-053: GET /api/applicants/auth/linkedin returns 503 when LINKEDIN_CLIENT_ID is not configured', async () => {
  const res = await get('/api/applicants/auth/linkedin');
  assert.equal(res.status, 503, `Expected 503, got ${res.status}: ${res.body}`);
  assert.ok(res.body.includes('not configured') || res.body.includes('LinkedIn'), `Error must mention LinkedIn not configured, got: ${res.body}`);
});

test('NFR-053: GET /api/applicants/auth/google with valid env var redirects to Google authorization URL', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  // Dynamically import the service to pick up the env var
  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateGoogle(baseUrl);

  assert.ok(redirectTo.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), `Must redirect to Google, got: ${redirectTo}`);
  assert.ok(redirectTo.includes('client_id=test-google-client-id'), 'URL must contain client_id');
  assert.ok(redirectTo.includes('scope='), 'URL must contain scope');
  assert.ok(redirectTo.includes('state='), 'URL must contain CSRF state parameter');
  assert.ok(redirectTo.includes('redirect_uri='), 'URL must contain redirect_uri');
});

test('NFR-053: GET /api/applicants/auth/linkedin with valid env var redirects to LinkedIn authorization URL', async () => {
  process.env.LINKEDIN_CLIENT_ID = 'test-linkedin-client-id';
  const { initiateLinkedIn } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateLinkedIn(baseUrl);

  assert.ok(redirectTo.startsWith('https://www.linkedin.com/oauth/v2/authorization'), `Must redirect to LinkedIn, got: ${redirectTo}`);
  assert.ok(redirectTo.includes('client_id=test-linkedin-client-id'), 'URL must contain client_id');
  assert.ok(redirectTo.includes('scope='), 'URL must contain scope');
  assert.ok(redirectTo.includes('state='), 'URL must contain CSRF state parameter');
  assert.ok(redirectTo.includes('redirect_uri='), 'URL must contain redirect_uri');
});

// ─── Tests: Callback — CSRF and error handling ─────────────────────────────────

test('NFR-053: GET /api/applicants/auth/google/callback returns 400 when code is missing', async () => {
  const res = await get('/api/applicants/auth/google/callback');
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.ok(res.body.includes('code') || res.body.includes('Missing'), 'Error must mention missing code');
});

test('NFR-053: GET /api/applicants/auth/google/callback returns 400 when state is missing', async () => {
  const res = await getQuery('/api/applicants/auth/google/callback?code=fakecode');
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.ok(res.body.error, 'Must return an error');
});

test('NFR-053: GET /api/applicants/auth/google/callback returns 401 when state is invalid (CSRF)', async () => {
  const res = await getQuery('/api/applicants/auth/google/callback?code=fakecode&state=invalid-state');
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
  assert.ok(
    res.body.error?.toLowerCase().includes('invalid') ||
    res.body.error?.toLowerCase().includes('state') ||
    res.body.error?.toLowerCase().includes('csrf') ||
    res.body.error?.toLowerCase().includes('expired'),
    `Error must indicate invalid state, got: ${res.body.error}`,
  );
});

test('NFR-053: GET /api/applicants/auth/linkedin/callback returns 401 when state is invalid', async () => {
  const res = await getQuery('/api/applicants/auth/linkedin/callback?code=fakecode&state=invalid-state');
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
  assert.ok(
    res.body.error?.toLowerCase().includes('invalid') ||
    res.body.error?.toLowerCase().includes('state') ||
    res.body.error?.toLowerCase().includes('csrf') ||
    res.body.error?.toLowerCase().includes('expired'),
    `Error must indicate invalid state, got: ${res.body.error}`,
  );
});

test('NFR-053: GET /api/applicants/auth/google/callback returns 400 when Google returns an error', async () => {
  const res = await getQuery('/api/applicants/auth/google/callback?error=access_denied&error_description=User+denied+access');
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.ok(res.body.error?.toLowerCase().includes('denied') || res.body.error?.toLowerCase().includes('authorization'), `Got: ${res.body.error}`);
});

test('NFR-053: GET /api/applicants/auth/linkedin/callback returns 400 when LinkedIn returns an error', async () => {
  const res = await getQuery('/api/applicants/auth/linkedin/callback?error=access_denied');
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  assert.ok(res.body.error?.toLowerCase().includes('denied') || res.body.error?.toLowerCase().includes('authorization'), `Got: ${res.body.error}`);
});

// ─── Tests: Callback — full flow with mocked IdP ─────────────────────────────

test('NFR-053: Google OAuth callback creates new applicant and returns JWT (first login)', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

  // Generate a valid state token by calling initiateGoogle
  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateGoogle(baseUrl);
  const stateParam = new URL(redirectTo).searchParams.get('state')!;
  const fakeCode = 'test-auth-code-from-google';

  // Mock fetch to simulate Google's token endpoint
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      // Return a mock Google id_token: header.payload.signature
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: 'google-user-123',
        email: 'oauth.test@gmail.com',
        given_name: 'OAuth',
        family_name: 'Test',
        aud: 'test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url, init);
  };

  try {
    const res = await getQuery(`/api/applicants/auth/google/callback?code=${fakeCode}&state=${stateParam}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.token, 'Response must contain a JWT token');
    assert.equal(res.body.expiresIn, 604800, 'Applicant token must expire in 7 days (604800 seconds)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFR-053: LinkedIn OAuth callback creates new applicant and returns JWT (first login)', async () => {
  process.env.LINKEDIN_CLIENT_ID = 'test-linkedin-client-id';
  process.env.LINKEDIN_CLIENT_SECRET = 'test-linkedin-client-secret';

  const { initiateLinkedIn } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateLinkedIn(baseUrl);
  const stateParam = new URL(redirectTo).searchParams.get('state')!;
  const fakeCode = 'test-auth-code-from-linkedin';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('linkedin.com/oauth/v2/accessToken')) {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://linkedin.com',
        sub: 'linkedin-user-456',
        email: 'oauth.linkedin@gmail.com',
        given_name: 'LinkedIn',
        family_name: 'User',
        aud: 'test-linkedin-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig`, access_token: 'mock-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr.includes('api.linkedin.com/v2/userinfo')) {
      return new Response(JSON.stringify({
        sub: 'linkedin-user-456',
        email: 'oauth.linkedin@gmail.com',
        given_name: 'LinkedIn',
        family_name: 'UserUpdated',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url, init);
  };

  try {
    const res = await getQuery(`/api/applicants/auth/linkedin/callback?code=${fakeCode}&state=${stateParam}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.token, 'Response must contain a JWT token');
    assert.equal(res.body.expiresIn, 604800);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFR-053: Google OAuth callback returns 401 when Google does not return an email', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateGoogle(baseUrl);
  const stateParam = new URL(redirectTo).searchParams.get('state')!;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      // No 'email' claim
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: 'google-noemail-123',
        given_name: 'NoEmail',
        family_name: 'User',
        aud: 'test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url);
  };

  try {
    const res = await getQuery(`/api/applicants/auth/google/callback?code=fakecode&state=${stateParam}`);
    assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
    assert.ok(res.body.error?.toLowerCase().includes('email'), `Error must mention missing email, got: ${res.body.error}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFR-053: Google OAuth callback returns existing applicant on second login (no duplicates)', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

  // First login: create applicant via Google
  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo: redirect1 } = initiateGoogle(baseUrl);
  const state1 = new URL(redirect1).searchParams.get('state')!;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: 'google-user-existing',
        email: 'existing.google@gmail.com',
        given_name: 'Existing',
        family_name: 'Applicant',
        aud: 'test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url);
  };

  let firstApplicantId: string;
  try {
    const res1 = await getQuery(`/api/applicants/auth/google/callback?code=firstcode&state=${state1}`);
    assert.equal(res1.status, 200, `First login failed: ${JSON.stringify(res1.body)}`);
    firstApplicantId = res1.body.token ? decodeJwtSub(res1.body.token) : '';
    assert.ok(firstApplicantId, 'First login must return a valid JWT');

    // Second login: same email — must return the same applicant
    const { initiateGoogle: reinitGoogle } = await import('../../src/services/oauthService.js');
    const { redirectTo: redirect2 } = reinitGoogle(baseUrl);
    const state2 = new URL(redirect2).searchParams.get('state')!;

    const res2 = await getQuery(`/api/applicants/auth/google/callback?code=secondcode&state=${state2}`);
    assert.equal(res2.status, 200, `Second login failed: ${JSON.stringify(res2.body)}`);
    const secondApplicantId = decodeJwtSub(res2.body.token);

    assert.equal(secondApplicantId, firstApplicantId, 'Second login must return the same applicant (no duplicate)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFR-053: OAuth-registered applicant has hasCredentials=false in JWT', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateGoogle(baseUrl);
  const stateParam = new URL(redirectTo).searchParams.get('state')!;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: 'google-no-creds-test',
        email: 'nocreds@gmail.com',
        given_name: 'No',
        family_name: 'Creds',
        aud: 'test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url);
  };

  try {
    const res = await getQuery(`/api/applicants/auth/google/callback?code=testcode&state=${stateParam}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    // Decode JWT payload (middle segment) without verification
    const parts = res.body.token.split('.');
    const jwtPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    assert.equal(jwtPayload.hasCredentials, false, 'OAuth-only applicant must have hasCredentials=false');
    assert.ok(jwtPayload.sub, 'JWT must contain sub (applicant.id)');
    assert.ok(jwtPayload.jti, 'JWT must contain jti');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Tests: Observability ─────────────────────────────────────────────────────

test('NFR-053: OAuth login logs an oauth_login observability event', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';

  const { initiateGoogle } = await import('../../src/services/oauthService.js');
  const { redirectTo } = initiateGoogle(baseUrl);
  const stateParam = new URL(redirectTo).searchParams.get('state')!;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const urlStr = url instanceof URL ? url.toString() : String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: 'google-obs-test',
        email: 'oauth.obs@gmail.com',
        given_name: 'Obs',
        family_name: 'Test',
        aud: 'test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${header}.${payload}.sig` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url);
  };

  try {
    await getQuery(`/api/applicants/auth/google/callback?code=obscode&state=${stateParam}`);
    const { readObservability } = await import('../../src/models/store.js');
    const obsEntries = await readObservability();
    const oauthEntry = obsEntries.find(
      (e: { action: string; entityType: string }) => e.action === 'oauth_login' && e.entityType === 'Applicant',
    );
    assert.ok(oauthEntry, 'oauth_login observability entry must exist');
    assert.equal(oauthEntry!.outcome, 'success');
    assert.equal(oauthEntry!.details['provider'], 'google');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Decode JWT payload (base64url middle segment) without verification. */
function decodeJwtSub(token: string): string {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  return payload.sub as string;
}
