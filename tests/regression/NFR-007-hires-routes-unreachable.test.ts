import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DIR = '/tmp/nfr-007-test-store';
const PORT = 3501;

describe('NFR-007: Hires routes are unreachable — route ordering bug', () => {
  let server: ReturnType<typeof spawn>;
  const baseUrl = `http://localhost:${PORT}`;

  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    server = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATA_DIR: TEST_DIR,
        JWT_SECRET: 'nfr007-test-secret-must-be-at-least-32-chars-long',
        APPLICANT_JWT_SECRET: 'nfr007-applicant-secret-must-be-32-chars-min',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

  // Helper: register a hiring-manager user and return { token, userId, username, password }
  async function getHiringManagerToken(): Promise<{ token: string; userId: string; username: string; password: string }> {
    const username = `hm${Date.now()}`;
    const password = 'pass1234';
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        email: `${Date.now()}@x.com`,
        role: 'hiring-manager',
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Register failed: ${text}`);
    const body = JSON.parse(text);
    return { token: body.token, userId: body.user.id, username, password };
  }

  // Helper: register an applicant and return { token, applicantId }
  async function getApplicantToken(): Promise<{ token: string; applicantId: string }> {
    const res = await fetch(`${baseUrl}/api/applicants/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `applicant${Date.now()}@x.com`,
        password: 'password123',
        firstName: 'Test',
        lastName: 'Applicant',
        phone: '555-0000',
        address: { street: '1 St', city: 'NYC', state: 'NY', zip: '10001' },
        educationHistory: [{ institution: 'U', degree: 'BS', field: 'CS', graduationYear: 2020 }],
        employmentHistory: [],
        rightToWork: true,
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Applicant register failed: ${text}`);
    const body = JSON.parse(text);
    return { token: body.token, applicantId: body.profile.id };
  }

  // Helper: create a company and job, return { companyId, jobId, hmToken }
  // Re-logs in after company creation so the returned token carries companyId
  // (register tokens omit companyId; only login tokens include it in the JWT payload).
  async function createCompanyAndJob(
    token: string,
    username: string,
    password: string,
  ): Promise<{ companyId: string; jobId: string; hmToken: string }> {
    const compRes = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        companyName: `Acme${Date.now()}`,
        industry: 'Tech',
        companySize: '10-50',
        location: 'NYC',
        website: 'https://acme.example.com',
      }),
    });
    const compText = await compRes.text();
    assert.equal(compRes.status, 201, `Company creation failed: ${compText}`);
    const companyId = JSON.parse(compText).id;

    // Re-login so the new token includes companyId (register tokens don't carry it)
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const loginText = await loginRes.text();
    assert.equal(loginRes.status, 200, `Re-login failed: ${loginText}`);
    const hmToken = JSON.parse(loginText).token;

    const jobRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hmToken}` },
      body: JSON.stringify({
        companyId,
        jobTitle: 'Test Engineer',
        positionDescription: 'Test things',
        requirements: ['testing'],
        positionLocation: 'Remote',
        payRange: { min: 80000, max: 120000, currency: 'USD' },
        responsibilities: ['test'],
        qualifications: ['test'],
        requiredSkills: ['testing'],
        requiredExperience: 1,
        reportsTo: 'N/A',
        totalOpenings: 2,
      }),
    });
    const jobText = await jobRes.text();
    assert.equal(jobRes.status, 201, `Job creation failed: ${jobText}`);
    const jobId = JSON.parse(jobText).id;
    return { companyId, jobId, hmToken };
  }

  // Helper: apply to a job (returns application id)
  async function applyToJob(applicantToken: string, jobId: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${applicantToken}` },
      body: JSON.stringify({
        jobPostingId: jobId,
        coverLetter: 'I am a good candidate',
        email: 'test@test.com',
        emailConfirmation: 'test@test.com',
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Application failed: ${text}`);
    return JSON.parse(text).id;
  }

  // Helper: accept an application (creates a hire record)
  async function acceptApplication(hmToken: string, applicationId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/applications/${applicationId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hmToken}` },
      body: JSON.stringify({ status: 'accepted' }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Accept application failed: ${text}`);
  }

  it('GET /api/applications/hires is reachable and returns 200 with valid auth', async () => {
    const { token } = await getHiringManagerToken();

    const res = await fetch(`${baseUrl}/api/applications/hires`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    // Must return 200 (array, possibly empty), NOT 404 "Application not found"
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);
    const body = JSON.parse(text);
    assert.ok(Array.isArray(body), `Expected array, got: ${text}`);
  });

  it('GET /api/applications/hires does NOT return 404 "Application not found"', async () => {
    const { token } = await getHiringManagerToken();

    const res = await fetch(`${baseUrl}/api/applications/hires`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    const body = JSON.parse(text);
    assert.notEqual(
      body.error,
      'Application not found',
      'GET /api/applications/hires must not be intercepted by GET /:id — hires must not be treated as an application id',
    );
  });

  it('GET /api/applications/hires includes a created hire record after accepting an application', async () => {
    const { token: hmToken, username, password } = await getHiringManagerToken();
    const { token: applicantToken } = await getApplicantToken();
    const { jobId, hmToken: freshHmToken } = await createCompanyAndJob(hmToken, username, password);
    const applicationId = await applyToJob(applicantToken, jobId);
    await acceptApplication(freshHmToken, applicationId);

    const res = await fetch(`${baseUrl}/api/applications/hires`, {
      headers: { Authorization: `Bearer ${freshHmToken}` },
    });
    const text = await res.text();
    assert.equal(res.status, 200, `GET /applications/hires failed: ${text}`);
    const hires = JSON.parse(text);
    assert.ok(Array.isArray(hires), `Expected array, got: ${text}`);
    assert.ok(hires.length > 0, `Expected at least one hire, got: ${text}`);
    assert.ok(
      hires.some((h: any) => h.jobPostingId === jobId),
      `Expected hire for job ${jobId}, got: ${JSON.stringify(hires)}`,
    );
  });

  it('GET /api/applications/companies/:id/hires is reachable and returns 200', async () => {
    const { token: hmToken, username, password } = await getHiringManagerToken();
    const { token: applicantToken } = await getApplicantToken();
    const { companyId, jobId, hmToken: freshHmToken } = await createCompanyAndJob(hmToken, username, password);
    const applicationId = await applyToJob(applicantToken, jobId);
    await acceptApplication(freshHmToken, applicationId);

    const res = await fetch(`${baseUrl}/api/applications/companies/${companyId}/hires`, {
      headers: { Authorization: `Bearer ${freshHmToken}` },
    });
    const text = await res.text();
    // Must return 200, NOT 404 (route intercepted by /:id with id='companies')
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);
    const body = JSON.parse(text);
    assert.ok(Array.isArray(body), `Expected array, got: ${text}`);
  });

  it('GET /api/applications/:id still works — individual application lookup by UUID', async () => {
    const { token: hmToken, username, password } = await getHiringManagerToken();
    const { token: applicantToken } = await getApplicantToken();
    const { jobId, hmToken: freshHmToken } = await createCompanyAndJob(hmToken, username, password);
    const applicationId = await applyToJob(applicantToken, jobId);

    const res = await fetch(`${baseUrl}/api/applications/${applicationId}`, {
      headers: { Authorization: `Bearer ${freshHmToken}` },
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);
    const body = JSON.parse(text);
    assert.equal(body.id, applicationId);
  });

  it('GET /api/applications/:id returns 404 for a non-existent UUID', async () => {
    const { token } = await getHiringManagerToken();

    const res = await fetch(`${baseUrl}/api/applications/nonexistent-uuid-123`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    assert.equal(res.status, 404, `Expected 404, got ${res.status}: ${text}`);
  });
});
