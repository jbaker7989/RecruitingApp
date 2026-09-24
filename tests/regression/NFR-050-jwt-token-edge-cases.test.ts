/**
 * NFR-050 Edge Cases — JWT Token Security
 *
 * Extends: tests/regression/NFR-050-jwt-token-production-patterns.test.ts
 *
 * Covers:
 * 1. Expired JWT is rejected with 401                                  (NFR-050-bug1)
 * 2. Tampered signature (same header/payload, corrupted sig) rejected   (NFR-050-bug2)
 * 3. alg:none token is rejected                                        (NFR-050-bug3)
 * 4. Malformed Authorization header variants return 401                 (NFR-050-bug4)
 * 5. Token signed with wrong secret is rejected                         (NFR-050-bug5)
 * 6. Migration edge cases: nonexistent id, non-recruiter roles          (NFR-050-bug6)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';

const TEST_SECRET = 'test-jwt-secret-for-nfr050-testing-only';
const WRONG_SECRET = 'wrong-secret-definitely-not-the-one-in-use';

let dataDir: string;
let server: Server;
let baseUrl: string;
const encoder = new TextEncoder();

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr050e-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [{
      id: 'comp-1', companyName: 'JWT Edge Corp', description: '', location: 'Remote',
      companySize: '1-50', industry: 'Tech',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
    jobs: [], applications: [], users: [], applicants: [], observability: [], drafts: [],
  }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = TEST_SECRET;

  const { app } = await import('../../src/index.js');
  server = app.listen(0);
  baseUrl = `http://localhost:${(server.address() as any).port}`;
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.JWT_SECRET;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function post(path: string, body: object, auth?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string, auth?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  });
  return { status: res.status, body: await res.json() };
}

/** Create a user and return their JWT (signed with TEST_SECRET). */
async function getUserToken(role = 'recruiter', username = 'edge-recruiter') {
  await post('/api/auth/register', {
    username, password: 'password123',
    email: `${username}@test.com`, role, companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username, password: 'password123' });
  return login.body.token as string;
}

/** Forge a JWT manually — bypasses SignJWT's automatic iat/exp, allowing past exp for expiry tests. */
function forgeToken(payload: Record<string, unknown>, secret: string, headerAlg = 'HS256') {
  const headers = { alg: headerAlg, typ: 'JWT' };
  if (headerAlg === 'none') {
    const header = Buffer.from(JSON.stringify(headers)).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.`;
  }
  const headerB64 = Buffer.from(JSON.stringify(headers)).toString('base64url');
  const bodyB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // HS256 signature
  const sigInput = `${headerB64}.${bodyB64}`;
  const sig = createHmac('sha256', secret).update(sigInput).digest();
  const sigB64 = sig.toString('base64url');
  return `${headerB64}.${bodyB64}.${sigB64}`;
}

/** Decode JWT payload without verification (for test inspection only). */
function decodePayload(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
}

// ─── NFR-050-bug1: Expired JWT ────────────────────────────────────────────────

test('NFR-050-edge: expired JWT is rejected with 401', async () => {
  // Get a real user id to forge a token for
  const token = await getUserToken();
  const payload = decodePayload(token);
  // Override exp to 1 hour in the past
  payload.exp = Math.floor(Date.now() / 1000) - 3600;
  payload.iat = Math.floor(Date.now() / 1000) - 7200;

  // forgeToken signs with the test secret — token is structurally valid but expired
  const expired = forgeToken(payload, TEST_SECRET);
  const res = await get('/api/auth/me', expired);

  assert.equal(res.status, 401,
    `Expired JWT must be rejected with 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── NFR-050-bug2: Tampered signature ─────────────────────────────────────────

test('NFR-050-edge: token with corrupted signature (same header+payload) is rejected', async () => {
  const token = await getUserToken();
  const parts = token.split('.');

  // Real header and payload, garbage signature
  const tampered = `${parts[0]}.${parts[1]}.CORRUPTED_SIG_NOT_BASE64URL`;
  const res = await get('/api/auth/me', tampered);

  assert.equal(res.status, 401,
    `Tampered signature must be rejected with 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── NFR-050-bug3: alg:none ────────────────────────────────────────────────────

test('NFR-050-edge: alg:none token is rejected with 401', async () => {
  const token = await getUserToken();
  const payload = decodePayload(token);
  const nonePayload = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };

  const noneToken = forgeToken(nonePayload, TEST_SECRET, 'none');
  const res = await get('/api/auth/me', noneToken);

  assert.equal(res.status, 401,
    `alg:none token must be rejected with 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── NFR-050-bug4: Malformed Authorization headers ─────────────────────────────

test('NFR-050-edge: missing Authorization header returns 401', async () => {
  // No auth header at all
  const res = await get('/api/auth/me');
  assert.equal(res.status, 401,
    `Missing Authorization header must return 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('NFR-050-edge: Authorization header without Bearer prefix returns 401', async () => {
  const token = await getUserToken();
  // Header: "token" instead of "Bearer token"
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: token },
  });
  assert.equal(res.status, 401,
    `Authorization without Bearer prefix must return 401, got ${res.status}`);
});

test('NFR-050-edge: Authorization: Bearer with empty token returns 401', async () => {
  const res = await get('/api/auth/me', '');
  assert.equal(res.status, 401,
    `Empty token must return 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── NFR-050-bug5: Token signed with wrong secret ────────────────────────────

test('NFR-050-edge: token signed with wrong (but valid) secret is rejected', async () => {
  const token = await getUserToken();
  const payload = decodePayload(token);
  // Re-sign with a different secret
  const wrongSigned = forgeToken(payload, WRONG_SECRET);
  const res = await get('/api/auth/me', wrongSigned);

  assert.equal(res.status, 401,
    `Token signed with wrong secret must be rejected with 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

// ─── NFR-050-bug6: Migration — nonexistent opaque token ─────────────────────

test('NFR-050-edge: migration — opaque token for nonexistent user returns 401', async () => {
  const res = await get('/api/auth/me', 'nonexistent-user-id-12345');
  assert.equal(res.status, 401,
    `Opaque token for nonexistent user must return 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('NFR-050-edge: migration — opaque token for nonexistent applicant returns 401', async () => {
  const res = await get('/api/applicants/me', 'nonexistent-applicant-id-67890');
  assert.equal(res.status, 401,
    `Opaque token for nonexistent applicant must return 401, got ${res.status}: ${JSON.stringify(res.body)}`);
});

test('NFR-050-edge: migration — opaque token accepted for hiring-manager role', async () => {
  // Register a hiring-manager user
  await post('/api/auth/register', {
    username: 'edge-hm', password: 'password123',
    email: 'edge-hm@test.com', role: 'hiring-manager', companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'edge-hm', password: 'password123' });
  assert.equal(login.status, 200);

  // The login response for users returns { user: { id: ... }, token: '...' }
  const opaqueId = (login.body as any).user?.id;
  if (!opaqueId) {
    // Fallback: extract user id from the JWT
    const jwtPayload = decodePayload(login.body.token);
    const { readStore } = await import('../../src/models/store.js');
    const store = await readStore();
    const user = store.users.find((u: any) => u.id === jwtPayload.sub);
    assert.ok(user, 'User must exist in store');
    const res = await get('/api/auth/me', user.id);
    assert.equal(res.status, 200,
      `Opaque token for hiring-manager must work during migration, got ${res.status}`);
    return;
  }

  const res = await get('/api/auth/me', opaqueId);
  assert.equal(res.status, 200,
    `Opaque token for hiring-manager must work during migration, got ${res.status}`);
});

test('NFR-050-edge: migration — opaque token accepted for member-services role', async () => {
  await post('/api/auth/register', {
    username: 'edge-ms', password: 'password123',
    email: 'edge-ms@test.com', role: 'member-services', companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'edge-ms', password: 'password123' });
  assert.equal(login.status, 200);
  const jwtPayload = decodePayload(login.body.token);
  const { readStore } = await import('../../src/models/store.js');
  const store = await readStore();
  const user = store.users.find((u: any) => u.id === jwtPayload.sub);
  assert.ok(user, 'User must exist in store');
  const res = await get('/api/auth/me', user.id);
  assert.equal(res.status, 200,
    `Opaque token for member-services must work during migration, got ${res.status}`);
});
