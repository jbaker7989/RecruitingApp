import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let server: Server;
let baseUrl: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'oauth-dashboard-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [], jobs: [], applications: [], users: [], applicants: [], observability: [], drafts: [], passwordResetTokens: [],
  }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.APPLICANT_JWT_SECRET = 'test-applicant-jwt-secret';
  process.env.NODE_ENV = 'test';
  delete process.env.APP_BASE_URL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
  delete process.env.FACEBOOK_CLIENT_ID;
  delete process.env.FACEBOOK_CLIENT_SECRET;

  const { app } = await import('../../src/index.js');
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://localhost:${(server.address() as any).port}`;
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['DATA_DIR', 'JWT_SECRET', 'APPLICANT_JWT_SECRET', 'APP_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET']) {
    delete process.env[name];
  }
});

async function get(path: string, headers?: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual', headers });
}

function googleIdToken(email = 'oauth.dashboard@example.com') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', sub: 'google-dashboard-user', email,
    given_name: 'OAuth', family_name: 'Dashboard', aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

test('NFR-072: unconfigured providers are hidden and direct browser initiation returns to the login page', async () => {
  const page = await get('/dashboard/login');
  const html = await page.text();
  assert.doesNotMatch(html, /Continue with Google/);
  assert.doesNotMatch(html, /Continue with LinkedIn/);
  assert.doesNotMatch(html, /Continue with Facebook/);

  const initiation = await get('/api/applicants/auth/google');
  assert.equal(initiation.status, 302);
  assert.match(initiation.headers.get('location') ?? '', /^\/dashboard\/login\?error=/);
});

test('NFR-073/074: configured initiation uses the configured public origin, safe next, and provider-specific parameters', async () => {
  process.env.APP_BASE_URL = 'https://careers.example.test';
  process.env.GOOGLE_CLIENT_ID = 'google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.LINKEDIN_CLIENT_ID = 'linkedin-client';
  process.env.LINKEDIN_CLIENT_SECRET = 'linkedin-secret';
  process.env.FACEBOOK_CLIENT_ID = 'facebook-client';
  process.env.FACEBOOK_CLIENT_SECRET = 'facebook-secret';

  const google = await get('/api/applicants/auth/google?next=%2Fdashboard%2Fjobs', { host: 'attacker.example' });
  const googleUrl = new URL(google.headers.get('location')!);
  assert.equal(google.status, 302);
  assert.equal(googleUrl.searchParams.get('redirect_uri'), 'https://careers.example.test/api/applicants/auth/google/callback');
  assert.equal(googleUrl.searchParams.get('access_type'), 'offline');
  assert.equal(googleUrl.searchParams.get('prompt'), 'consent');

  const login = await get('/dashboard/login?next=%2Fdashboard%2Fjobs');
  assert.match(await login.text(), /auth\/google\?next=%2Fdashboard%2Fjobs/);

  const linkedin = await get('/api/applicants/auth/linkedin');
  const linkedinUrl = new URL(linkedin.headers.get('location')!);
  assert.equal(linkedinUrl.searchParams.get('access_type'), null);
  assert.equal(linkedinUrl.searchParams.get('prompt'), null);

  const facebook = await get('/api/applicants/auth/facebook');
  const facebookUrl = new URL(facebook.headers.get('location')!);
  assert.equal(facebookUrl.searchParams.get('access_type'), null);
  assert.equal(facebookUrl.searchParams.get('prompt'), null);
});

test('NFR-074: OAuth state is bound to the issuing provider', async () => {
  const { initiateGoogle, handleLinkedInCallback } = await import('../../src/services/oauthService.js');
  const { redirectTo } = await initiateGoogle('https://careers.example.test');
  const state = new URL(redirectTo).searchParams.get('state')!;
  await assert.rejects(() => handleLinkedInCallback('unused', state, 'https://careers.example.test'), /state|CSRF/i);
});

test('NFR-071/074: a successful browser callback creates a seven-day session and redirects to the state-bound next destination', async () => {
  const start = await get('/api/applicants/auth/google?next=%2Fdashboard%2Fjobs');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      const body = String(init?.body);
      assert.match(body, /redirect_uri=https%3A%2F%2Fcareers.example.test%2Fapi%2Fapplicants%2Fauth%2Fgoogle%2Fcallback/);
      return new Response(JSON.stringify({ id_token: googleIdToken() }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  try {
    const callback = await get(`/api/applicants/auth/google/callback?code=code&state=${state}`);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/dashboard/jobs');
    const cookie = callback.headers.get('set-cookie') ?? '';
    assert.match(cookie, /token=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=604800/);
    assert.equal(await callback.text(), 'Found. Redirecting to /dashboard/jobs');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFR-071/074: unsafe next values and failed callbacks do not create a session or expose JSON errors', async () => {
  const { safeApplicantDestination } = await import('../../src/services/applicantSession.js');
  assert.equal(safeApplicantDestination('https://evil.example'), '/dashboard/applications');
  assert.equal(safeApplicantDestination('//evil.example'), '/dashboard/applications');
  assert.equal(safeApplicantDestination('/api/applicants'), '/dashboard/applications');
  const start = await get('/api/applicants/auth/google?next=https%3A%2F%2Fevil.example');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const denied = await get(`/api/applicants/auth/google/callback?error=access_denied&state=${state}`);
  assert.equal(denied.status, 302);
  assert.match(denied.headers.get('location') ?? '', /^\/dashboard\/login\?error=/);
  assert.equal(denied.headers.get('set-cookie'), null);
  assert.equal((await denied.text()).includes('{"error"'), false);
});
