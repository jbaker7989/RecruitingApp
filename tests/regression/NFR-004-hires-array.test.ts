/**
 * NFR-004: data/store.json is missing the `hires` array — runtime crashes on hire flows
 *
 * Bug evidence (BUGS.md):
 *   - GET /api/applicants/:id        → 500 "Cannot read properties of undefined (reading 'filter')"
 *   - PUT /api/applications/:id/status (accepted) → 500 "Cannot read properties of undefined (reading 'push')"
 * Root cause: readStore() returns the parsed file verbatim with no defaulting
 * for keys missing from older/on-disk store files.
 *
 * Isolation: uses a temp DATA_DIR so committed data files are never touched.
 * NOTE: process.env.DATA_DIR must be set BEFORE importing src modules
 * (store.ts resolves the data directory at module load time).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let store: typeof import('../../src/models/store.js');
let server: Server;
let baseUrl: string;

const ADMIN = { id: 'u-admin', username: 'admin', passwordHash: 'encrypted_pw', role: 'member-services', email: 'a@b.com', createdAt: '2026-09-11T00:00:00.000Z', oauthProvider: null };
const AUTH = { Authorization: 'Bearer u-admin', 'Content-Type': 'application/json' };

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr004-'));
  // Fixture mirrors the committed data/store.json: every key EXCEPT `hires`
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [], jobs: [], applicants: [], applications: [],
    users: [ADMIN], observability: [],
  }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;

  store = await import('../../src/models/store.js');
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

test('NFR-004 (unit): readStore defaults missing keys — hires and all collections exist', async () => {
  const s = await store.readStore();
  assert.ok(Array.isArray(s.hires), 'readStore must return hires as an array even when absent from the file');
  assert.deepEqual(s.hires, []);
  for (const key of ['companies', 'jobs', 'applicants', 'applications', 'users', 'observability'] as const) {
    assert.ok(Array.isArray(s[key]), `${key} must be an array`);
  }
});

test('NFR-004 (integration): GET /api/applicants/:id returns 200, not 500, with legacy store file', async () => {
  const created = await fetch(`${baseUrl}/api/applicants`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '5551234',
      address: { state: 'NY', zip: '10001' },
      educationHistory: [{ institution: 'MIT', degree: 'BS', fieldOfStudy: 'CS', startDate: '2015', endDate: '2019' }],
      employmentHistory: [{ company: 'X', position: 'Dev', startDate: '2019-01-01', endDate: '2024-01-01' }],
      rightToWork: true,
    }),
  });
  assert.equal(created.status, 201);
  const applicant = await created.json() as any;

  const res = await fetch(`${baseUrl}/api/applicants/${applicant.id}`, { headers: AUTH });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.clone().text()}`);
  const body = await res.json() as any;
  assert.equal(body.id, applicant.id);
  assert.ok(Array.isArray(body.hires), 'response must include hires array');
});

test('NFR-004 (integration): accepting an application creates a hire record instead of crashing', async () => {
  // Company + job
  const companyRes = await fetch(`${baseUrl}/api/companies`, { method: 'POST', headers: AUTH, body: JSON.stringify({ companyName: 'Acme' }) });
  assert.equal(companyRes.status, 201);
  const company = await companyRes.json() as any;

  const jobRes = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ jobTitle: 'Engineer', companyId: company.id, positionDescription: 'Build', requiredSkills: ['typescript'], totalOpenings: 5 }),
  });
  assert.equal(jobRes.status, 201);
  const job = await jobRes.json() as any;

  // Applicant
  const appRes = await fetch(`${baseUrl}/api/applicants`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      firstName: 'John', lastName: 'Roe', email: 'john@x.com', phone: '5559999',
      address: { state: 'CA', zip: '90001' },
      educationHistory: [{ institution: 'UCLA', degree: 'BS', fieldOfStudy: 'EE', startDate: '2014', endDate: '2018' }],
      employmentHistory: [{ company: 'Y', position: 'typescript dev', startDate: '2018-01-01', endDate: '2023-01-01' }],
      rightToWork: true,
      // passwordHash is SHA-256 of 'password123' so we can log in for an applicant JWT.
      // POST /api/applications injects req.user.id as applicantId (NFR-048 auth guard);
      // a member-services token (req.user.id='u-admin') would produce applicantId='u-admin'
      // which no applicant record satisfies.
      passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
    }),
  });
  assert.equal(appRes.status, 201);
  const applicant = await appRes.json() as any;

  // Login as the applicant to obtain a JWT for POST /api/applications
  const loginRes = await fetch(`${baseUrl}/api/applicants/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'john@x.com', password: 'password123' }),
  });
  assert.equal(loginRes.status, 200, `applicant login failed: ${await loginRes.clone().text()}`);
  const { token: applicantToken } = await loginRes.json() as { token: string };
  const APPLICANT_AUTH = { Authorization: `Bearer ${applicantToken}`, 'Content-Type': 'application/json' };

  const applyRes = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST', headers: APPLICANT_AUTH,
    body: JSON.stringify({
      applicantId: applicant.id, jobPostingId: job.id,
      firstName: 'John', lastName: 'Roe', email: 'john@x.com', emailConfirmation: 'john@x.com', phone: '5559999',
      address: { state: 'CA', zip: '90001' },
      educationHistory: [{ institution: 'UCLA', degree: 'BS', fieldOfStudy: 'EE', startDate: '2014', endDate: '2018' }],
      employmentHistory: [{ company: 'Y', position: 'typescript dev', startDate: '2018-01-01', endDate: '2023-01-01' }],
      rightToWork: true,
    }),
  });
  assert.equal(applyRes.status, 201, `POST /api/applications failed: ${await applyRes.clone().text()}`);
  const application = await applyRes.json() as any;

  // The operation that crashed pre-fix with: Cannot read properties of undefined (reading 'push')
  const acceptRes = await fetch(`${baseUrl}/api/applications/${application.id}/status`, {
    method: 'PUT', headers: AUTH, body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(acceptRes.status, 200, `expected 200, got ${acceptRes.status}: ${await acceptRes.clone().text()}`);

  // Hire record persisted and linked to the applicant
  const s = await store.readStore();
  assert.equal(s.hires.length, 1, 'exactly one hire record must exist');
  assert.equal(s.hires[0].applicantId, applicant.id);
  assert.equal(s.hires[0].jobPostingId, job.id);
  assert.equal(s.hires[0].companyId, company.id);
  assert.equal(s.hires[0].status, 'active');

  const profile = await (await fetch(`${baseUrl}/api/applicants/${applicant.id}`, { headers: AUTH })).json() as any;
  assert.deepEqual(profile.hireRecords, [s.hires[0].id]);
  assert.equal(profile.hires.length, 1);
});
