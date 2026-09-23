/**
 * NFR-052: Applicant Password Reset Flow
 *
 * Story: story-applicant-forgot-password.md
 *
 * Verifies:
 * - POST /api/applicants/forgot-password generates a reset token and returns 200
 * - POST /api/applicants/reset-password with valid token resets the password
 * - Reset token expires after 1 hour (3600 seconds)
 * - Expired or invalid tokens return 401
 * - Reset token is single-use (consumed on use)
 * - Non-existent email returns 200 (security: don't leak email existence)
 * - Password validation enforced (min 8 chars)
 * - Observability events logged
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

// Top-level imports of modules the test will interact with directly.
// These must be imported AFTER process.env.DATA_DIR is set, so we
// defer the server-side module imports to the before() hook instead.
// For readStore/readObservability we read the JSON file directly (no module dependency).

let dataDir: string;
let server: Server;
let baseUrl: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr052-'));
  const storeJson = {
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
  };
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify(storeJson));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-nfr052-testing-only';

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function storePath() { return join(dataDir, 'store.json'); }
function obsPath() { return join(dataDir, 'observability.json'); }

async function readStoreFile() {
  return JSON.parse(readFileSync(storePath(), 'utf-8'));
}

async function writeStoreFile(data: object) {
  writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf-8');
}

async function post(path: string, body: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function login(email: string, password: string) {
  return post('/api/applicants/login', { email, password });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('NFR-052: POST /api/applicants/forgot-password returns 200 even for non-existent email (no enumeration)', async () => {
  const res = await post('/api/applicants/forgot-password', { email: 'does-not-exist@example.com' });
  assert.equal(res.status, 200, `Expected 200 for non-existent email, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.message, 'Response must include a message');
  assert.ok(
    res.body.message.toLowerCase().includes('if') || res.body.message.toLowerCase().includes('email'),
    'Message must not reveal email existence',
  );
});

test('NFR-052: POST /api/applicants/forgot-password generates a valid reset token for existing applicant', async () => {
  await post('/api/applicants/register', {
    email: 'reset-test@example.com',
    password: 'originalpass',
    firstName: 'Reset',
    lastName: 'Test',
    phone: '555-0100',
  });

  const res = await post('/api/applicants/forgot-password', { email: 'reset-test@example.com' });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.message, 'Response must include a message');
  assert.ok(!res.body.token, 'Reset token must NOT be returned in the response body (sent via email in production)');

  // Verify token was persisted in the store file directly
  const store = await readStoreFile();
  const resetEntry = store.passwordResetTokens?.find(
    (t: { email: string }) => t.email.toLowerCase() === 'reset-test@example.com',
  );
  assert.ok(resetEntry, 'A reset token entry must be persisted in the store');
  assert.ok(resetEntry.token, 'Token value must be present');
  assert.ok(resetEntry.expiresAt, 'Token must have an expiresAt timestamp');
});

test('NFR-052: POST /api/applicants/reset-password with valid token resets the password', async () => {
  const email = 'reset-valid@example.com';

  await post('/api/applicants/register', {
    email,
    password: 'oldpassword',
    firstName: 'Reset',
    lastName: 'Valid',
    phone: '555-0101',
  });

  await post('/api/applicants/forgot-password', { email });

  const store = await readStoreFile();
  const resetEntry = store.passwordResetTokens.find(
    (t: { email: string }) => t.email.toLowerCase() === email.toLowerCase(),
  );
  assert.ok(resetEntry, 'A reset token entry must exist in the store');
  assert.equal(resetEntry.usedAt, null, 'Token must not be used yet');
  const token = resetEntry.token;

  const resetRes = await post('/api/applicants/reset-password', {
    token,
    newPassword: 'newsecurepassword123',
  });
  assert.equal(resetRes.status, 200, `Expected 200, got ${resetRes.status}: ${JSON.stringify(resetRes.body)}`);

  // Old password must no longer work
  const oldLogin = await login(email, 'oldpassword');
  assert.equal(oldLogin.status, 401, 'Old password must not work after reset');

  // New password must work
  const newLogin = await login(email, 'newsecurepassword123');
  assert.equal(newLogin.status, 200, `New password must work after reset, got ${newLogin.status}: ${JSON.stringify(newLogin.body)}`);
  assert.ok(newLogin.body.token, 'New login must return a token');
});

test('NFR-052: Reset token expires after 1 hour', async () => {
  const email = 'reset-expires@example.com';

  await post('/api/applicants/register', {
    email,
    password: 'oldpassword',
    firstName: 'Reset',
    lastName: 'Expires',
    phone: '555-0102',
  });

  await post('/api/applicants/forgot-password', { email });

  const store = await readStoreFile();
  const idx = store.passwordResetTokens.findIndex(
    (t: { email: string }) => t.email.toLowerCase() === email.toLowerCase(),
  );
  assert.notEqual(idx, -1, 'Reset token must exist');
  store.passwordResetTokens[idx] = {
    ...store.passwordResetTokens[idx],
    expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
  };
  await writeStoreFile(store);

  const resetRes = await post('/api/applicants/reset-password', {
    token: store.passwordResetTokens[idx].token,
    newPassword: 'newpassword123',
  });
  assert.equal(resetRes.status, 401, 'Expired token must return 401');
  assert.ok(
    resetRes.body.error?.toLowerCase().includes('expired') ||
    resetRes.body.error?.toLowerCase().includes('invalid') ||
    resetRes.body.error?.toLowerCase().includes('token'),
    `Error must mention expiration/invalidity, got: ${resetRes.body.error}`,
  );

  // Old password still works (token was never consumed)
  const loginRes = await login(email, 'oldpassword');
  assert.equal(loginRes.status, 200, 'Old password still works when reset token is expired');
});

test('NFR-052: Reset token is single-use', async () => {
  const email = 'reset-single@example.com';

  await post('/api/applicants/register', {
    email,
    password: 'originalpass',
    firstName: 'Reset',
    lastName: 'Single',
    phone: '555-0103',
  });

  await post('/api/applicants/forgot-password', { email });

  const store = await readStoreFile();
  const resetEntry = store.passwordResetTokens.find(
    (t: { email: string }) => t.email.toLowerCase() === email.toLowerCase(),
  );
  assert.ok(resetEntry, 'Reset token must exist');
  assert.equal(resetEntry.usedAt, null, 'Token must not be used yet');
  const token = resetEntry.token;

  // First use should succeed
  const firstReset = await post('/api/applicants/reset-password', {
    token,
    newPassword: 'firstpassword',
  });
  assert.equal(firstReset.status, 200, `First reset must succeed, got ${firstReset.status}: ${JSON.stringify(firstReset.body)}`);

  // Verify token is now marked as used in the store
  const storeAfter = await readStoreFile();
  const usedEntry = storeAfter.passwordResetTokens.find(
    (t: { token: string }) => t.token === token,
  );
  assert.ok(usedEntry?.usedAt, 'Token must be marked as used after reset');
  assert.notEqual(usedEntry?.usedAt, null, 'Token usedAt must not be null');

  // Second use of the same token must fail (token is consumed)
  const secondReset = await post('/api/applicants/reset-password', {
    token,
    newPassword: 'secondpassword',
  });
  assert.equal(secondReset.status, 401, 'Single-use token must fail on second use');
  assert.ok(
    secondReset.body.error?.toLowerCase().includes('invalid') ||
    secondReset.body.error?.toLowerCase().includes('token') ||
    secondReset.body.error?.toLowerCase().includes('expired') ||
    secondReset.body.error?.toLowerCase().includes('used'),
    `Error must indicate token invalidity, got: ${secondReset.body.error}`,
  );
});

test('NFR-052: Reset password validates minimum 8-character length', async () => {
  const email = 'reset-short@example.com';

  await post('/api/applicants/register', {
    email,
    password: 'originalpass',
    firstName: 'Reset',
    lastName: 'Short',
    phone: '555-0104',
  });

  await post('/api/applicants/forgot-password', { email });

  const store = await readStoreFile();
  const resetEntry = store.passwordResetTokens.find(
    (t: { email: string }) => t.email.toLowerCase() === email.toLowerCase(),
  );

  const res = await post('/api/applicants/reset-password', {
    token: resetEntry.token,
    newPassword: 'short',
  });
  assert.equal(res.status, 400, 'Password shorter than 8 chars must return 400');
  assert.ok(
    res.body.error?.toLowerCase().includes('8') ||
    res.body.error?.toLowerCase().includes('character') ||
    res.body.error?.toLowerCase().includes('length') ||
    res.body.error?.toLowerCase().includes('password'),
    `Error must mention password length, got: ${res.body.error}`,
  );
});

test('NFR-052: Missing token in request body returns 400', async () => {
  const res = await post('/api/applicants/reset-password', { newPassword: 'newpassword123' });
  assert.equal(res.status, 400, 'Missing token must return 400');
});

test('NFR-052: Observability events are logged for password reset flow', async () => {
  const email = 'reset-obs@example.com';

  await post('/api/applicants/register', {
    email,
    password: 'originalpass',
    firstName: 'Reset',
    lastName: 'Obs',
    phone: '555-0105',
  });

  await post('/api/applicants/forgot-password', { email });

  const store = await readStoreFile();
  const resetEntry = store.passwordResetTokens.find(
    (t: { email: string }) => t.email.toLowerCase() === email.toLowerCase(),
  );
  const token = resetEntry!.token;

  await post('/api/applicants/reset-password', { token, newPassword: 'newpassword123' });

  const obs = JSON.parse(readFileSync(obsPath(), 'utf-8'));

  const forgotEntry = obs.logs.find(
    (e: { action: string; entityType: string }) =>
      e.action === 'password_reset_requested' && e.entityType === 'Applicant',
  );
  assert.ok(forgotEntry, 'password_reset_requested observability entry must exist');

  const resetCompleteEntry = obs.logs.find(
    (e: { action: string; entityType: string }) =>
      e.action === 'password_reset_completed' && e.entityType === 'Applicant',
  );
  assert.ok(resetCompleteEntry, 'password_reset_completed observability entry must exist');
  assert.equal(resetCompleteEntry!.outcome, 'success');
});
