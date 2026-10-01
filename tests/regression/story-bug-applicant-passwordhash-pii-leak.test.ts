/**
 * story-bug-applicant-passwordhash-pii-leak
 *
 * `passwordHash` and `oauthProviderId` are credentials/identifiers and must
 * never be returned to clients or accepted from client input.
 *
 * - GET /api/applicants/:id   -> must omit passwordHash, oauthProviderId
 * - GET /api/applicants/me    -> must omit passwordHash, oauthProviderId
 * - PUT /api/applicants/:id   -> must reject passwordHash in body (400), not persist it
 * - POST /api/applicants      -> must ignore attacker-supplied passwordHash
 *
 * RED against current code: GET leaks passwordHash; PUT persists it (200);
 * POST stores a client-supplied hash.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let server: Server;
let baseUrl: string;

const STORED_HASH = 'sha256-original-hash-value';
const APPLICANT_ID = 'app-1';

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'pii-leak-'));
  writeFileSync(
    join(dataDir, 'store.json'),
    JSON.stringify({
      companies: [],
      jobs: [],
      applicants: [
        {
          id: APPLICANT_ID,
          firstName: 'Alice',
          lastName: 'Applicant',
          email: 'alice@test.com',
          passwordHash: STORED_HASH,
          phone: '555-0000',
          preferredContactMethod: 'email',
          address: { state: 'CA', zip: '94102' },
          educationHistory: [],
          employmentHistory: [],
          rightToWork: true,
          requiresSponsorship: false,
          expectedPay: 0,
          notificationToManager: false,
          hireRecords: [],
          oauthProvider: 'google',
          oauthProviderId: 'google-123',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      applications: [],
      users: [],
      hires: [],
      observability: [],
      drafts: [],
    }),
  );
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;

  const { app } = await import('../../src/index.js');
  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.text() };
}
async function put(path: string, body: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function post(path: string, body: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function parse(text: string) {
  return JSON.parse(text) as Record<string, unknown>;
}

// ─── GET /api/applicants/:id must not leak credentials ────────────────────────

test('GET /api/applicants/:id does not expose passwordHash or oauthProviderId', async () => {
  const { status, body } = await get(`/api/applicants/${APPLICANT_ID}`);
  assert.equal(status, 200);
  const json = parse(body);
  assert.equal(json.passwordHash, undefined, 'passwordHash must not be returned');
  assert.equal(json.oauthProviderId, undefined, 'oauthProviderId must not be returned');
  assert.equal(json.firstName, 'Alice');
});

// ─── PUT /api/applicants/:id must reject passwordHash in body ──────────────────

test('PUT /api/applicants/:id rejects passwordHash (400) and does not persist it', async () => {
  const { status } = await put(`/api/applicants/${APPLICANT_ID}`, {
    firstName: 'Alice',
    passwordHash: 'attacker-controlled-hash',
  });
  assert.equal(status, 400, 'PUT with passwordHash must be rejected');

  const raw = readFileSync(join(dataDir, 'store.json'), 'utf-8');
  const record = JSON.parse(raw);
  const applicant = record.applicants[0];
  assert.equal(applicant.passwordHash, STORED_HASH, 'passwordHash must be unchanged');
  assert.equal(applicant.firstName, 'Alice', 'non-credential fields may still update');
});

// ─── GET /api/applicants/me must not leak credentials ─────────────────────────

test('GET /api/applicants/me does not expose passwordHash', async () => {
  const { signApplicantToken } = await import('../../src/services/tokenService.js');
  const token = await signApplicantToken(APPLICANT_ID, true);

  const res = await fetch(`${baseUrl}/api/applicants/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 200);
  assert.equal(json.passwordHash, undefined, 'passwordHash must not be returned on /me');
  assert.equal(json.oauthProviderId, undefined, 'oauthProviderId must not be returned on /me');
});

// ─── POST /api/applicants (legacy create) must ignore attacker passwordHash ──

test('POST /api/applicants ignores client-supplied passwordHash', async () => {
  const { status, body } = await post('/api/applicants', {
    firstName: 'Bob',
    lastName: 'Builder',
    email: 'bob@test.com',
    passwordHash: 'attacker-wants-this-persisted',
    phone: '555-0001',
    address: { state: 'CA', zip: '94102' },
    educationHistory: [{ institution: 'X', degree: 'B', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024' }],
    employmentHistory: [{ company: 'Y', position: 'Dev', startDate: '2024', endDate: '2025' }],
    rightToWork: true,
  });
  assert.equal(status, 201, 'legacy create should succeed');
  assert.notEqual(body.passwordHash, 'attacker-wants-this-persisted', 'attacker passwordHash must not be stored');
});
