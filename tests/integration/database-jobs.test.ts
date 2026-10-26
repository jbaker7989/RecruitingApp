/**
 * NFR-DATA-002-S02: job create, import, update and delete persist atomically in PostgreSQL.
 *
 * Every test seeds its own company through updateStore so it never depends on a
 * previous test's mutable IDs. The suite uses its own DATABASE_SCHEMA per run.
 * With DB_TEST_REQUIRED=true a missing DATABASE_URL fails instead of skipping.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
const schema = `nfr_db_jobs_${process.pid}_${Date.now()}`;

if (databaseRequired && !databaseUrl) {
  throw new Error('DB_TEST_REQUIRED=true requires DATABASE_URL');
}

interface JsonResponse<T = any> {
  status: number;
  body: T;
}

interface StoreModule {
  initializeStore(): Promise<unknown>;
  closeStore(): Promise<void>;
  readStore(): Promise<any>;
  writeStore(data: any): Promise<void>;
  readObservability(): Promise<any[]>;
  updateStore<T>(mutator: (store: any) => T | Promise<T>): Promise<T>;
}

let store: StoreModule;
let server: any;
let baseUrl = '';
let staffToken = '';
let outsiderToken = '';

async function request<T = any>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body: body as T };
}

function json(method: string, body: unknown, token = staffToken): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  };
}

function bearer(method: string, token = staffToken): RequestInit {
  return { method, headers: { authorization: `Bearer ${token}` } };
}

async function registerStaff(role: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const response = await request<{ token: string }>('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `db-jobs-${role}-${suffix}`, password: 'SyntheticPass123!', email: `db-jobs-${suffix}@example.test`, role }),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.token;
}

async function seedCompany(name = 'Synthetic Jobs Co'): Promise<string> {
  const id = `company-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  await store.updateStore((current) => {
    current.companies.push({
      id, companyName: name, description: 'Synthetic', location: 'Remote', companySize: '1-10',
      industry: 'Testing', hiringManagers: [], createdAt: timestamp, updatedAt: timestamp,
    });
  });
  return id;
}

async function seedJob(companyId: string, overrides: Record<string, unknown> = {}): Promise<any> {
  const timestamp = new Date().toISOString();
  const job = {
    id: `job-${randomUUID()}`, companyId, jobTitle: 'Seeded Job', positionDescription: 'Seeded through updateStore',
    requirements: [], positionLocation: 'Remote', payRange: { min: 0, max: 0, currency: 'USD' },
    responsibilities: [], qualifications: [], requiredSkills: [], requiredExperience: 0, reportsTo: 'N/A',
    isActive: true, totalOpenings: 1, currentApplications: 0, createdAt: timestamp, updatedAt: timestamp,
    ...overrides,
  };
  await store.updateStore((current) => { current.jobs.push(job); });
  return job;
}

async function jobsFor(companyId: string): Promise<any[]> {
  return (await store.readStore()).jobs.filter((job: any) => job.companyId === companyId);
}

async function auditsFor(action: string, entityId: string): Promise<any[]> {
  return (await store.readObservability()).filter((entry: any) => entry.action === action && entry.entityId === entityId);
}

/** Installs a trigger that rejects job writes matching `condition` until the returned cleanup runs. */
async function rejectJobWrites(condition: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  await client.connect();
  await client.query(`
    CREATE FUNCTION reject_test_job_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.collection = 'jobs' AND (${condition}) THEN
        RAISE EXCEPTION 'synthetic job write failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_test_job_write
    BEFORE INSERT OR UPDATE ON app_records
    FOR EACH ROW EXECUTE FUNCTION reject_test_job_write();
  `);
  return async () => {
    await client.query('DROP TRIGGER IF EXISTS reject_test_job_write ON app_records');
    await client.query('DROP FUNCTION IF EXISTS reject_test_job_write()');
    await client.end();
  };
}

describe('NFR-DATA-002-S02 PostgreSQL job writes', { skip: !runDatabaseTests }, () => {
  before(async () => {
    process.env.USE_DATABASE = 'true';
    process.env.DATABASE_SCHEMA = schema;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'database-jobs-user-secret-32-characters-min';
    process.env.APPLICANT_JWT_SECRET = 'database-jobs-applicant-secret-32-characters';
    process.env.DATABASE_CONNECT_TIMEOUT_MS = '1500';

    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();

    store = await import('../../src/models/store.js') as StoreModule;
    await store.initializeStore();
    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;

    staffToken = await registerStaff('hiring-manager');
    outsiderToken = await registerStaff('interviewer');
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

  test('S02-AC1: create persists the job with existing defaults and appends the audit after commit', async () => {
    const companyId = await seedCompany();
    const created = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'Durable Job', positionDescription: 'Created through PostgreSQL', positionLocation: 'Remote',
      requiredSkills: ['SQL'], totalOpenings: 1,
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(typeof created.body.id, 'string');
    assert.equal(created.body.companyId, companyId);
    assert.deepEqual(created.body.requirements, []);
    assert.deepEqual(created.body.payRange, { min: 0, max: 0, currency: 'USD' });
    assert.deepEqual(created.body.responsibilities, []);
    assert.deepEqual(created.body.qualifications, []);
    assert.deepEqual(created.body.requiredSkills, ['SQL']);
    assert.equal(created.body.requiredExperience, 0);
    assert.equal(created.body.reportsTo, 'N/A');
    assert.equal(created.body.isActive, true);
    assert.equal(created.body.totalOpenings, 1);
    assert.equal(created.body.currentApplications, 0);

    const persisted = (await jobsFor(companyId)).find((job: any) => job.id === created.body.id);
    assert.deepEqual(persisted, created.body, 'fresh PostgreSQL read returns the committed job');

    const audits = await auditsFor('create', created.body.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entityType, 'Job');
    assert.equal(audits[0].outcome, 'success');
    assert.deepEqual(audits[0].details, { jobTitle: 'Durable Job' });
  });

  test('S02-AC1: create keeps validation, role checks and missing-company 404 without mutation', async () => {
    const companyId = await seedCompany();
    const jobsBefore = (await store.readStore()).jobs.length;
    const auditsBefore = (await store.readObservability()).filter((entry: any) => entry.action === 'create' && entry.entityType === 'Job').length;

    const missing = await request<any>('/api/jobs', json('POST', {
      companyId: `company-missing-${randomUUID()}`, jobTitle: 'Orphan Job', positionDescription: 'No parent', positionLocation: 'Remote', requiredSkills: ['SQL'], totalOpenings: 1,
    }));
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Company not found' });

    const invalid = await request<any>('/api/jobs', json('POST', { companyId }));
    assert.equal(invalid.status, 400);
    assert.ok(Array.isArray(invalid.body.errors));

    const forbidden = await request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: 'Forbidden Job', positionDescription: 'Wrong role', positionLocation: 'Remote', requiredSkills: ['SQL'], totalOpenings: 1,
    }, outsiderToken));
    assert.equal(forbidden.status, 403);

    assert.equal((await store.readStore()).jobs.length, jobsBefore);
    const auditsAfter = (await store.readObservability()).filter((entry: any) => entry.action === 'create' && entry.entityType === 'Job').length;
    assert.equal(auditsAfter, auditsBefore, 'no success audit for rejected creates');
  });

  test('S02-AC1/F-AC4: failed create commit returns an error, persists no job and appends no audit', async () => {
    const companyId = await seedCompany();
    const sentinel = await seedJob(companyId, { jobTitle: 'Committed Before Failure' });
    const cleanup = await rejectJobWrites(`NEW.data->>'jobTitle' = 'Commit Failure Job'`);
    let response: JsonResponse<any>;
    try {
      response = await request<any>('/api/jobs', json('POST', {
        companyId, jobTitle: 'Commit Failure Job', positionDescription: 'Must roll back', positionLocation: 'Remote', requiredSkills: ['SQL'], totalOpenings: 1,
      }));
    } finally {
      await cleanup();
    }
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.match(response.body.error, /synthetic job write failure/);
    const jobs = await jobsFor(companyId);
    assert.deepEqual(jobs.map((job: any) => job.id), [sentinel.id], 'only previously committed data remains');
    const audits = (await store.readObservability()).filter((entry: any) => entry.action === 'create' && entry.details?.jobTitle === 'Commit Failure Job');
    assert.equal(audits.length, 0);
  });

  test('S02-AC2: JSON import commits every created row and reports the existing result shape', async () => {
    const companyId = await seedCompany();
    const imported = await request<any>('/api/jobs/import', json('POST', {
      companyId, format: 'json', data: JSON.stringify({ jobs: [
        { jobTitle: 'Imported One', positionDescription: 'First', requiredSkills: 'SQL;TypeScript', payMin: 10, payMax: 20, totalOpenings: 3 },
        { title: 'Imported Two', description: 'Second', location: 'Austin', skills: 'Go', openings: 2 },
      ] }),
    }));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.deepEqual(Object.keys(imported.body).sort(), ['errors', 'failures', 'jobsCreated', 'successes', 'totalRows']);
    assert.equal(imported.body.totalRows, 2);
    assert.equal(imported.body.successes, 2);
    assert.equal(imported.body.failures, 0);
    assert.deepEqual(imported.body.errors, []);
    assert.equal(imported.body.jobsCreated.length, 2);

    const persisted = await jobsFor(companyId);
    assert.deepEqual(persisted.map((job: any) => job.id).sort(), [...imported.body.jobsCreated].sort());
    const one = persisted.find((job: any) => job.jobTitle === 'Imported One');
    assert.deepEqual(one.requiredSkills, ['SQL', 'TypeScript']);
    assert.deepEqual(one.payRange, { min: 10, max: 20, currency: 'USD' });
    assert.equal(one.totalOpenings, 3);
    const two = persisted.find((job: any) => job.jobTitle === 'Imported Two');
    assert.equal(two.positionDescription, 'Second');
    assert.equal(two.positionLocation, 'Austin');
    assert.deepEqual(two.requiredSkills, ['Go']);
    assert.equal(two.totalOpenings, 2);
    assert.equal(two.reportsTo, 'N/A');
    assert.equal(two.isActive, true);

    const audits = await auditsFor('import', companyId);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, 'success');
    assert.deepEqual(audits[0].details, imported.body, 'audit records the committed result');
  });

  test('S02-AC2: CSV import persists rows with existing defaults', async () => {
    const companyId = await seedCompany();
    const csv = 'jobTitle,positionDescription,requirements,reportsTo\nCsv Job,From CSV,degree;license,Lead\n,Defaults only,,\n';
    const imported = await request<any>('/api/jobs/import', json('POST', { companyId, format: 'csv', data: csv }));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.totalRows, 2);
    assert.equal(imported.body.successes, 2);
    assert.equal(imported.body.failures, 0);

    const persisted = await jobsFor(companyId);
    assert.deepEqual(persisted.map((job: any) => job.id).sort(), [...imported.body.jobsCreated].sort());
    const csvJob = persisted.find((job: any) => job.jobTitle === 'Csv Job');
    assert.deepEqual(csvJob.requirements, ['degree', 'license']);
    assert.equal(csvJob.reportsTo, 'Lead');
    const defaulted = persisted.find((job: any) => job.positionDescription === 'Defaults only');
    assert.equal(defaulted.jobTitle, 'Untitled');
    assert.deepEqual(defaulted.requirements, []);
    assert.equal(defaulted.totalOpenings, 1);
  });

  test('S02-AC2: import keeps 400/404 responses and does not mutate on missing parent or bad input', async () => {
    const companyId = await seedCompany();
    const jobsBefore = (await store.readStore()).jobs.length;
    const missingCompanyId = `company-missing-${randomUUID()}`;

    const noCompanyId = await request<any>('/api/jobs/import', json('POST', { format: 'json', data: '[]' }));
    assert.equal(noCompanyId.status, 400);
    assert.deepEqual(noCompanyId.body, { error: 'companyId is required' });

    const missing = await request<any>('/api/jobs/import', json('POST', {
      companyId: missingCompanyId, format: 'json', data: JSON.stringify([{ jobTitle: 'Orphan Import' }]),
    }));
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Company not found' });

    const missingWithBadFormat = await request<any>('/api/jobs/import', json('POST', { companyId: missingCompanyId, format: 'xml', data: '' }));
    assert.equal(missingWithBadFormat.status, 404, 'company check still precedes format validation');

    const badFormat = await request<any>('/api/jobs/import', json('POST', { companyId, format: 'xml', data: '' }));
    assert.equal(badFormat.status, 400);
    assert.deepEqual(badFormat.body, { error: 'format must be csv or json' });

    const forbidden = await request<any>('/api/jobs/import', json('POST', {
      companyId, format: 'json', data: JSON.stringify([{ jobTitle: 'Forbidden Import' }]),
    }, outsiderToken));
    assert.equal(forbidden.status, 403);

    assert.equal((await store.readStore()).jobs.length, jobsBefore);
    assert.equal((await auditsFor('import', missingCompanyId)).length, 0);
    assert.equal((await auditsFor('import', companyId)).length, 0);
  });

  test('S02-AC2/F-AC4: failed import commit persists none of the rows and no success audit', async () => {
    const companyId = await seedCompany();
    const sentinel = await seedJob(companyId, { jobTitle: 'Committed Before Import' });
    const cleanup = await rejectJobWrites(`NEW.data->>'jobTitle' = 'Import Row Two'`);
    let response: JsonResponse<any>;
    try {
      response = await request<any>('/api/jobs/import', json('POST', {
        companyId, format: 'json', data: JSON.stringify([
          { jobTitle: 'Import Row One' }, { jobTitle: 'Import Row Two' }, { jobTitle: 'Import Row Three' },
        ]),
      }));
    } finally {
      await cleanup();
    }
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.match(response.body.error, /synthetic job write failure/);
    assert.equal(response.body.successes, undefined, 'a failed commit is not reported as per-row success');
    const jobs = await jobsFor(companyId);
    assert.deepEqual(jobs.map((job: any) => job.id), [sentinel.id], 'no imported row is partially committed');
    assert.equal((await auditsFor('import', companyId)).length, 0);
  });

  test('S02-AC3: update merges into the current job, persists it and keeps 404 for missing IDs', async () => {
    const companyId = await seedCompany();
    const job = await seedJob(companyId, { jobTitle: 'Before Update', totalOpenings: 2 });
    const updated = await request<any>(`/api/jobs/${job.id}`, json('PUT', { jobTitle: 'After Update', isActive: false }));
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.id, job.id);
    assert.equal(updated.body.jobTitle, 'After Update');
    assert.equal(updated.body.isActive, false);
    assert.equal(updated.body.totalOpenings, 2, 'unspecified fields are preserved');
    assert.equal(updated.body.createdAt, job.createdAt);
    assert.ok(updated.body.updatedAt >= job.updatedAt);
    const persisted = (await jobsFor(companyId)).find((candidate: any) => candidate.id === job.id);
    assert.deepEqual(persisted, updated.body);

    const before = await store.readStore();
    const missing = await request<any>(`/api/jobs/job-missing-${randomUUID()}`, json('PUT', { jobTitle: 'Ghost' }));
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Job not found' });
    const forbidden = await request<any>(`/api/jobs/${job.id}`, json('PUT', { jobTitle: 'Forbidden' }, outsiderToken));
    assert.equal(forbidden.status, 403);
    assert.deepEqual((await store.readStore()).jobs, before.jobs, 'rejected updates do not mutate');
  });

  test('S02-AC3: delete removes only the target job and keeps the existing response', async () => {
    const companyId = await seedCompany();
    const target = await seedJob(companyId, { jobTitle: 'Delete Me' });
    const keep = await seedJob(companyId, { jobTitle: 'Keep Me' });

    const forbidden = await request<any>(`/api/jobs/${target.id}`, bearer('DELETE', outsiderToken));
    assert.equal(forbidden.status, 403);
    assert.equal((await jobsFor(companyId)).length, 2);

    const deleted = await request<any>(`/api/jobs/${target.id}`, bearer('DELETE'));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(deleted.body, { message: 'Job deleted' });
    assert.deepEqual((await jobsFor(companyId)).map((job: any) => job.id), [keep.id]);

    // Existing contract: deleting an unknown ID answers 200 and changes nothing.
    const before = await store.readStore();
    const missing = await request<any>(`/api/jobs/job-missing-${randomUUID()}`, bearer('DELETE'));
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, { message: 'Job deleted' });
    assert.deepEqual((await store.readStore()).jobs, before.jobs);
  });

  test('S02-AC4: concurrent independent job writes all persist', async () => {
    const companyId = await seedCompany();
    const existing = await seedJob(companyId, { jobTitle: 'Concurrent Target', totalOpenings: 1, reportsTo: 'N/A' });
    const doomed = await seedJob(companyId, { jobTitle: 'Concurrent Delete' });

    const creates = Array.from({ length: 6 }, (_, index) => request<any>('/api/jobs', json('POST', {
      companyId, jobTitle: `Concurrent Create ${index}`, positionDescription: 'Race', positionLocation: 'Remote', requiredSkills: ['SQL'], totalOpenings: 1,
    })));
    const results = await Promise.all([
      ...creates,
      request<any>('/api/jobs/import', json('POST', {
        companyId, format: 'json', data: JSON.stringify([{ jobTitle: 'Concurrent Import A' }, { jobTitle: 'Concurrent Import B' }]),
      })),
      // Disjoint fields of the same job: each merge must start from the latest committed state.
      request<any>(`/api/jobs/${existing.id}`, json('PUT', { totalOpenings: 9 })),
      request<any>(`/api/jobs/${existing.id}`, json('PUT', { reportsTo: 'Concurrent Lead' })),
      request<any>(`/api/jobs/${doomed.id}`, bearer('DELETE')),
    ]);
    for (const result of results) assert.ok(result.status === 200 || result.status === 201, JSON.stringify(result.body));

    const persisted = await jobsFor(companyId);
    const titles = persisted.map((job: any) => job.jobTitle).sort();
    for (let index = 0; index < 6; index += 1) assert.ok(titles.includes(`Concurrent Create ${index}`), `create ${index} persisted`);
    assert.ok(titles.includes('Concurrent Import A'));
    assert.ok(titles.includes('Concurrent Import B'));
    assert.equal(persisted.some((job: any) => job.id === doomed.id), false);
    const merged = persisted.find((job: any) => job.id === existing.id);
    assert.equal(merged.totalOpenings, 9, 'first concurrent update survived');
    assert.equal(merged.reportsTo, 'Concurrent Lead', 'second concurrent update survived');
    assert.equal(persisted.length, 1 + 6 + 2);
  });

  test('S02-AC4/F-AC3: job routes use updateStore and writeStore still rejects PostgreSQL', async () => {
    const source = await readFile(new URL('../../src/routes/jobs.ts', import.meta.url), 'utf8');
    assert.equal(/\bwriteStore\b/.test(source), false, 'jobs.ts must not reference writeStore');
    assert.ok((source.match(/\bupdateStore\(/g) ?? []).length >= 4, 'each job write route commits through updateStore');
    await assert.rejects(store.writeStore(await store.readStore()), /not supported with the database backend/);
  });
});
