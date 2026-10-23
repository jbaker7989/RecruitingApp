/**
 * NFR-034 / NFR-061–070 PostgreSQL acceptance suite.
 *
 * Ordinary `npm test` may run without PostgreSQL and reports one skipped suite.
 * The explicit DB gate sets DB_TEST_REQUIRED=true; missing or unreachable
 * PostgreSQL then fails in setup instead of silently skipping.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
const schema = process.env.DATABASE_SCHEMA || `nfr_db_${process.pid}_${Date.now()}`;

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
let staffToken = '';
let companyId = '';
let jobId = '';
let applicantToken = '';
let applicantId = '';
let applicationId = '';

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

async function registerApplicant(sequence: string): Promise<{ token: string; id: string }> {
  const response = await request<{ token: string; profile: { id: string } }>(
    '/api/applicants/register',
    json('POST', {
      email: `db-applicant-${sequence}@example.test`,
      password: 'DurablePass123!',
      firstName: 'Database',
      lastName: `Applicant${sequence}`,
      phone: '555-0100',
    }),
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { token: response.body.token, id: response.body.profile.id };
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

  test('staff, company, job, import, applicant, application, matching, scheduling, MCP and audit paths persist', async () => {
    const staff = await request<{ token: string }>('/api/auth/register', json('POST', {
      username: 'db-member-services', password: 'StaffPass123!', email: 'db-staff@example.test', role: 'member-services',
    }));
    assert.equal(staff.status, 201, JSON.stringify(staff.body));
    staffToken = staff.body.token;

    const company = await request<any>('/api/companies', json('POST', {
      companyName: 'Durable Recruiting Co', description: 'Synthetic', location: 'Remote', companySize: '1-10', industry: 'Testing',
    }, staffToken));
    assert.equal(company.status, 201, JSON.stringify(company.body));
    companyId = company.body.id;

    const job = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'Durability Engineer', positionDescription: 'Protect committed state',
      requiredSkills: ['TypeScript', 'PostgreSQL'], requirements: ['transactions'], totalOpenings: 10,
      positionLocation: 'Remote', payRange: { min: 1, max: 2, currency: 'USD' },
    }, staffToken));
    assert.equal(job.status, 201, JSON.stringify(job.body));
    jobId = job.body.id;

    const imported = await request<any>('/api/jobs/import', json('POST', {
      companyId, format: 'json', data: JSON.stringify([{ jobTitle: 'Imported Durable Job', positionDescription: 'Imported', requiredSkills: 'SQL', totalOpenings: 2 }]),
    }, staffToken));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
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
    applicantToken = applicant.token;
    applicantId = applicant.id;

    const patched = await request<any>('/api/applicants/me', json('PATCH', { address: { state: 'NY', zip: '10001' }, rightToWork: true }, applicantToken));
    assert.equal(patched.status, 200, JSON.stringify(patched.body));

    const submitted = await request<any>('/api/applications', json('POST', {
      jobPostingId: jobId, email: 'db-applicant-primary@example.test', emailConfirmation: 'db-applicant-primary@example.test',
    }, applicantToken));
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    applicationId = submitted.body.id;

    const match = await request<any>('/api/agents/matching/score', json('POST', { applicantId, jobId }, staffToken));
    assert.equal(match.status, 200, JSON.stringify(match.body));

    const scheduled = await request<any>('/api/agents/scheduling/interview', json('POST', {
      applicationId, interviewerIds: ['synthetic-interviewer'], proposedTimes: [new Date(Date.now() + 86_400_000).toISOString()],
    }, staffToken));
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));

    const mcpJobs = await request<any>('/api/mcp/jobs', { headers: { authorization: `Bearer ${staffToken}` } });
    assert.equal(mcpJobs.status, 200, JSON.stringify(mcpJobs.body));
    assert.ok(mcpJobs.body.data.some((candidate: any) => candidate.id === jobId));

    const mcpApplicant = await registerApplicant('mcp');
    const mcpJob = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'MCP Durable Job', positionDescription: 'MCP persistence', requiredSkills: ['SQL'], totalOpenings: 2,
    }, staffToken));
    assert.equal(mcpJob.status, 201, JSON.stringify(mcpJob.body));
    const mcpApplied = await request<any>('/api/mcp/apply', json('POST', {
      applicantId: mcpApplicant.id, jobPostingId: mcpJob.body.id,
    }, staffToken));
    assert.equal(mcpApplied.status, 200, JSON.stringify(mcpApplied.body));

    const snapshot = await store.readStore();
    assert.ok(snapshot.users.some((user: any) => user.username === 'db-member-services'));
    assert.ok(snapshot.companies.some((candidate: any) => candidate.id === companyId));
    assert.ok(snapshot.jobs.some((candidate: any) => candidate.jobTitle === 'Imported Durable Job'));
    assert.ok(snapshot.jobs.some((candidate: any) => candidate.jobTitle === 'Service Imported Job'));
    assert.ok(snapshot.applicants.some((candidate: any) => candidate.id === applicantId && candidate.address.state === 'NY'));
    assert.ok(snapshot.applications.some((candidate: any) => candidate.id === applicationId));
    assert.ok(snapshot.applications.some((candidate: any) => candidate.applicantId === mcpApplicant.id && candidate.jobPostingId === mcpJob.body.id));
    assert.ok((await store.readObservability()).length > 0);

    const child = await runProbe('read');
    assert.equal(child.code, 0, child.stderr || child.stdout);
    assert.match(child.stdout, new RegExp(applicationId));
  });

  test('concurrent duplicate and capacity submissions have one coherent winner', async () => {
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => request<any>('/api/applications', json('POST', {
      jobPostingId: jobId,
    }, applicantToken))));
    assert.equal(duplicates.filter((response) => response.status === 409).length, 8);
    const afterDuplicate = await store.readStore();
    assert.equal(afterDuplicate.applications.filter((candidate: any) => candidate.applicantId === applicantId && candidate.jobPostingId === jobId).length, 1);

    const capacityJob = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'One Opening', positionDescription: 'Exactly one application', requiredSkills: ['SQL'], totalOpenings: 1,
    }, staffToken));
    assert.equal(capacityJob.status, 201, JSON.stringify(capacityJob.body));
    const candidates = await Promise.all(Array.from({ length: 5 }, (_, index) => registerApplicant(`capacity-${index}`)));
    const outcomes = await Promise.all(candidates.map((candidate) => request('/api/applications', json('POST', {
      jobPostingId: capacityJob.body.id,
    }, candidate.token))));
    assert.equal(outcomes.filter((response) => response.status === 201).length, 1, outcomes.map((response) => response.status).join(','));
    const snapshot = await store.readStore();
    const persistedJob = snapshot.jobs.find((candidate: any) => candidate.id === capacityJob.body.id);
    assert.equal(persistedJob.currentApplications, 1);
    assert.equal(persistedJob.isActive, false);
    assert.equal(snapshot.applications.filter((candidate: any) => candidate.jobPostingId === capacityJob.body.id).length, 1);
  });

  test('status acceptance and hire creation commit atomically; audit evidence persists', async () => {
    const accepted = await request<any>(`/api/applications/${applicationId}/status`, json('PUT', { status: 'accepted' }, staffToken));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const snapshot = await store.readStore();
    assert.equal(snapshot.applications.find((candidate: any) => candidate.id === applicationId).status, 'accepted');
    assert.ok(snapshot.hires.some((hire: any) => hire.applicantId === applicantId && hire.jobPostingId === jobId));
    assert.ok((await store.readObservability()).some((entry) => entry.entityId === applicationId));
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
    const passwordReset = await import('../../src/services/passwordResetService.js');
    const token = await passwordReset.createResetToken(applicantId, 'db-applicant-primary@example.test');
    assert.equal(typeof token, 'string');
    const reset = await request('/api/applicants/reset-password', json('POST', { token, newPassword: 'ReplacementPass123!' }));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const reused = await request('/api/applicants/reset-password', json('POST', { token, newPassword: 'AnotherPass123!' }));
    assert.notEqual(reused.status, 200);
    const login = await request('/api/applicants/login', json('POST', {
      email: 'db-applicant-primary@example.test', password: 'ReplacementPass123!',
    }));
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const persisted = (await store.readStore()).applicants.find((candidate: any) => candidate.id === applicantId);
    assert.match(persisted.passwordHash, /^\$2[aby]\$/);
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
    const { createResetToken, resetPasswordWithToken } = await import('../../src/services/passwordResetService.js');
    const token = await createResetToken(applicantId, 'db-applicant-primary@example.test');
    const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await client.connect();
    await client.query(`
      CREATE FUNCTION reject_test_applicant_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.collection = 'applicants' AND NEW.id = '${applicantId}' THEN
          RAISE EXCEPTION 'synthetic applicant update failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_test_applicant_update
      BEFORE UPDATE ON app_records
      FOR EACH ROW EXECUTE FUNCTION reject_test_applicant_update();
    `);
    try {
      await assert.rejects(
        resetPasswordWithToken(token, '$2b$10$syntheticDatabaseFailureHash0000000000000000000000000'),
        /synthetic applicant update failure/,
      );
      const afterFailure = (await store.readStore()).passwordResetTokens.find((candidate: any) => candidate.token === token);
      assert.equal(afterFailure.usedAt, null, 'the failed transaction must not burn the token');
    } finally {
      await client.query('DROP TRIGGER IF EXISTS reject_test_applicant_update ON app_records');
      await client.query('DROP FUNCTION IF EXISTS reject_test_applicant_update()');
      await client.end();
    }
    const retry = await resetPasswordWithToken(token, '$2b$10$syntheticSuccessfulRetryHash000000000000000000000000');
    assert.deepEqual(retry, { ok: true, applicantId });
  });

  test('staff profile cannot replace privileged or credential fields', async () => {
    const before = (await store.readStore()).users.find((user: any) => user.username === 'db-member-services');
    const response = await request('/api/auth/me', json('PATCH', {
      id: 'replacement', role: 'admin', companyId: 'other-tenant', passwordHash: 'replacement',
      createdAt: 'replacement', oauthProvider: 'replacement',
    }, staffToken));
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
