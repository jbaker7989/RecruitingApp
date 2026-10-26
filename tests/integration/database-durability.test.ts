/**
 * NFR-034 / NFR-061–070 PostgreSQL acceptance suite.
 *
 * Ordinary `npm test` may run without PostgreSQL and reports one skipped suite.
 * The explicit DB gate sets DB_TEST_REQUIRED=true; missing or unreachable
 * PostgreSQL then fails in setup instead of silently skipping.
 *
 * NFR-DATA-002-S03: tests do not share mutable record IDs. The end-to-end route
 * flow keeps its IDs local to one test; every other test seeds its own company,
 * job, applicant, application, staff user or reset token through `updateStore`
 * (or an already-durable registration route) and asserts the fixture exists
 * before exercising the behavior under test.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
// One schema per file and run so concurrent developers and CI jobs never share rows or locks.
const schema = `nfr_db_${process.pid}_${Date.now()}`;

if (databaseRequired && !databaseUrl) {
  throw new Error('DB_TEST_REQUIRED=true requires DATABASE_URL');
}

interface JsonResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

interface StoreModule {
  initializeStore(): Promise<unknown>;
  closeStore(): Promise<void>;
  readStore(): Promise<any>;
  readObservability(): Promise<any[]>;
  updateStore<T>(mutator: (store: any) => T | Promise<T>): Promise<T>;
}

let store: StoreModule;
let server: any;
let baseUrl = '';

async function request<T = any>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, body: body as T, headers: response.headers };
}

function json(method: string, body: unknown, token?: string): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  };
}

function applicantEmail(sequence: string): string {
  return `db-applicant-${sequence}@example.test`;
}

async function registerApplicant(sequence: string): Promise<{ token: string; id: string; email: string }> {
  const email = applicantEmail(sequence);
  const response = await request<{ token: string; profile: { id: string } }>(
    '/api/applicants/register',
    json('POST', {
      email,
      password: 'DurablePass123!',
      firstName: 'Database',
      lastName: `Applicant${sequence}`,
      phone: '555-0100',
    }),
  );
  assert.equal(response.status, 201, `fixture applicant ${sequence}: ${JSON.stringify(response.body)}`);
  assert.ok(response.body.profile?.id, `fixture applicant ${sequence} must return an id`);
  return { token: response.body.token, id: response.body.profile.id, email };
}

async function registerStaff(sequence: string, role = 'member-services'): Promise<{ token: string; id: string; username: string }> {
  const username = `db-staff-${sequence}`;
  const response = await request<{ token: string; user: { id: string } }>('/api/auth/register', json('POST', {
    username, password: 'StaffPass123!', email: `${username}@example.test`, role,
  }));
  assert.equal(response.status, 201, `fixture staff ${sequence}: ${JSON.stringify(response.body)}`);
  assert.ok(response.body.token && response.body.user?.id, `fixture staff ${sequence} must return a token and id`);
  return { token: response.body.token, id: response.body.user.id, username };
}

// ---------------------------------------------------------------------------
// Direct fixtures. Seeded with updateStore (never writeStore) so an independent
// test does not depend on the company or job routes under repair.
// ---------------------------------------------------------------------------

async function seedCompany(label: string): Promise<{ id: string }> {
  const timestamp = new Date().toISOString();
  const company = {
    id: `fixture-company-${label}-${randomUUID()}`, companyName: `Fixture ${label} Co`, description: 'Synthetic',
    location: 'Remote', companySize: '1-10', industry: 'Testing', createdAt: timestamp, updatedAt: timestamp,
  };
  await store.updateStore((current) => { current.companies.push(company); });
  assert.ok((await store.readStore()).companies.some((candidate: any) => candidate.id === company.id), `fixture company ${label} must persist`);
  return company;
}

async function seedJob(label: string, companyId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; companyId: string; jobTitle: string }> {
  assert.ok(companyId, `fixture job ${label} requires a company id`);
  const timestamp = new Date().toISOString();
  const job = {
    id: `fixture-job-${label}-${randomUUID()}`, companyId, jobTitle: `Fixture ${label} Job`,
    positionDescription: 'Synthetic fixture job', requirements: ['transactions'], positionLocation: 'Remote',
    payRange: { min: 1, max: 2, currency: 'USD' }, responsibilities: [], qualifications: [],
    requiredSkills: ['SQL'], requiredExperience: 0, reportsTo: 'N/A', isActive: true, totalOpenings: 10,
    currentApplications: 0, createdAt: timestamp, updatedAt: timestamp, ...overrides,
  };
  await store.updateStore((current) => {
    if (!current.companies.some((candidate: any) => candidate.id === companyId)) {
      throw new Error(`fixture job ${label}: company ${companyId} is missing`);
    }
    current.jobs.push(job);
  });
  assert.ok((await store.readStore()).jobs.some((candidate: any) => candidate.id === job.id), `fixture job ${label} must persist`);
  return job;
}

async function seedApplicant(label: string, passwordHash: string): Promise<{ id: string; email: string }> {
  const timestamp = new Date().toISOString();
  const applicant = {
    id: `fixture-applicant-${label}-${randomUUID()}`, firstName: 'Fixture', lastName: label, email: applicantEmail(`seeded-${label}`),
    passwordHash, phone: '555-0101', preferredContactMethod: 'email', address: { state: '', zip: '' },
    educationHistory: [], employmentHistory: [], rightToWork: true, requiresSponsorship: false, expectedPay: 0,
    notificationToManager: false, hireRecords: [], oauthProvider: null, oauthProviderId: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
  await store.updateStore((current) => { current.applicants.push(applicant); });
  assert.ok((await store.readStore()).applicants.some((candidate: any) => candidate.id === applicant.id), `fixture applicant ${label} must persist`);
  return applicant;
}

async function seedApplication(label: string, applicantId: string, jobId: string): Promise<{ id: string }> {
  assert.ok(applicantId && jobId, `fixture application ${label} requires applicant and job ids`);
  const timestamp = new Date().toISOString();
  const application = {
    id: `fixture-application-${label}-${randomUUID()}`, applicantId, jobPostingId: jobId, status: 'pending',
    matchScore: 0, keywordMatches: [], educationMatchScore: 0, experienceMatchScore: 0,
    appliedAt: timestamp, updatedAt: timestamp, emailConfirmed: true,
  };
  await store.updateStore((current) => {
    const job = current.jobs.find((candidate: any) => candidate.id === jobId);
    if (!job) throw new Error(`fixture application ${label}: job ${jobId} is missing`);
    if (!current.applicants.some((candidate: any) => candidate.id === applicantId)) {
      throw new Error(`fixture application ${label}: applicant ${applicantId} is missing`);
    }
    current.applications.push(application);
    job.currentApplications += 1;
  });
  assert.ok((await store.readStore()).applications.some((candidate: any) => candidate.id === application.id), `fixture application ${label} must persist`);
  return application;
}

function runProbe(command: string, envOverrides: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/database-process-probe.ts', command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        USE_DATABASE: 'true',
        DATABASE_URL: databaseUrl,
        DATABASE_SCHEMA: schema,
        NODE_ENV: 'test',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('NFR-034 durable PostgreSQL storage', { skip: !runDatabaseTests }, () => {
  before(async () => {
    process.env.USE_DATABASE = 'true';
    process.env.DATABASE_SCHEMA = schema;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'database-integration-user-secret-32-characters';
    process.env.APPLICANT_JWT_SECRET = 'database-integration-applicant-secret-32-characters';
    process.env.DATABASE_CONNECT_TIMEOUT_MS = '1500';

    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();

    store = await import('../../src/models/store.js') as StoreModule;
    await store.initializeStore();
    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (store) await store.closeStore();
    if (databaseUrl) {
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    delete process.env.DATABASE_SCHEMA;
    delete process.env.USE_DATABASE;
  });

  test('configured PostgreSQL initializes idempotently and reports ready', async () => {
    await store.initializeStore();
    await store.initializeStore();
    const ready = await request<{ status: string }>('/ready');
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
  });

  test('updateStore commits cross-process and rolls back thrown mutations', async () => {
    const write = await runProbe('write-marker');
    assert.equal(write.code, 0, write.stderr || write.stdout);
    const read = await runProbe('read');
    assert.equal(read.code, 0, read.stderr || read.stdout);
    const marker = read.stdout.split('\n').find((line) => line.startsWith('DB_PROBE:'));
    assert.ok(marker, read.stdout);
    const snapshot = JSON.parse(marker.slice('DB_PROBE:'.length));
    assert.ok(snapshot.companyIds.includes('cross-process-company'));

    await assert.rejects(
      store.updateStore((current) => {
        current.companies.push({ id: 'must-rollback', companyName: 'Rollback sentinel' });
        throw new Error('intentional rollback');
      }),
      /intentional rollback/,
    );
    assert.equal((await store.readStore()).companies.some((company: any) => company.id === 'must-rollback'), false);
  });

  test('concurrent atomic mutations preserve every update', async () => {
    await store.updateStore((current) => {
      current.applicants.push({
        id: 'counter-applicant', firstName: 'Counter', lastName: 'Test', email: 'counter@example.test',
        passwordHash: null, phone: '', preferredContactMethod: 'email', address: { state: '', zip: '' },
        educationHistory: [], employmentHistory: [], rightToWork: true, requiresSponsorship: false,
        expectedPay: 0, notificationToManager: false, hireRecords: [], oauthProvider: null,
        oauthProviderId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    });
    await Promise.all(Array.from({ length: 16 }, () => store.updateStore((current) => {
      const applicant = current.applicants.find((candidate: any) => candidate.id === 'counter-applicant');
      applicant.expectedPay += 1;
    })));
    const applicant = (await store.readStore()).applicants.find((candidate: any) => candidate.id === 'counter-applicant');
    assert.equal(applicant.expectedPay, 16);
  });

  // Named enclosing flow: every step depends on the previous step's IDs, which stay local to this test.
  // A failing company route therefore stops this flow at its own step instead of leaking empty IDs.
  test('staff, company, job, import, applicant, application, matching, scheduling, MCP and audit paths persist', async () => {
    const staff = await request<{ token: string }>('/api/auth/register', json('POST', {
      username: 'db-member-services', password: 'StaffPass123!', email: 'db-staff@example.test', role: 'member-services',
    }));
    assert.equal(staff.status, 201, `step staff register: ${JSON.stringify(staff.body)}`);
    const staffToken = staff.body.token;

    const company = await request<any>('/api/companies', json('POST', {
      companyName: 'Durable Recruiting Co', description: 'Synthetic', location: 'Remote', companySize: '1-10', industry: 'Testing',
    }, staffToken));
    assert.equal(company.status, 201, `step company create: ${JSON.stringify(company.body)}`);
    const companyId: string = company.body.id;
    assert.ok(companyId, 'step company create must return an id');

    const job = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'Durability Engineer', positionDescription: 'Protect committed state',
      requiredSkills: ['TypeScript', 'PostgreSQL'], requirements: ['transactions'], totalOpenings: 10,
      positionLocation: 'Remote', payRange: { min: 1, max: 2, currency: 'USD' },
    }, staffToken));
    assert.equal(job.status, 201, `step job create: ${JSON.stringify(job.body)}`);
    const jobId: string = job.body.id;
    assert.ok(jobId, 'step job create must return an id');

    const imported = await request<any>('/api/jobs/import', json('POST', {
      companyId, format: 'json', data: JSON.stringify([{ jobTitle: 'Imported Durable Job', positionDescription: 'Imported', requiredSkills: 'SQL', totalOpenings: 2 }]),
    }, staffToken));
    assert.equal(imported.status, 200, `step job import: ${JSON.stringify(imported.body)}`);
    assert.equal(imported.body.successes, 1);

    const { importFromJSON } = await import('../../src/services/importService.js');
    const serviceImport = await importFromJSON(JSON.stringify([{
      jobTitle: 'Service Imported Job', positionDescription: 'Imported through importService',
      requirements: 'transactions', positionLocation: 'Remote', responsibilities: 'verify',
      qualifications: 'testing', requiredSkills: 'PostgreSQL', requiredExperience: 1,
      reportsTo: 'Test', totalOpenings: 1,
    }]), companyId, 'db-member-services');
    assert.equal(serviceImport.successes, 1);

    const applicant = await registerApplicant('primary');
    const applicantToken = applicant.token;
    const applicantId = applicant.id;

    const patched = await request<any>('/api/applicants/me', json('PATCH', { address: { state: 'NY', zip: '10001' }, rightToWork: true }, applicantToken));
    assert.equal(patched.status, 200, `step applicant patch: ${JSON.stringify(patched.body)}`);

    const submitted = await request<any>('/api/applications', json('POST', {
      jobPostingId: jobId, email: applicant.email, emailConfirmation: applicant.email,
    }, applicantToken));
    assert.equal(submitted.status, 201, `step application submit: ${JSON.stringify(submitted.body)}`);
    const applicationId: string = submitted.body.id;

    const match = await request<any>('/api/agents/matching/score', json('POST', { applicantId, jobId }, staffToken));
    assert.equal(match.status, 200, `step matching: ${JSON.stringify(match.body)}`);

    const scheduled = await request<any>('/api/agents/scheduling/interview', json('POST', {
      applicationId, interviewerIds: ['synthetic-interviewer'], proposedTimes: [new Date(Date.now() + 86_400_000).toISOString()],
    }, staffToken));
    assert.equal(scheduled.status, 200, `step scheduling: ${JSON.stringify(scheduled.body)}`);

    const mcpJobs = await request<any>('/api/mcp/jobs', { headers: { authorization: `Bearer ${staffToken}` } });
    assert.equal(mcpJobs.status, 200, `step mcp jobs: ${JSON.stringify(mcpJobs.body)}`);
    assert.ok(mcpJobs.body.data.some((candidate: any) => candidate.id === jobId));

    const mcpApplicant = await registerApplicant('mcp');
    const mcpJob = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'MCP Durable Job', positionDescription: 'MCP persistence', requiredSkills: ['SQL'], totalOpenings: 2,
    }, staffToken));
    assert.equal(mcpJob.status, 201, `step mcp job create: ${JSON.stringify(mcpJob.body)}`);
    const mcpApplied = await request<any>('/api/mcp/apply', json('POST', {
      applicantId: mcpApplicant.id, jobPostingId: mcpJob.body.id,
    }, staffToken));
    assert.equal(mcpApplied.status, 200, `step mcp apply: ${JSON.stringify(mcpApplied.body)}`);

    // Company and job update/delete complete the seven repaired write routes in this flow.
    const companyUpdate = await request<any>(`/api/companies/${companyId}`, json('PUT', { location: 'Hybrid' }, staffToken));
    assert.equal(companyUpdate.status, 200, `step company update: ${JSON.stringify(companyUpdate.body)}`);
    assert.equal(companyUpdate.body.location, 'Hybrid');
    const jobUpdate = await request<any>(`/api/jobs/${jobId}`, json('PUT', { positionLocation: 'Hybrid' }, staffToken));
    assert.equal(jobUpdate.status, 200, `step job update: ${JSON.stringify(jobUpdate.body)}`);
    assert.equal(jobUpdate.body.positionLocation, 'Hybrid');

    const disposableJob = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'Disposable Durable Job', positionDescription: 'Deleted in flow', requiredSkills: ['SQL'], totalOpenings: 1,
    }, staffToken));
    assert.equal(disposableJob.status, 201, `step disposable job create: ${JSON.stringify(disposableJob.body)}`);
    const jobDelete = await request<any>(`/api/jobs/${disposableJob.body.id}`, json('DELETE', {}, staffToken));
    assert.equal(jobDelete.status, 200, `step job delete: ${JSON.stringify(jobDelete.body)}`);
    assert.deepEqual(jobDelete.body, { message: 'Job deleted' });

    const disposableCompany = await request<any>('/api/companies', json('POST', {
      companyName: 'Disposable Durable Co', description: 'Deleted in flow',
    }, staffToken));
    assert.equal(disposableCompany.status, 201, `step disposable company create: ${JSON.stringify(disposableCompany.body)}`);
    const companyDelete = await request<any>(`/api/companies/${disposableCompany.body.id}`, json('DELETE', {}, staffToken));
    assert.equal(companyDelete.status, 200, `step company delete: ${JSON.stringify(companyDelete.body)}`);
    assert.deepEqual(companyDelete.body, { message: 'Company deleted' });

    const snapshot = await store.readStore();
    assert.ok(snapshot.users.some((user: any) => user.username === 'db-member-services'));
    assert.equal(snapshot.companies.find((candidate: any) => candidate.id === companyId)?.location, 'Hybrid');
    assert.equal(snapshot.jobs.find((candidate: any) => candidate.id === jobId)?.positionLocation, 'Hybrid');
    assert.equal(snapshot.jobs.some((candidate: any) => candidate.id === disposableJob.body.id), false);
    assert.equal(snapshot.companies.some((candidate: any) => candidate.id === disposableCompany.body.id), false);
    assert.ok(snapshot.jobs.some((candidate: any) => candidate.jobTitle === 'Imported Durable Job' && candidate.companyId === companyId));
    assert.ok(snapshot.jobs.some((candidate: any) => candidate.jobTitle === 'Service Imported Job'));
    assert.ok(snapshot.applicants.some((candidate: any) => candidate.id === applicantId && candidate.address.state === 'NY'));
    assert.ok(snapshot.applications.some((candidate: any) => candidate.id === applicationId));
    assert.ok(snapshot.applications.some((candidate: any) => candidate.applicantId === mcpApplicant.id && candidate.jobPostingId === mcpJob.body.id));
    const audit = await store.readObservability();
    assert.ok(audit.some((entry) => entry.action === 'create' && entry.entityType === 'Company' && entry.entityId === companyId));
    assert.ok(audit.some((entry) => entry.action === 'create' && entry.entityType === 'Job' && entry.entityId === jobId));
    assert.ok(audit.some((entry) => entry.action === 'import' && entry.entityType === 'Job' && entry.entityId === companyId));

    const child = await runProbe('read');
    assert.equal(child.code, 0, child.stderr || child.stdout);
    assert.match(child.stdout, new RegExp(applicationId));
  });

  test('concurrent duplicate and capacity submissions have one coherent winner', async () => {
    // Explicit prerequisites: own company, job, applicant and one committed application.
    const company = await seedCompany('duplicate');
    const job = await seedJob('duplicate', company.id, { totalOpenings: 10 });
    const applicant = await registerApplicant('duplicate');
    const first = await request<any>('/api/applications', json('POST', { jobPostingId: job.id }, applicant.token));
    assert.equal(first.status, 201, `fixture first application: ${JSON.stringify(first.body)}`);

    const duplicates = await Promise.all(Array.from({ length: 8 }, () => request<any>('/api/applications', json('POST', {
      jobPostingId: job.id,
    }, applicant.token))));
    assert.equal(duplicates.filter((response) => response.status === 409).length, 8);
    const afterDuplicate = await store.readStore();
    assert.equal(afterDuplicate.applications.filter((candidate: any) => candidate.applicantId === applicant.id && candidate.jobPostingId === job.id).length, 1);

    const capacityJob = await seedJob('capacity', company.id, { jobTitle: 'One Opening', totalOpenings: 1 });
    const candidates = await Promise.all(Array.from({ length: 5 }, (_, index) => registerApplicant(`capacity-${index}`)));
    const outcomes = await Promise.all(candidates.map((candidate) => request('/api/applications', json('POST', {
      jobPostingId: capacityJob.id,
    }, candidate.token))));
    assert.equal(outcomes.filter((response) => response.status === 201).length, 1, outcomes.map((response) => response.status).join(','));
    const snapshot = await store.readStore();
    const persistedJob = snapshot.jobs.find((candidate: any) => candidate.id === capacityJob.id);
    assert.equal(persistedJob.currentApplications, 1);
    assert.equal(persistedJob.isActive, false);
    assert.equal(snapshot.applications.filter((candidate: any) => candidate.jobPostingId === capacityJob.id).length, 1);
  });

  test('status acceptance and hire creation commit atomically; audit evidence persists', async () => {
    // Explicit prerequisites: own staff user, company, job, applicant and pending application.
    const staff = await registerStaff('status');
    const company = await seedCompany('status');
    const job = await seedJob('status', company.id);
    const applicant = await registerApplicant('status');
    const application = await seedApplication('status', applicant.id, job.id);

    const accepted = await request<any>(`/api/applications/${application.id}/status`, json('PUT', { status: 'accepted' }, staff.token));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.id, application.id);
    assert.equal(accepted.body.status, 'accepted');
    const snapshot = await store.readStore();
    assert.equal(snapshot.applications.find((candidate: any) => candidate.id === application.id).status, 'accepted');
    const hire = snapshot.hires.find((candidate: any) => candidate.applicantId === applicant.id && candidate.jobPostingId === job.id);
    assert.ok(hire, 'accepted application must persist a hire record');
    assert.equal(hire.companyId, company.id);
    assert.ok(snapshot.applicants.find((candidate: any) => candidate.id === applicant.id).hireRecords.includes(hire.id));
    assert.ok((await store.readObservability()).some((entry) => entry.entityId === application.id && entry.action === 'status_change'));

    const missing = await request<any>('/api/applications/missing-application/status', json('PUT', { status: 'accepted' }, staff.token));
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.equal((await store.readStore()).hires.filter((candidate: any) => candidate.applicantId === applicant.id).length, 1);
  });

  test('dashboard bcrypt registration, login and profile changes survive in PostgreSQL', async () => {
    const form = new URLSearchParams({
      email: 'dashboard-db@example.test', password: 'DashboardPass123!', confirmPassword: 'DashboardPass123!',
      firstName: 'Dashboard', lastName: 'Durable', phone: '', next: '/dashboard/profile',
    });
    const registered = await request('/dashboard/register', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual',
    });
    assert.equal(registered.status, 302, String(registered.body));

    const login = await request('/dashboard/login', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'dashboard-db@example.test', password: 'DashboardPass123!', next: '/dashboard/profile' }),
      redirect: 'manual',
    });
    assert.equal(login.status, 302, String(login.body));
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie);
    const profile = await request('/dashboard/profile', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ firstName: 'DashboardUpdated', state: 'MA', zip: '02108' }), redirect: 'manual',
    });
    assert.equal(profile.status, 302, String(profile.body));
    const snapshot = await store.readStore();
    const persisted = snapshot.applicants.find((candidate: any) => candidate.email === 'dashboard-db@example.test');
    assert.equal(persisted.firstName, 'DashboardUpdated');
    assert.match(persisted.passwordHash, /^\$2[aby]\$/);
  });

  test('legacy user and applicant hashes migrate to bcrypt durably', async () => {
    const password = 'LegacyPass123!';
    await store.updateStore((current) => {
      const timestamp = new Date().toISOString();
      current.users.push({
        id: 'legacy-user', username: 'legacy-user', passwordHash: `encrypted_${password}`, role: 'recruiter',
        email: 'legacy-user@example.test', createdAt: timestamp, oauthProvider: null,
      });
      current.applicants.push({
        id: 'legacy-applicant', firstName: 'Legacy', lastName: 'Applicant', email: 'legacy-applicant@example.test',
        passwordHash: createHash('sha256').update(password).digest('hex'), phone: '555-0199', preferredContactMethod: 'email',
        address: { state: '', zip: '' }, educationHistory: [], employmentHistory: [], rightToWork: true,
        requiresSponsorship: false, expectedPay: 0, notificationToManager: false, hireRecords: [], oauthProvider: null,
        oauthProviderId: null, createdAt: timestamp, updatedAt: timestamp,
      });
    });
    assert.equal((await request('/api/auth/login', json('POST', { username: 'legacy-user', password }))).status, 200);
    assert.equal((await request('/api/applicants/login', json('POST', { email: 'legacy-applicant@example.test', password }))).status, 200);
    const snapshot = await store.readStore();
    assert.match(snapshot.users.find((user: any) => user.id === 'legacy-user').passwordHash, /^\$2[aby]\$/);
    assert.match(snapshot.applicants.find((candidate: any) => candidate.id === 'legacy-applicant').passwordHash, /^\$2[aby]\$/);
  });

  test('password reset is single-use and persists the bcrypt replacement', async () => {
    // Explicit prerequisite: own registered applicant, independent of the end-to-end flow.
    const applicant = await registerApplicant('reset');
    const passwordReset = await import('../../src/services/passwordResetService.js');
    const token = await passwordReset.createResetToken(applicant.id, applicant.email);
    assert.equal(typeof token, 'string');
    const before = (await store.readStore()).applicants.find((candidate: any) => candidate.id === applicant.id);
    assert.ok(before, 'fixture applicant must exist before reset');

    const reset = await request('/api/applicants/reset-password', json('POST', { token, newPassword: 'ReplacementPass123!' }));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const reused = await request('/api/applicants/reset-password', json('POST', { token, newPassword: 'AnotherPass123!' }));
    assert.notEqual(reused.status, 200);
    assert.equal(reused.status, 401, JSON.stringify(reused.body));
    const login = await request('/api/applicants/login', json('POST', {
      email: applicant.email, password: 'ReplacementPass123!',
    }));
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const oldLogin = await request('/api/applicants/login', json('POST', { email: applicant.email, password: 'DurablePass123!' }));
    assert.notEqual(oldLogin.status, 200, 'the replaced password must no longer authenticate');
    const snapshot = await store.readStore();
    const persisted = snapshot.applicants.find((candidate: any) => candidate.id === applicant.id);
    assert.match(persisted.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(persisted.passwordHash, before.passwordHash);
    assert.notEqual(snapshot.passwordResetTokens.find((candidate: any) => candidate.token === token).usedAt, null);
  });

  test('failed atomic password reset does not consume its token', async () => {
    const { createResetToken, resetPasswordWithToken } = await import('../../src/services/passwordResetService.js');
    const token = await createResetToken('missing-applicant', 'missing-applicant@example.test');
    const result = await resetPasswordWithToken(token, '$2b$10$syntheticHashNotUsedBecauseApplicantIsMissing000000000000');
    assert.deepEqual(result, { ok: false, reason: 'no_applicant' });
    const persisted = (await store.readStore()).passwordResetTokens.find((candidate: any) => candidate.token === token);
    assert.equal(persisted.usedAt, null);
  });

  test('database failure during applicant password update rolls back token consumption', async () => {
    // Explicit prerequisites: a real seeded applicant row and a token for it, so the trigger is
    // reached on that row (never short-circuited to `no_applicant`).
    const originalHash = '$2b$10$syntheticSeededOriginalHash0000000000000000000000000';
    const failedHash = '$2b$10$syntheticDatabaseFailureHash0000000000000000000000000';
    const retryHash = '$2b$10$syntheticSuccessfulRetryHash000000000000000000000000';
    const applicant = await seedApplicant('rollback', originalHash);
    const { createResetToken, resetPasswordWithToken } = await import('../../src/services/passwordResetService.js');
    const token = await createResetToken(applicant.id, applicant.email);
    const seeded = await store.readStore();
    assert.ok(seeded.applicants.some((candidate: any) => candidate.id === applicant.id), 'fixture applicant row must exist');
    assert.equal(seeded.passwordResetTokens.find((candidate: any) => candidate.token === token)?.applicantId, applicant.id);

    const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await client.connect();
    try {
      // Literal applicant id is safe: it is generated by this test (fixture prefix + UUID).
      await client.query(`
        CREATE FUNCTION reject_test_applicant_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.collection = 'applicants' AND NEW.id = '${applicant.id}' THEN
            RAISE EXCEPTION 'synthetic applicant update failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_test_applicant_update
        BEFORE UPDATE ON app_records
        FOR EACH ROW EXECUTE FUNCTION reject_test_applicant_update();
      `);

      await assert.rejects(
        resetPasswordWithToken(token, failedHash),
        /synthetic applicant update failure/,
        'the trigger on the seeded applicant row must reject the transaction',
      );
      const afterFailure = await store.readStore();
      assert.equal(afterFailure.passwordResetTokens.find((candidate: any) => candidate.token === token).usedAt, null, 'the failed transaction must not burn the token');
      assert.equal(afterFailure.applicants.find((candidate: any) => candidate.id === applicant.id).passwordHash, originalHash, 'the failed transaction must not change the password hash');
    } finally {
      await client.query('DROP TRIGGER IF EXISTS reject_test_applicant_update ON app_records');
      await client.query('DROP FUNCTION IF EXISTS reject_test_applicant_update()');
      await client.end();
    }

    const retry = await resetPasswordWithToken(token, retryHash);
    assert.deepEqual(retry, { ok: true, applicantId: applicant.id });
    const afterRetry = await store.readStore();
    assert.notEqual(afterRetry.passwordResetTokens.find((candidate: any) => candidate.token === token).usedAt, null);
    assert.equal(afterRetry.applicants.find((candidate: any) => candidate.id === applicant.id).passwordHash, retryHash);
  });

  test('staff profile cannot replace privileged or credential fields', async () => {
    // Explicit prerequisite: own staff user rather than the end-to-end flow's token.
    const staff = await registerStaff('profile');
    const before = (await store.readStore()).users.find((user: any) => user.id === staff.id);
    assert.ok(before, 'fixture staff user must exist');
    const response = await request('/api/auth/me', json('PATCH', {
      id: 'replacement', role: 'admin', companyId: 'other-tenant', passwordHash: 'replacement',
      createdAt: 'replacement', oauthProvider: 'replacement',
    }, staff.token));
    assert.equal(response.status, 200);
    const after = (await store.readStore()).users.find((user: any) => user.username === before.username);
    for (const field of ['id', 'role', 'companyId', 'passwordHash', 'createdAt', 'oauthProvider']) {
      assert.deepEqual(after[field], before[field], field);
    }
  });

  test('a newer schema version fails closed in a fresh process', async () => {
    const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await client.connect();
    try {
      await client.query("UPDATE store_meta SET value = '2'::jsonb WHERE key = 'schema_version'");
      const result = await runProbe('read');
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Unsupported store schema version/);
    } finally {
      await client.query("UPDATE store_meta SET value = '1'::jsonb WHERE key = 'schema_version'");
      await client.end();
    }
  });

  test('configured database failure fails closed', async () => {
    const failed = await runProbe('read', {
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/unreachable',
      DATABASE_SCHEMA: `nfr_unreachable_${process.pid}`,
      DATABASE_CONNECT_TIMEOUT_MS: '250',
    });
    assert.notEqual(failed.code, 0, failed.stdout);
    assert.match(failed.stderr, /(connect|ECONNREFUSED|database)/i);
  });
});

test('database integration prerequisite is explicit', { skip: runDatabaseTests }, () => {
  assert.equal(databaseRequired, false, 'DB_TEST_REQUIRED=true must provide DATABASE_URL');
});
