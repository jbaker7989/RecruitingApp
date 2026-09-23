/**
 * NFR-048: Duplicate Application Prevention
 *
 * Story: story-duplicate-application-prevention.md
 *
 * An applicant must not be able to submit multiple applications to the same job posting.
 * The system must return 409 Conflict on the second attempt with the existing application ID.
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
let store: typeof import('../../src/models/store.js');

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr048-'));
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
    jobs: [{
      id: 'job-1',
      companyId: 'comp-1',
      jobTitle: 'Software Engineer',
      positionDescription: 'Build things.',
      requirements: [],
      positionLocation: 'Remote',
      payRange: { min: 80000, max: 120000, currency: 'USD' },
      responsibilities: [],
      qualifications: [],
      requiredSkills: ['TypeScript'],
      requiredExperience: 2,
      reportsTo: '',
      isActive: true,
      totalOpenings: 5,
      currentApplications: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    applicants: [],
    applications: [],
    users: [],
    hires: [],
    observability: [],
    drafts: [],
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

// ─── Helper ────────────────────────────────────────────────────────────────────

async function post(path: string, body: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('NFR-048: first application to a job succeeds', async () => {
  // Register + login an applicant
  const reg = await post('/api/applicants/register', {
    email: 'applicant@test.com',
    password: 'password123',
    firstName: 'Alice',
    lastName: 'Applicant',
    phone: '555-0000',
  });
  assert.equal(reg.status, 201, 'Registration should succeed');
  assert.ok(reg.body.token, 'Response must include a token');
  const token = reg.body.token;

  // Submit first application
  const first = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId: reg.body.profile.id, jobPostingId: 'job-1' }),
  });
  assert.equal(first.status, 201, 'First application should succeed');
  const firstApp = await first.json();
  assert.ok(firstApp.id, 'Application must have an id');
});

test('NFR-048: second application to the same job returns 409 Conflict', async () => {
  // Register + login
  const reg = await post('/api/applicants/register', {
    email: 'applicant2@test.com',
    password: 'password123',
    firstName: 'Bob',
    lastName: 'Applicant',
    phone: '555-0001',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // First application — succeeds
  const first = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-1' }),
  });
  assert.equal(first.status, 201);
  const firstApp = await first.json();

  // Second application — must be blocked
  const second = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-1' }),
  });
  assert.equal(second.status, 409, 'Second application to the same job must return 409');
  const secondBody = await second.json();
  assert.ok(secondBody.error, '409 response must include an error message');
  assert.equal(secondBody.applicationId, firstApp.id, '409 response must include the existing application ID');
});

test('NFR-048: applicant can apply to different jobs', async () => {
  // Create a second job
  const s = await store.readStore();
  s.jobs.push({
    id: 'job-2',
    companyId: 'comp-1',
    jobTitle: 'Product Manager',
    positionDescription: 'Lead product.',
    requirements: [],
    positionLocation: 'Remote',
    payRange: { min: 90000, max: 140000, currency: 'USD' },
    responsibilities: [],
    qualifications: [],
    requiredSkills: ['Product'],
    requiredExperience: 3,
    reportsTo: '',
    isActive: true,
    totalOpenings: 2,
    currentApplications: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await store.writeStore(s);

  // Register applicant
  const reg = await post('/api/applicants/register', {
    email: 'applicant3@test.com',
    password: 'password123',
    firstName: 'Carol',
    lastName: 'Applicant',
    phone: '555-0002',
  });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // Apply to job-1
  const app1 = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-1' }),
  });
  assert.equal(app1.status, 201);

  // Apply to job-2 — succeeds (different job)
  const app2 = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-2' }),
  });
  assert.equal(app2.status, 201, 'Applying to a different job must succeed');
});

test('NFR-048: legacy POST /api/applicants/:id/apply also prevents duplicates', async () => {
  // Create applicant via legacy non-auth route
  const legacy = await post('/api/applicants', {
    firstName: 'Dave',
    lastName: 'Legacy',
    email: 'dave@test.com',
    phone: '555-0003',
    address: { state: 'CA', zip: '90210' },
    educationHistory: [{ institution: 'U', degree: 'BS', fieldOfStudy: 'CS', startDate: '2010', endDate: '2014' }],
    employmentHistory: [{ company: 'X', position: 'Dev', startDate: '2014', endDate: '2020' }],
    rightToWork: true,
  });
  assert.equal(legacy.status, 201);
  const applicantId = legacy.body.id;

  // First legacy apply
  const first = await fetch(`${baseUrl}/api/applicants/${applicantId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobPostingId: 'job-1' }),
  });
  assert.equal(first.status, 201);

  // Second legacy apply — must be blocked
  const second = await fetch(`${baseUrl}/api/applicants/${applicantId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobPostingId: 'job-1' }),
  });
  assert.equal(second.status, 409, 'Legacy apply endpoint must also prevent duplicates');
});

test('NFR-048: GET /me/jobs returns hasApplied=true for already-applied job', async () => {
  const reg = await post('/api/applicants/register', {
    email: 'applicant4@test.com',
    password: 'password123',
    firstName: 'Eve',
    lastName: 'Applicant',
    phone: '555-0004',
  });
  const token = reg.body.token;
  const applicantId = reg.body.profile.id;

  // Apply
  await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicantId, jobPostingId: 'job-1' }),
  });

  // Browse jobs (requires applicant auth)
  const jobs = await fetch(`${baseUrl}/api/applicants/me/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const jobsData = await jobs.json() as any[];
  assert.equal(jobs.status, 200);
  assert.ok(Array.isArray(jobsData));
  const myJob = jobsData.find((j: { id: string }) => j.id === 'job-1');
  assert.ok(myJob, 'job-1 must appear in browse results');
  assert.equal(myJob.hasApplied, true, 'hasApplied must be true for applied job');
  assert.ok(myJob.applicationId, 'applicationId must be present');
});
