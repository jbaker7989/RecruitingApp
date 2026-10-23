import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DIR = '/tmp/nfr-003-test-store';
const PORT = 3499;

describe('NFR-003: Auth chicken-and-egg — register/login unreachable', () => {
  let server: ReturnType<typeof spawn>;
  const baseUrl = `http://localhost:${PORT}`;

  before(async () => {
    // Fresh store directory for each run
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    server = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATA_DIR: TEST_DIR,
        JWT_SECRET: 'nfr003-test-secret-must-be-at-least-32-chars-long',
        APPLICANT_JWT_SECRET: 'nfr003-applicant-secret-must-be-32-chars-min',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Wait for server to be ready
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try {
        const res = await fetch(`${baseUrl}/health`);
        ready = res.ok;
      } catch { /* not ready yet */ }
      if (!ready) await sleep(200);
    }
  });

  after(() => {
    server.kill();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('POST /api/auth/register is reachable without a token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nfr003user', password: 'password123', email: 'nfr003@example.com', role: 'hiring-manager' }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${text}`);
    const body = JSON.parse(text);
    assert.ok(body.token, 'Response must include a JWT token');
    assert.ok(body.user?.id, 'Response must include user id');
  });

  it('POST /api/auth/login is reachable without a token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nfr003user', password: 'password123' }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);
    const body = JSON.parse(text);
    assert.ok(body.token, 'Response must include a JWT token on login');
  });

  it('authenticated routes reject requests without a token', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`);
    const text = await res.text();
    assert.equal(res.status, 401, 'Unauthenticated /api/jobs should return 401');
    const body = JSON.parse(text);
    assert.ok(body.error, 'Error response must include error message');
  });

  it('authenticated routes accept requests with a valid Bearer token', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nfr003user', password: 'password123' }),
    });
    const loginText = await loginRes.text();
    assert.equal(loginRes.status, 200, `Login failed: ${loginText}`);
    const { token } = JSON.parse(loginText);

    const res = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    // 200 means reached the route handler (even if empty array); 401 would mean auth blocked
    assert.equal(res.status, 200, `Expected 200 with valid token, got ${res.status}: ${text}`);
  });
});
