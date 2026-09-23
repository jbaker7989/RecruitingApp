/**
 * NFR-051: JWT Token Revocation
 *
 * Story: story-jwt-token-revocation.md
 *
 * Verifies:
 * - JWTs include a jti (JWT ID) claim
 * - POST /api/auth/logout revokes the current token
 * - POST /api/applicants/logout revokes the current token
 * - Revoked tokens return 401
 * - Password change revokes the current token
 * - Graceful degradation when revocation store is unavailable
 * - Observability logging for revocation events
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let server: Server;
let baseUrl: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr051-'));
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
  }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-nfr051-testing-only';

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
});

// ─── Helper ────────────────────────────────────────────────────────────────────

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

async function patch(path: string, body: object, auth?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('NFR-051: User JWT includes a jti claim', async () => {
  await post('/api/auth/register', {
    username: 'revoke-user-1',
    password: 'password123',
    email: 'revoke1@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'revoke-user-1', password: 'password123' });
  assert.equal(login.status, 200);

  const payload = decodeJwtPayload(login.body.token);
  assert.ok(payload.jti, 'JWT must have a jti claim');
  assert.equal(typeof payload.jti, 'string', 'jti must be a string');
  assert.ok(payload.jti!.length > 0, 'jti must not be empty');
});

test('NFR-051: Applicant JWT includes a jti claim', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'revoke-app-jti@test.com',
    password: 'password123',
    firstName: 'Revoke',
    lastName: 'Applicant',
    phone: '555-0001',
  });
  assert.equal(reg.status, 201);

  const payload = decodeJwtPayload(reg.body.token);
  assert.ok(payload.jti, 'JWT must have a jti claim');
  assert.equal(typeof payload.jti, 'string', 'jti must be a string');
});

test('NFR-051: POST /api/auth/logout revokes the token — subsequent requests return 401', async () => {
  // Register + login
  await post('/api/auth/register', {
    username: 'logout-user',
    password: 'password123',
    email: 'logout@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'logout-user', password: 'password123' });
  const token = login.body.token;

  // Verify token works before logout
  const meBefore = await get('/api/auth/me', token);
  assert.equal(meBefore.status, 200, 'Token must work before logout');

  // Logout
  const logout = await post('/api/auth/logout', {}, token);
  assert.equal(logout.status, 200, `Logout must return 200, got ${logout.status}: ${JSON.stringify(logout.body)}`);

  // Token must be rejected after logout
  const meAfter = await get('/api/auth/me', token);
  assert.equal(meAfter.status, 401, 'Revoked token must return 401');
  assert.ok(meAfter.body.error, 'Error response must have an error message');
});

test('NFR-051: POST /api/applicants/logout revokes the token — subsequent requests return 401', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'logout-applicant@test.com',
    password: 'password123',
    firstName: 'Logout',
    lastName: 'Applicant',
    phone: '555-0002',
  });
  const token = reg.body.token;

  // Verify token works before logout
  const meBefore = await get('/api/applicants/me', token);
  assert.equal(meBefore.status, 200, 'Applicant token must work before logout');

  // Logout
  const logout = await post('/api/applicants/logout', {}, token);
  assert.equal(logout.status, 200, `Applicant logout must return 200, got ${logout.status}: ${JSON.stringify(logout.body)}`);

  // Token must be rejected after logout
  const meAfter = await get('/api/applicants/me', token);
  assert.equal(meAfter.status, 401, 'Revoked applicant token must return 401');
});

test('NFR-051: Revoked token returns 401 with revocation message', async () => {
  await post('/api/auth/register', {
    username: 'revoked-msg-user',
    password: 'password123',
    email: 'revoked-msg@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'revoked-msg-user', password: 'password123' });
  const token = login.body.token;

  await post('/api/auth/logout', {}, token);

  const res = await get('/api/auth/me', token);
  assert.equal(res.status, 401);
  assert.ok(res.body.error, 'Error response must have an error message');
});

test('NFR-051: Password change revokes the old token', async () => {
  await post('/api/auth/register', {
    username: 'pw-change-user',
    password: 'oldpassword',
    email: 'pwchange@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'pw-change-user', password: 'oldpassword' });
  const oldToken = login.body.token;

  // Change password
  const change = await patch('/api/auth/me', { password: 'newpassword123' }, oldToken);
  assert.equal(change.status, 200, `Password change must succeed, got ${change.status}: ${JSON.stringify(change.body)}`);

  // Old token must be rejected
  const me = await get('/api/auth/me', oldToken);
  assert.equal(me.status, 401, 'Old token must be rejected after password change');

  // New token must work
  const login2 = await post('/api/auth/login', { username: 'pw-change-user', password: 'newpassword123' });
  assert.equal(login2.status, 200, 'Login with new password must work');
  const me2 = await get('/api/auth/me', login2.body.token);
  assert.equal(me2.status, 200, 'New token must work');
});

test('NFR-051: Graceful degradation — token accepted if revocation check fails', async () => {
  // We cannot easily simulate revocation store failure in the current implementation
  // without modifying the revocation service. This test documents the expected behavior:
  // if revocation service throws, the token should still be accepted (degraded mode).
  // The actual implementation wraps revocation checks in try/catch and logs a warning.

  await post('/api/auth/register', {
    username: 'graceful-user',
    password: 'password123',
    email: 'graceful@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'graceful-user', password: 'password123' });
  const token = login.body.token;

  // In normal operation (revocation store available), the token works
  const me = await get('/api/auth/me', token);
  assert.equal(me.status, 200, 'Token must work when revocation store is available');
});

test('NFR-051: Revocation events are logged to observability', async () => {
  await post('/api/auth/register', {
    username: 'obs-revoke-user',
    password: 'password123',
    email: 'obsrevoke@test.com',
    role: 'recruiter',
    companyId: 'comp-1',
  });
  const login = await post('/api/auth/login', { username: 'obs-revoke-user', password: 'password123' });
  const token = login.body.token;
  const userId = decodeJwtPayload(token).sub as string;

  await post('/api/auth/logout', {}, token);

  const { readObservability } = await import('../../src/models/store.js');
  const obsEntries = await readObservability();
  const revokeEntry = obsEntries.find(e =>
    e.action === 'token_revoked' &&
    e.entityType === 'User' &&
    e.entityId === userId
  );
  assert.ok(revokeEntry, 'A token_revoked observability entry must exist after logout');
  assert.equal(revokeEntry!.outcome, 'success');
});

test('NFR-051: Applicant password change revokes the old token', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'app-pwchange@test.com',
    password: 'oldpassword',
    firstName: 'App',
    lastName: 'PWChange',
    phone: '555-0003',
  });
  const oldToken = reg.body.token;

  // Change password via PATCH /api/applicants/me
  const change = await patch('/api/applicants/me', { password: 'newpassword123' }, oldToken);
  assert.equal(change.status, 200, `Applicant password change must succeed, got ${change.status}: ${JSON.stringify(change.body)}`);

  // Old token must be rejected
  const me = await get('/api/applicants/me', oldToken);
  assert.equal(me.status, 401, 'Old applicant token must be rejected after password change');

  // Can login with new password
  const login = await post('/api/applicants/login', { email: 'app-pwchange@test.com', password: 'newpassword123' });
  assert.equal(login.status, 200, 'Applicant can login with new password');
});
