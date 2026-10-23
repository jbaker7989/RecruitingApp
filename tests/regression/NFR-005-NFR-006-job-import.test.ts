import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_DIR = '/tmp/nfr-005-006-test-store';
const PORT = 3500;

describe('NFR-005: CSV job import completely broken — Papa.parse is not a function', () => {
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
        JWT_SECRET: 'nfr005-test-secret-must-be-at-least-32-chars-long',
        APPLICANT_JWT_SECRET: 'nfr005-applicant-secret-must-be-32-chars-min',
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

  async function getToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `u${Date.now()}`, password: 'pass1234', email: `${Date.now()}@x.com`, role: 'hiring-manager' }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Register failed: ${text}`);
    return JSON.parse(text).token;
  }

  async function createCompany(token: string, name = `Acme ${Date.now()}`): Promise<string> {
    const res = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, industry: 'Technology', website: 'https://acme.example.com' }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Company creation failed: ${text}`);
    return JSON.parse(text).id;
  }

  it('POST /api/jobs/import with CSV format does not crash with "Papa.parse is not a function"', async () => {
    const token = await getToken();
    const companyId = await createCompany(token);

    const csv = [
      'jobTitle,title,description,requirements,positionLocation,payMin,payMax,totalOpenings',
      'Software Engineer,senior dev,Build stuff,"React; TypeScript; Node.js",New York,80000,120000,2',
    ].join('\n');

    const res = await fetch(`${baseUrl}/api/jobs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ format: 'csv', data: csv, companyId }),
    });
    const text = await res.text();
    // Must not be a 500 with "Papa.parse is not a function"
    assert.notEqual(res.status, 500, `Expected non-500, got 500: ${text}`);
    assert.ok([200, 201, 400, 207].includes(res.status), `Expected 200/201/400/207, got ${res.status}: ${text}`);
  });

  it('POST /api/jobs/import with JSON format works', async () => {
    const token = await getToken();
    const companyId = await createCompany(token);

    const res = await fetch(`${baseUrl}/api/jobs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        format: 'json',
        companyId,
        data: JSON.stringify({
          jobs: [{
            jobTitle: 'Backend Engineer',
            positionDescription: 'Build APIs',
            requirements: 'Node.js; PostgreSQL; Redis',
            positionLocation: 'Remote',
            payMin: 90000,
            payMax: 140000,
            totalOpenings: 1,
          }],
        }),
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);
  });
});

describe('NFR-006: Job import silently drops ALL requirements (operator precedence bug)', () => {
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
        JWT_SECRET: 'nfr006-test-secret-must-be-at-least-32-chars-long',
        APPLICANT_JWT_SECRET: 'nfr006-applicant-secret-must-be-32-chars-min',
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

  async function getToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `u${Date.now()}`, password: 'pass1234', email: `${Date.now()}@x.com`, role: 'hiring-manager' }),
    });
    const text = await res.text();
    assert.equal(res.status, 201);
    return JSON.parse(text).token;
  }

  async function createCompany(token: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `Acme Corp ${Date.now()}`, industry: 'Tech', website: 'https://acme.example.com' }),
    });
    const text = await res.text();
    assert.equal(res.status, 201, `Company creation failed: ${text}`);
    return JSON.parse(text).id;
  }

  it('imported CSV job preserves requirements as a non-empty array', async () => {
    const token = await getToken();
    const companyId = await createCompany(token);

    const csv = [
      'jobTitle,requirements,positionLocation,payMin,payMax,totalOpenings',
      '"Frontend Dev","React; TypeScript; CSS","San Francisco",90000,140000,1',
    ].join('\n');

    const res = await fetch(`${baseUrl}/api/jobs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ format: 'csv', data: csv, companyId }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Import failed: ${text}`);
    const body = JSON.parse(text);
    assert.ok(body.jobsCreated?.length > 0 || body.successes > 0 || body.totalRows > 0,
      `Import should report at least one job: ${text}`);

    const jobsRes = await fetch(`${baseUrl}/api/jobs?companyId=${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jobsText = await jobsRes.text();
    assert.equal(jobsRes.status, 200, `Jobs fetch failed: ${jobsText}`);
    const jobs = JSON.parse(jobsText);

    const imported = jobs.find((j: any) => j.jobTitle === 'Frontend Dev');
    assert.ok(imported, `Imported job "Frontend Dev" not found in ${jobsText}`);
    assert.ok(Array.isArray(imported.requirements), 'requirements must be an array');
    assert.ok(imported.requirements.length > 0,
      `requirements must not be empty, got: ${JSON.stringify(imported.requirements)}`);
    assert.ok(imported.requirements.includes('React') || imported.requirements.includes('TypeScript'),
      `requirements should contain "React" or "TypeScript", got: ${JSON.stringify(imported.requirements)}`);
  });

  it('imported JSON job preserves requirements as a non-empty array', async () => {
    const token = await getToken();
    const companyId = await createCompany(token);

    const res = await fetch(`${baseUrl}/api/jobs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        format: 'json',
        companyId,
        data: JSON.stringify({
          jobs: [{
            jobTitle: 'Data Engineer',
            positionDescription: 'Build data pipelines',
            requirements: 'Python; Spark; SQL; Airflow',
            positionLocation: 'Remote',
            payMin: 100000,
            payMax: 160000,
            totalOpenings: 1,
          }],
        }),
      }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `Import failed: ${text}`);

    const jobsRes = await fetch(`${baseUrl}/api/jobs?companyId=${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jobs = JSON.parse(await jobsRes.text());
    const imported = jobs.find((j: any) => j.jobTitle === 'Data Engineer');
    assert.ok(imported, `Imported job "Data Engineer" not found`);
    assert.ok(Array.isArray(imported.requirements) && imported.requirements.length > 0,
      `requirements must be non-empty array, got: ${JSON.stringify(imported.requirements)}`);
  });
});
