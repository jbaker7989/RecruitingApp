import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { JWTPayload } from 'jose';
import { oauthJwksResponse, signOAuthToken } from '../helpers/oauthTokens.js';

let dataDir: string;
let server: Server;
let baseUrl: string;
let idToken: string;
let jwksUnavailable = false;
let facebookDenied = false;
let facebookMissingSubject = false;
let facebookProfileCalls = 0;
let userInfoSubject = 'provider-user';
const jwksCalls = new Map<string, number>();
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const providers = ['google', 'linkedin'] as const;
type Provider = typeof providers[number];

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr076-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({ companies: [], jobs: [], applications: [], users: [], applicants: [], drafts: [], passwordResetTokens: [] }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  Object.assign(process.env, {
    DATA_DIR: dataDir, NODE_ENV: 'test', JWT_SECRET: 'nfr076-user-secret', APPLICANT_JWT_SECRET: 'nfr076-applicant-secret',
    GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
    LINKEDIN_CLIENT_ID: 'linkedin-client', LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
    FACEBOOK_CLIENT_ID: 'facebook-client', FACEBOOK_CLIENT_SECRET: 'facebook-secret',
  });
  delete process.env.REDIS_URL;
  delete process.env.APP_BASE_URL;
  const { app } = await import('../../src/index.js');
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(baseUrl + '/')) return originalFetch(input, init);
    const jwks = oauthJwksResponse(url);
    if (jwks) {
      jwksCalls.set(url, (jwksCalls.get(url) ?? 0) + 1);
      return jwksUnavailable ? new Response('unavailable', { status: 503 }) : jwks;
    }
    if (url === 'https://oauth2.googleapis.com/token' || url === 'https://www.linkedin.com/oauth/v2/accessToken') {
      return Response.json({ id_token: idToken, access_token: 'provider-access-token' });
    }
    if (url === 'https://api.linkedin.com/v2/userinfo') {
      return Response.json({ sub: userInfoSubject, given_name: 'Profile', family_name: 'Name' });
    }
    if (url === 'https://graph.facebook.com/v18.0/oauth/access_token') {
      return Response.json({ access_token: 'facebook-access-token' });
    }
    if (url.startsWith('https://graph.facebook.com/v18.0/me?')) {
      facebookProfileCalls++;
      assert.equal(new URL(url).searchParams.get('appsecret_proof'), createHmac('sha256', 'facebook-secret').update('facebook-access-token').digest('hex'));
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer facebook-access-token');
      return facebookDenied ? new Response('secret provider diagnostic', { status: 400 }) : Response.json({
        id: facebookMissingSubject ? undefined : 'facebook-user', email: 'facebook@example.test', first_name: 'Facebook', last_name: 'User',
      });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});

function claims(provider: Provider): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return { iss: provider === 'google' ? 'https://accounts.google.com' : 'https://www.linkedin.com/oauth',
    aud: `${provider}-client`, sub: 'provider-user', iat: now, exp: now + 3600,
    email: `${provider}@example.test`, given_name: 'Signed', family_name: 'Claims' };
}

async function callback(provider: string, json = false) {
  const start = await fetch(`${baseUrl}/api/applicants/auth/${provider}?next=%2Fdashboard%2Fjobs`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state');
  return fetch(`${baseUrl}/api/applicants/auth/${provider}/callback?code=test-code&state=${state}`, {
    redirect: 'manual', headers: json ? { Accept: 'application/json' } : {},
  });
}

async function assertRejected(provider: string, json = false) {
  const storeBefore = readFileSync(join(dataDir, 'store.json'), 'utf8');
  const logsBefore = readFileSync(join(dataDir, 'observability.json'), 'utf8');
  const response = await callback(provider, json);
  assert.equal(response.headers.get('set-cookie'), null);
  if (json) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'OAuth identity verification failed' });
  } else {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboard/login?error=OAuth%20identity%20verification%20failed');
  }
  assert.equal(readFileSync(join(dataDir, 'store.json'), 'utf8'), storeBefore, 'rejection must not create or modify an applicant');
  assert.equal(readFileSync(join(dataDir, 'observability.json'), 'utf8'), logsBefore, 'rejection must not record successful login');
}

for (const provider of providers) {
  test(`NFR-076: ${provider} fails closed when JWKS is unavailable`, async () => {
    idToken = await signOAuthToken(claims(provider));
    jwksUnavailable = true;
    try { await assertRejected(provider); } finally { jwksUnavailable = false; }
  });

  test(`NFR-076: ${provider} signed token creates browser session and reuses cached JWKS`, async () => {
    idToken = await signOAuthToken(claims(provider));
    const response = await callback(provider);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/dashboard/jobs');
    assert.match(response.headers.get('set-cookie') ?? '', /token=.+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800/);
    if (provider === 'linkedin') {
      const store = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'));
      assert.equal(store.applicants.find((a: { email: string }) => a.email === 'linkedin@example.test').firstName, 'Profile');
    }
    const calls = [...jwksCalls.values()].reduce((a, b) => a + b, 0);
    const second = await callback(provider, true);
    assert.equal(second.status, 200);
    assert.equal(typeof (await second.json() as { token: string }).token, 'string');
    assert.equal([...jwksCalls.values()].reduce((a, b) => a + b, 0), calls);
  });

  const invalidClaims: [string, (payload: JWTPayload) => void][] = [
    ['wrong audience', p => { p.aud = 'another-client'; }],
    ['wrong issuer', p => { p.iss = 'https://attacker.example'; }],
    ['expired', p => { p.iat = Number(p.iat) - 7200; p.exp = Number(p.iat) + 3600; }],
    ['future issued-at', p => { p.iat = Number(p.iat) + 300; }],
    ['missing expiration', p => { delete p.exp; }],
    ['missing issued-at', p => { delete p.iat; }],
    ['missing subject', p => { delete p.sub; }],
    ['empty subject', p => { p.sub = ''; }],
    ['non-string subject', p => { p.sub = 123 as unknown as string; }],
    ['wrong authorized party', p => { p.azp = 'other-client'; }],
    ['multiple audiences without authorized party', p => { p.aud = [`${provider}-client`, 'other-client']; }],
    ['expiration before issue', p => { p.exp = Number(p.iat) - 1; }],
  ];
  for (const [name, mutate] of invalidClaims) {
    test(`NFR-076: ${provider} rejects ${name} before account mutation`, async () => {
      const payload = claims(provider);
      mutate(payload);
      idToken = await signOAuthToken(payload);
      await assertRejected(provider);
    });
  }
  test(`NFR-076: ${provider} rejects wrong signature in JSON flow`, async () => {
    idToken = await signOAuthToken(claims(provider), { wrongKey: true });
    await assertRejected(provider, true);
  });
  test(`NFR-076: ${provider} rejects unknown key and unsigned tokens`, async () => {
    idToken = await signOAuthToken(claims(provider), { kid: 'unknown-key' });
    await assertRejected(provider);
    idToken = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims(provider))).toString('base64url')}.`;
    await assertRejected(provider);
  });
  test(`NFR-076: ${provider} accepts small clock skew and matching authorized party`, async () => {
    const payload = claims(provider);
    payload.iat = Number(payload.iat) + 10;
    payload.aud = [`${provider}-client`, 'other-client'];
    payload.azp = `${provider}-client`;
    idToken = await signOAuthToken(payload);
    assert.equal((await callback(provider, true)).status, 200);
  });
}

test('NFR-076: published legacy issuer variants remain supported', async () => {
  for (const provider of providers) {
    const payload = claims(provider);
    payload.iss = provider === 'google' ? 'accounts.google.com' : 'https://www.linkedin.com';
    idToken = await signOAuthToken(payload);
    assert.equal((await callback(provider, true)).status, 200);
  }
});

test('NFR-076: LinkedIn ignores UserInfo with a different subject', async () => {
  idToken = await signOAuthToken(claims('linkedin'));
  userInfoSubject = 'different-user';
  try {
    assert.equal((await callback('linkedin', true)).status, 200);
    const store = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf8'));
    assert.equal(store.applicants.find((a: { email: string }) => a.email === 'linkedin@example.test').firstName, 'Signed');
  } finally { userInfoSubject = 'provider-user'; }
});

test('NFR-076: Facebook authenticates the profile call with appsecret_proof', async () => {
  const beforeCalls = facebookProfileCalls;
  const response = await callback('facebook');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/dashboard/jobs');
  assert.match(response.headers.get('set-cookie') ?? '', /token=/);
  assert.equal(facebookProfileCalls, beforeCalls + 1);
});

test('NFR-076: Facebook rejects denied proof/token and missing subject without mutation', async () => {
  facebookDenied = true;
  try { await assertRejected('facebook'); } finally { facebookDenied = false; }
  facebookMissingSubject = true;
  try { await assertRejected('facebook', true); } finally { facebookMissingSubject = false; }
});
