import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpanKind } from '@opentelemetry/api';
import { createTestTelemetry, getTracer } from '../src/telemetry/index.js';
import { setLogSink } from '../src/telemetry/logger.js';
import { oauthJwksResponse, signOAuthToken } from './helpers/oauthTokens.js';

let telemetry: Awaited<ReturnType<typeof createTestTelemetry>>;
let server: import('node:http').Server;
let base: string;
let directory: string;
let providerCalls = 0;
let fetchBoundary: typeof fetch;
let oauth: typeof import('../src/services/oauthService.js');
const logs: unknown[] = [];

before(async () => {
  // Entire fixture is synthetic and owns its process environment and temp store.
  process.env.NODE_ENV = 'test';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  delete process.env.REDIS_URL;
  delete process.env.OBS_OAUTH_SPAN_LINKS;
  process.env.GOOGLE_CLIENT_ID = 'synthetic-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'synthetic-google-secret';
  process.env.LINKEDIN_CLIENT_ID = 'synthetic-linkedin-client';
  process.env.LINKEDIN_CLIENT_SECRET = 'synthetic-linkedin-secret';
  process.env.FACEBOOK_CLIENT_ID = 'synthetic-facebook-client';
  process.env.FACEBOOK_CLIENT_SECRET = 'synthetic-facebook-secret';
  process.env.APPLICANT_JWT_SECRET = 'synthetic-test-signing-value-93812-only';
  directory = await mkdtemp(join(tmpdir(), 'obs-p1-oauth-'));
  process.env.DATA_DIR = directory;
  await writeFile(join(directory, 'store.json'), JSON.stringify({ companies: [], users: [], jobs: [], applicants: [], applications: [], observability: [], drafts: [], passwordResetTokens: [] }));
  await writeFile(join(directory, 'observability.json'), JSON.stringify({ logs: [] }));
  telemetry = await createTestTelemetry();
  setLogSink(record => { logs.push(record); });
  const { app } = await import('../src/index.js');
  oauth = await import('../src/services/oauthService.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
  fetchBoundary = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls++; throw new Error('Unexpected external call in synthetic test'); };
});
after(async () => {
  globalThis.fetch = fetchBoundary;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  setLogSink(null);
  await telemetry?.shutdown();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    get(base + path, { headers: { Accept: 'application/json' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}
function count(name: string, attrs: Record<string, unknown> = {}) {
  const resources = telemetry.metrics();
  // In-memory exporter may hold multiple cumulative flushes: the last snapshot is current.
  const latest = resources.at(-1);
  return latest?.scopeMetrics.flatMap(scope => scope.metrics).filter(metric => metric.descriptor.name === name).flatMap(metric => metric.dataPoints)
    .filter(point => Object.entries(attrs).every(([key, value]) => point.attributes[key] === value))
    .reduce((total, point) => total + Number(point.value), 0) ?? 0;
}

for (const provider of ['google', 'linkedin', 'facebook']) {
  for (const kind of ['denied', 'missing_code', 'missing_state'] as const) {
    test(`S06: real ${provider} callback ${kind} counts one bounded outcome without calling provider`, async () => {
      await telemetry.flush();
      const totalBefore = count('app.oauth.login.outcomes');
      const outcome = kind === 'denied' ? 'user_cancelled' : 'validation_error';
      const attrs = { 'oauth.provider': provider, 'oauth.outcome': outcome };
      const matchingBefore = count('app.oauth.login.outcomes', attrs);
      const attemptsBefore = count('app.oauth.client.attempts');
      const callsBefore = providerCalls;
      const query = kind === 'denied' ? '?error=access_denied' : kind === 'missing_code' ? '?state=SYNTHETIC_STATE_93812' : '?code=SYNTHETIC_CODE_93812';
      const response = await request(`/api/applicants/auth/${provider}/callback${query}`);
      assert.equal(response.status, 400);
      assert.equal(response.body.error, kind === 'denied' ? `${provider === 'google' ? 'Google' : provider === 'linkedin' ? 'LinkedIn' : 'Facebook'} authorization denied: access_denied` : 'Missing code or state parameter');
      await telemetry.flush();
      assert.equal(count('app.oauth.login.outcomes') - totalBefore, 1);
      assert.equal(count('app.oauth.login.outcomes', attrs) - matchingBefore, 1);
      assert.equal(count('app.oauth.client.attempts'), attemptsBefore);
      assert.equal(providerCalls, callsBefore);
      assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_STATE_93812'));
      assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_CODE_93812'));
    });
  }
}

test('S06: invalid callback state records one failed login and no outbound attempt', async () => {
  await telemetry.flush();
  const before = count('app.oauth.login.outcomes', { 'oauth.outcome': 'invalid_state' });
  const callsBefore = providerCalls;
  const response = await request('/api/applicants/auth/google/callback?code=SYNTHETIC_CODE_93812&state=not-valid-state-93812');
  assert.equal(response.status, 401);
  await telemetry.flush();
  assert.equal(count('app.oauth.login.outcomes', { 'oauth.outcome': 'invalid_state' }) - before, 1);
  assert.equal(providerCalls, callsBefore);
});

test('S06: state issued for another provider records invalid state before token exchange', async () => {
  const state = new URL((await oauth.initiateGoogle(base)).redirectTo).searchParams.get('state');
  assert.ok(state);
  await telemetry.flush();
  const before = count('app.oauth.login.outcomes', { 'oauth.provider': 'linkedin', 'oauth.outcome': 'invalid_state' });
  const attemptsBefore = count('app.oauth.client.attempts');
  const callsBefore = providerCalls;
  const response = await request(`/api/applicants/auth/linkedin/callback?code=SYNTHETIC_CODE_93812&state=${state}`);
  assert.equal(response.status, 401);
  await telemetry.flush();
  assert.equal(count('app.oauth.login.outcomes', { 'oauth.provider': 'linkedin', 'oauth.outcome': 'invalid_state' }) - before, 1);
  assert.equal(count('app.oauth.client.attempts'), attemptsBefore);
  assert.equal(providerCalls, callsBefore);
  assert.ok(!telemetry.payloadJson().includes(state));
});

test('S06: default-off redirect correlation emits no callback span link', async () => {
  assert.equal(process.env.OBS_OAUTH_SPAN_LINKS, undefined);
  const redirect = await getTracer('oauth-fixture').startActiveSpan('GET /api/applicants/auth/linkedin', { kind: SpanKind.SERVER }, async span => {
    try { return await oauth.initiateLinkedIn(base); }
    finally { span.end(); }
  });
  const state = new URL(redirect.redirectTo).searchParams.get('state');
  assert.ok(state);
  const callsBefore = providerCalls;
  await assert.rejects(oauth.handleLinkedInCallback('SYNTHETIC_CODE_93812', state, base));
  await telemetry.flush();
  const callback = telemetry.spans().filter(span => span.name === 'oauth.login.callback').at(-1);
  assert.ok(callback);
  assert.equal(callback.links.length, 0);
  assert.equal(providerCalls, callsBefore + 1, 'the synthetic outbound boundary was exercised');
  assert.ok(!telemetry.payloadJson().includes(state));
});

test('S06: actual LinkedIn callback recovers from userinfo failure with opted-in synthetic correlation', async () => {
  process.env.OBS_OAUTH_SPAN_LINKS = 'true';
  const tracer = getTracer('oauth-fixture');
  let redirectTrace = '';
  let redirectSpan = '';
  let state = '';
  await tracer.startActiveSpan('GET /api/applicants/auth/linkedin', { kind: SpanKind.SERVER }, async span => {
    redirectTrace = span.spanContext().traceId; redirectSpan = span.spanContext().spanId;
    const result = await oauth.initiateLinkedIn(base);
    state = new URL(result.redirectTo).searchParams.get('state')!;
    span.end();
  });
  const now = Math.floor(Date.now() / 1000);
  const idToken = await signOAuthToken({
    iss: 'https://www.linkedin.com/oauth', aud: process.env.LINKEDIN_CLIENT_ID,
    sub: 'synthetic-provider-id', iat: now, exp: now + 3600,
    email: 'synthetic93812@example.invalid', given_name: 'Synthetic', family_name: 'Fixture',
  });
  const originalBoundary = globalThis.fetch;
  let tokenCalls = 0;
  let jwksCalls = 0;
  let userinfoCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://www.linkedin.com/oauth/v2/accessToken') {
      tokenCalls++;
      return Response.json({ id_token: idToken, access_token: 'synthetic-access-token-93812' });
    }
    const jwks = oauthJwksResponse(url);
    if (jwks) { jwksCalls++; return jwks; }
    if (url === 'https://api.linkedin.com/v2/userinfo') {
      userinfoCalls++;
      return new Response('SYNTHETIC_MODEL_OUTPUT_93812', { status: 503 });
    }
    throw new Error('Unexpected URL in synthetic boundary');
  };
  await telemetry.flush();
  const startLogin = count('app.oauth.login.outcomes', { 'oauth.outcome': 'success', 'oauth.recovered': true });
  const startAttempts = count('app.oauth.client.attempts');
  try {
    const response = await request(`/api/applicants/auth/linkedin/callback?code=SYNTHETIC_CODE_93812&state=${state}`);
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.token, 'string');
    assert.equal(tokenCalls, 1);
    assert.equal(jwksCalls, 1);
    assert.equal(userinfoCalls, 1);
    await telemetry.flush();
    assert.equal(count('app.oauth.client.attempts') - startAttempts, 2);
    assert.equal(count('app.oauth.login.outcomes', { 'oauth.outcome': 'success', 'oauth.recovered': true }) - startLogin, 1);
    const callback = telemetry.spans().filter(span => span.name === 'oauth.login.callback').at(-1)!;
    assert.ok(callback); assert.notEqual(callback.spanContext().traceId, redirectTrace);
    assert.ok(callback.links.some(link => link.context.traceId === redirectTrace && link.context.spanId === redirectSpan));
    const children = telemetry.spans().filter(span => span.parentSpanContext?.spanId === callback.spanContext().spanId);
    const oauthChildren = children.filter(span => span.name.startsWith('oauth.'));
    assert.deepEqual(new Set(oauthChildren.map(span => span.name)), new Set(['oauth.token_exchange', 'oauth.userinfo']));
    assert.equal(oauthChildren.length, 2, 'OAuth provider attempts remain exactly one token exchange and one userinfo call');
    assert.ok(children.some(span => span.name === 'store.read'), 'the callback also parents its instrumented store read');
    for (const marker of [state, 'SYNTHETIC_CODE_93812', 'synthetic-access-token-93812', 'SYNTHETIC_MODEL_OUTPUT_93812', 'synthetic93812@example.invalid']) assert.ok(!telemetry.payloadJson().includes(marker), marker);
    assert.ok(!JSON.stringify(logs).includes('SYNTHETIC_MODEL_OUTPUT_93812'));
  } finally { globalThis.fetch = originalBoundary; delete process.env.OBS_OAUTH_SPAN_LINKS; }
});

test('S09: actual application liveness and readiness preserve public contracts without provider calls', async () => {
  const before = providerCalls;
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  const readiness = await request('/ready');
  assert.equal(readiness.status, 200);
  assert.ok(['ready', 'degraded'].includes(String(readiness.body.status)));
  assert.equal(providerCalls, before);
  assert.ok(!JSON.stringify(readiness.body).includes('synthetic-google-secret'));
  assert.ok(!JSON.stringify(readiness.body).includes(directory));
});
