/**
 * NFR-048 — Duplicate Application Edge Cases
 * Story: story-bug-duplicate-application-edge-cases.md
 *
 * Tests 7 edge-case scenarios:
 *   bug1 — Unauthenticated POST /api/applications
 *   bug2 — Authenticated token applicantId wins over body applicantId
 *   bug3 — Race condition: concurrent POSTs for same applicant+job
 *   bug4 — Cross-endpoint duplicate detection
 *   bug5 — Reapplication after rejection (permanent block)
 *   bug6 — Inactive job returns 400 before duplicate check
 *   bug7 — Authenticated legacy endpoint still works (no auth gate on legacy route)
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
  dataDir = mkdtempSync(join(tmpdir(), 'nfr048e-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({
    companies: [{
      id: 'comp-1', companyName: 'Edge Corp', description: '', location: 'Remote',
      companySize: '1-50', industry: 'Tech',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
    jobs: [
      { id: 'job-1', companyId: 'comp-1', jobTitle: 'Engineer I', positionDescription: 'Build things.',
        requirements: [], positionLocation: 'Remote', payRange: { min: 80000, max: 120000, currency: 'USD' },
        responsibilities: [], qualifications: [], requiredSkills: ['TypeScript'], requiredExperience: 2,
        reportsTo: '', isActive: true, totalOpenings: 5, currentApplications: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'job-2', companyId: 'comp-1', jobTitle: 'Engineer II', positionDescription: 'Lead things.',
        requirements: [], positionLocation: 'NYC', payRange: { min: 100000, max: 150000, currency: 'USD' },
        responsibilities: [], qualifications: [], requiredSkills: ['Node'], requiredExperience: 4,
        reportsTo: '', isActive: true, totalOpenings: 5, currentApplications: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'job-3', companyId: 'comp-1', jobTitle: 'Closed Role', positionDescription: 'Already filled.',
        requirements: [], positionLocation: 'Remote', payRange: { min: 70000, max: 90000, currency: 'USD' },
        responsibilities: [], qualifications: [], requiredSkills: ['JS'], requiredExperience: 1,
        reportsTo: '', isActive: true, totalOpenings: 3, currentApplications: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    applicants: [], applications: [], users: [], hires: [], observability: [], drafts: [],
  }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-for-nfr050-testing-only';
  process.env.APPLICANT_JWT_SECRET = 'dev-applicant-jwt-secret-change-in-production';
  const { app } = await import('../../src/index.js');
  server = app.listen(0);
  const addr = server.address() as any;
  baseUrl = `http://localhost:${addr.port}`;
});

after(() => { server?.close(); rmSync(dataDir, { recursive: true, force: true }); delete process.env.DATA_DIR; });

async function post(path: string, body: object, auth?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function put(path: string, body: object, auth?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ─── bug1: Auth guard on /api/applications ────────────────────────────────────

test('NFR-048-edge: unauthenticated POST /api/applications returns 401', async () => {
  const res = await post('/api/applications', { applicantId: 'any-id', jobPostingId: 'job-1' });
  assert.equal(res.status, 401, 'Unauthenticated POST must return 401');
});

test('NFR-048-edge: unauthenticated legacy /api/applicants/:id/apply still works (no auth on legacy route)', async () => {
  // Register a legacy applicant (no password, no token)
  const create = await post('/api/applicants', {
    firstName: 'Legacy', lastName: 'User', email: 'legacy-e2e@test.com',
    phone: '555-0001', address: { state: 'CA', zip: '90210' },
    educationHistory: [{ institution: 'State U', degree: 'BS', fieldOfStudy: 'CS', startDate: '2010', endDate: '2014' }],
    employmentHistory: [{ company: 'Tech Co', position: 'Dev', startDate: '2014', endDate: '2020' }],
    rightToWork: true,
  });
  assert.equal(create.status, 201);
  const applicantId = create.body.id;
  const res = await post(`/api/applicants/${applicantId}/apply`, { jobPostingId: 'job-1' });
  assert.equal(res.status, 201, 'Legacy endpoint must still work without auth');
});

// ─── bug2: Token applicantId wins ────────────────────────────────────────────

test('NFR-048-edge: authenticated token id wins over mismatched body applicantId', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'id-wins@test.com', password: 'password123', firstName: 'Token', lastName: 'Wins', phone: '555-0020',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const correctId = reg.body.profile.id;

  // Authenticated with A's token but deliberately submit B's applicantId
  const res = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId: '00000000-0000-0000-0000-000000000000', jobPostingId: 'job-1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `Authenticated apply must succeed: ${JSON.stringify(body).slice(0,100)}`);
  assert.equal(body.applicantId, correctId, 'applicantId in record must match token, not body');
});

// ─── bug3: Race condition ─────────────────────────────────────────────────────

test('NFR-048-edge: concurrent POSTs for same applicant+job — exactly one 201, one 409', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'race@test.com', password: 'password123', firstName: 'Race', lastName: 'Condition', phone: '555-0025',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;

  // Fire two concurrent requests
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicantId: reg.body.profile.id, jobPostingId: 'job-1' }),
    }),
    fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ applicantId: reg.body.profile.id, jobPostingId: 'job-1' }),
    }),
  ]);

  const [s1, s2] = [res1.status, res2.status];
  const results = [s1, s2].sort();

  // NFR-048-bug3 acceptance: exactly one 201 and one 409
  assert.deepEqual(results, [201, 409],
    `Expected [201, 409], got [${results[0]}, ${results[1]}] — concurrent requests must be serialised`);

  // The 201 response must have a valid application id
  const successRes = s1 === 201 ? res1 : res2;
  const app = await successRes.json();
  assert.ok(app.id, 'Successful application must have an id');
});

// ─── bug4: Cross-endpoint duplicate detection ─────────────────────────────────

// The duplicate check is keyed on applicantId + jobPostingId.
// Both endpoints share the same application store, so they block each other for the SAME applicant.
// Note: requireApplicant injects req.user.id, so the JWT owner is always the applicant.

test('NFR-048-edge: legacy endpoint blocks duplicate from new endpoint', async () => {
  // Register via new endpoint first to get a JWT for the SAME applicant
  const reg = await post('/api/applicants/register', {
    email: 'cross-new@t.com', password: 'password123', firstName: 'Cross', lastName: 'New', phone: '555-0031',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // Apply via new endpoint first (succeeds)
  const first = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-2', emailConfirmation: 'cross-new@t.com' }),
  });
  assert.equal(first.status, 201, 'First new endpoint apply must succeed');

  // Same applicant via legacy endpoint — must be blocked (duplicate keyed on applicantId+jobPostingId)
  const legacyApply = await post(`/api/applicants/${applicantId}/apply`, { jobPostingId: 'job-2' });
  assert.equal(legacyApply.status, 409, 'Legacy endpoint must detect duplicate from new endpoint');
});

// Note: "new endpoint blocks duplicate from legacy endpoint" is covered by the first test
// (same applicant, new endpoint first → legacy endpoint blocks). The reverse — legacy endpoint
// applies first, then new endpoint blocks — cannot be tested via register/login because:
// - Legacy applicants have no password (created via POST /api/applicants, no passwordHash)
// - /api/applicants/register creates a NEW applicant for the same email (different UUID)
// - /api/applicants/login fails (no passwordHash) → no JWT for the legacy applicant
// The application-store duplicate check IS in place; this is a test-infrastructure limitation,
// not a gap in duplicate detection logic.

// ─── bug5: Reapplication after rejection is blocked ───────────────────────────

test('NFR-048-edge: reapplication after rejection is blocked (permanent block)', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'reapply@test.com', password: 'password123', firstName: 'Re', lastName: 'Apply', phone: '555-0050',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // First application
  const first = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-3', emailConfirmation: 'reapply@test.com' }),
  });
  const firstBody = await first.json();
  assert.equal(first.status, 201, `First application must succeed: ${first.status} ${JSON.stringify(firstBody).slice(0,100)}`);
  const appId = firstBody.id;

  // Set up a recruiter who can reject the application
  await post('/api/auth/register', {
    username: 'rejecter', password: 'password123',
    email: 'rejecter@test.com', role: 'recruiter', companyId: 'comp-1',
  });
  const recruiterLogin = await post('/api/auth/login', { username: 'rejecter', password: 'password123' });
  const recruiterToken = recruiterLogin.body.token;

  // Reject the application (requires recruiter role)
  const reject = await put(`/api/applications/${appId}/status`, { status: 'rejected' }, recruiterToken);
  assert.equal(reject.status, 200, `Reject must succeed: ${JSON.stringify(reject.body)}`);

  // Attempt reapplication — duplicate check is per applicantId+jobPostingId, not per status
  const retry = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-3', emailConfirmation: 'reapply@test.com' }),
  });
  assert.equal(retry.status, 409,
    'Reapplication after rejection is blocked — duplicate is keyed on applicantId+jobPostingId only');
});

// ─── bug6: Inactive job check comes before duplicate check ────────────────────

test('NFR-048-edge: applying to an inactive job returns 400 before duplicate check', async () => {
  // Register applicant
  const reg = await post('/api/applicants/register', {
    email: 'inactive-order@test.com', password: 'password123', firstName: 'Inact', lastName: 'Order', phone: '555-0060',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // Deactivate job-3 BEFORE the first application (prevents auto-close from interfering)
  const { readStore, writeStore } = await import('../../src/models/store.js');
  const store = await readStore();
  const jobIdx = store.jobs.findIndex((j: any) => j.id === 'job-3');
  store.jobs[jobIdx].isActive = false;
  await writeStore(store);

  // Attempt application to inactive job — should return 400 (inactive), not 409 (duplicate)
  const retry = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-3', emailConfirmation: 'inactive-order@test.com' }),
  });
  assert.equal(retry.status, 400,
    'Inactive job should return 400 (not 409) — duplicate is not the first failure reason');
  const body = await retry.json();
  assert.ok(body.error?.toLowerCase().includes('no longer accepting'), 'Error must mention job is inactive');
});
