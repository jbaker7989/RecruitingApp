/**
 * NFR-DATA-002-S01: company create/update/delete commit atomically in PostgreSQL.
 *
 * Runs against a real PostgreSQL in its own disposable DATABASE_SCHEMA. Ordinary
 * `npm test` without DATABASE_URL skips this suite; DB_TEST_REQUIRED=true turns a
 * missing database into a failure instead of a silent skip. Synthetic data only.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
// Always a fresh schema for this file so concurrent suites and reruns never share rows or locks.
const schema = `nfr_s01_company_${process.pid}_${Date.now().toString(36)}`;

if (databaseRequired && !databaseUrl) {
  throw new Error('DB_TEST_REQUIRED=true requires DATABASE_URL');
}

const COMPANY_FIELDS = ['companyName', 'companySize', 'createdAt', 'description', 'id', 'industry', 'location', 'updatedAt'];

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
  LegacyWholesaleWriteError: new (...args: any[]) => Error;
}

let store: StoreModule;
let server: any;
let baseUrl = '';
let staffToken = '';
let staffId = '';
let managerToken = '';
let managerId = '';

async function request<T = any>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body: body as T };
}

function json(method: string, body: unknown, token?: string): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

function bare(method: string, token?: string): RequestInit {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

async function registerUser(username: string, role: string): Promise<{ token: string; id: string }> {
  const response = await request<{ token: string; user: { id: string } }>('/api/auth/register', json('POST', {
    username, password: 'SyntheticPass123!', email: `${username}@example.test`, role,
  }));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { token: response.body.token, id: response.body.user.id };
}

async function seedCompany(id: string, companyName: string): Promise<void> {
  const timestamp = '2026-01-01T00:00:00.000Z';
  await store.updateStore((current) => {
    current.companies.push({
      id, companyName, description: 'Seeded', location: 'Remote', companySize: '1-10',
      industry: 'Testing', createdAt: timestamp, updatedAt: timestamp,
    });
  });
}

async function companyAudits(entityId?: string, companyName?: string): Promise<any[]> {
  return (await store.readObservability()).filter((entry: any) =>
    entry.entityType === 'Company' && entry.action === 'create'
    && (entityId === undefined || entry.entityId === entityId)
    && (companyName === undefined || entry.details?.companyName === companyName));
}

/** Installs a row trigger that raises for matching app_records rows, runs `fn`, then drops it. */
async function withFailingTrigger(
  timing: 'INSERT' | 'UPDATE' | 'DELETE',
  collection: string,
  id: string | null,
  fn: () => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  await client.connect();
  const row = timing === 'DELETE' ? 'OLD' : 'NEW';
  const idCheck = id === null ? '' : ` AND ${row}.id = '${id}'`;
  await client.query(`
    CREATE FUNCTION s01_reject_company_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${row}.collection = '${collection}'${idCheck} THEN
        RAISE EXCEPTION 'synthetic company write failure';
      END IF;
      RETURN ${row};
    END $$;
    CREATE TRIGGER s01_reject_company_write
    BEFORE ${timing} ON app_records
    FOR EACH ROW EXECUTE FUNCTION s01_reject_company_write();
  `);
  try {
    await fn();
  } finally {
    await client.query('DROP TRIGGER IF EXISTS s01_reject_company_write ON app_records');
    await client.query('DROP FUNCTION IF EXISTS s01_reject_company_write()');
    await client.end();
  }
}

function readInNewProcess(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/database-process-probe.ts', 'read'], {
      cwd: process.cwd(),
      env: { ...process.env, USE_DATABASE: 'true', DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, NODE_ENV: 'test' },
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

describe('NFR-DATA-002-S01 PostgreSQL company writes', { skip: !runDatabaseTests }, () => {
  before(async () => {
    process.env.USE_DATABASE = 'true';
    process.env.DATABASE_SCHEMA = schema;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'company-integration-user-secret-32-characters';
    process.env.APPLICANT_JWT_SECRET = 'company-integration-applicant-secret-32-characters';
    process.env.DATABASE_CONNECT_TIMEOUT_MS = '1500';

    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();

    store = await import('../../src/models/store.js') as unknown as StoreModule;
    await store.initializeStore();
    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;

    ({ token: staffToken, id: staffId } = await registerUser('s01-member-services', 'member-services'));
    ({ token: managerToken, id: managerId } = await registerUser('s01-hiring-manager', 'hiring-manager'));
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

  test('S01-AC1: member-services create returns 201 with existing fields/defaults and commits durably', async () => {
    const created = await request<any>('/api/companies', json('POST', { companyName: 'S01 Durable Co', industry: 'Testing' }, staffToken));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body).sort(), COMPANY_FIELDS);
    assert.equal(created.body.companyName, 'S01 Durable Co');
    assert.equal(created.body.industry, 'Testing');
    assert.equal(created.body.description, '');
    assert.equal(created.body.location, '');
    assert.equal(created.body.companySize, '');
    assert.equal(typeof created.body.id, 'string');
    assert.ok(!Number.isNaN(Date.parse(created.body.createdAt)));
    assert.ok(!Number.isNaN(Date.parse(created.body.updatedAt)));

    const persisted = (await store.readStore()).companies.find((company: any) => company.id === created.body.id);
    assert.deepEqual(persisted, created.body, 'fresh readStore() returns the committed row exactly as responded');

    const probe = await readInNewProcess();
    assert.equal(probe.code, 0, probe.stderr || probe.stdout);
    const marker = probe.stdout.split('\n').find((line) => line.startsWith('DB_PROBE:'));
    assert.ok(marker, probe.stdout);
    assert.ok(JSON.parse(marker.slice('DB_PROBE:'.length)).companyIds.includes(created.body.id), 'a new process reads the company');

    // S01-AC2 (member-services side): no unintended association.
    const staff = (await store.readStore()).users.find((user: any) => user.id === staffId);
    assert.equal(staff.companyId, undefined);

    // S01-AC5: exactly one success audit for the committed company.
    const audits = await companyAudits(created.body.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].outcome, 'success');
    assert.equal(audits[0].userId, staffId);
    assert.deepEqual(audits[0].details, { companyName: 'S01 Durable Co' });
  });

  test('S01-AC2: hiring-manager create commits the company and user.companyId together', async () => {
    const created = await request<any>('/api/companies', json('POST', { companyName: 'S01 Manager Co' }, managerToken));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body).sort(), COMPANY_FIELDS);

    const snapshot = await store.readStore();
    assert.ok(snapshot.companies.some((company: any) => company.id === created.body.id));
    const manager = snapshot.users.find((user: any) => user.id === managerId);
    assert.equal(manager.companyId, created.body.id);
    assert.equal(manager.role, 'hiring-manager', 'linking must not alter other user fields');
    assert.equal(manager.username, 's01-hiring-manager');
  });

  test('S01-AC2/AC5: forced failure on the manager link rolls back company and link with no success audit', async () => {
    const before = await store.readStore();
    const priorCompanyId = before.users.find((user: any) => user.id === managerId).companyId;
    const companyCount = before.companies.length;

    await withFailingTrigger('UPDATE', 'users', managerId, async () => {
      const failed = await request<any>('/api/companies', json('POST', { companyName: 'S01 Rollback Co' }, managerToken));
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
      assert.match(failed.body.error, /synthetic company write failure/);
      assert.equal(failed.body.id, undefined, 'no success payload on failed commit');
    });

    const after = await store.readStore();
    assert.equal(after.companies.length, companyCount);
    assert.equal(after.companies.some((company: any) => company.companyName === 'S01 Rollback Co'), false);
    assert.equal(after.users.find((user: any) => user.id === managerId).companyId, priorCompanyId);
    assert.deepEqual(await companyAudits(undefined, 'S01 Rollback Co'), []);
  });

  test('S01-AC2/AC5: forced failure on the company insert leaves the manager link unchanged', async () => {
    const priorCompanyId = (await store.readStore()).users.find((user: any) => user.id === managerId).companyId;
    await withFailingTrigger('INSERT', 'companies', null, async () => {
      const failed = await request<any>('/api/companies', json('POST', { companyName: 'S01 Insert Failure Co' }, managerToken));
      assert.equal(failed.status, 500, JSON.stringify(failed.body));
    });
    const after = await store.readStore();
    assert.equal(after.companies.some((company: any) => company.companyName === 'S01 Insert Failure Co'), false);
    assert.equal(after.users.find((user: any) => user.id === managerId).companyId, priorCompanyId);
    assert.deepEqual(await companyAudits(undefined, 'S01 Insert Failure Co'), []);
  });

  test('S01-AC3: authorized update merges into the current row and persists', async () => {
    await seedCompany('s01-update-target', 'S01 Before Update');
    const response = await request<any>('/api/companies/s01-update-target', json('PUT', { companyName: 'S01 After Update', location: 'Austin' }, managerToken));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.id, 's01-update-target');
    assert.equal(response.body.companyName, 'S01 After Update');
    assert.equal(response.body.location, 'Austin');
    assert.equal(response.body.description, 'Seeded', 'unspecified fields keep their stored values');
    assert.equal(response.body.createdAt, '2026-01-01T00:00:00.000Z');
    assert.ok(Date.parse(response.body.updatedAt) > Date.parse('2026-01-01T00:00:00.000Z'));

    const persisted = (await store.readStore()).companies.find((company: any) => company.id === 's01-update-target');
    assert.deepEqual(persisted, response.body);
  });

  test('S01-AC3: update of a missing id returns 404 and changes no row', async () => {
    const before = (await store.readStore()).companies;
    const response = await request<any>('/api/companies/s01-does-not-exist', json('PUT', { companyName: 'Ghost' }, staffToken));
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Company not found' });
    assert.deepEqual((await store.readStore()).companies, before);
  });

  test('S01-AC3: authorized delete removes the row; dependent jobs are left as before', async () => {
    await seedCompany('s01-delete-target', 'S01 Delete Me');
    await store.updateStore((current) => {
      current.jobs.push({ id: 's01-dependent-job', companyId: 's01-delete-target', jobTitle: 'Dependent', isActive: true });
    });
    const response = await request<any>('/api/companies/s01-delete-target', bare('DELETE', staffToken));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, { message: 'Company deleted' });

    const snapshot = await store.readStore();
    assert.equal(snapshot.companies.some((company: any) => company.id === 's01-delete-target'), false);
    assert.ok(snapshot.jobs.some((job: any) => job.id === 's01-dependent-job'), 'no cascade policy change');
  });

  test('S01-AC3: delete of a missing id keeps its existing response and changes no row', async () => {
    const before = await store.readStore();
    const response = await request<any>('/api/companies/s01-never-existed', bare('DELETE', staffToken));
    // Existing contract: DELETE does not distinguish a missing id (200 + same message).
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, { message: 'Company deleted' });
    const after = await store.readStore();
    assert.deepEqual(after.companies, before.companies);
    assert.deepEqual(after.jobs, before.jobs);
  });

  test('S01-AC3/F-AC4: failed update and delete commits return 500 and leave the row intact', async () => {
    await seedCompany('s01-failing-target', 'S01 Failing Target');
    const before = (await store.readStore()).companies.find((company: any) => company.id === 's01-failing-target');

    await withFailingTrigger('UPDATE', 'companies', 's01-failing-target', async () => {
      const response = await request<any>('/api/companies/s01-failing-target', json('PUT', { companyName: 'Should Not Persist' }, staffToken));
      assert.equal(response.status, 500, JSON.stringify(response.body));
      assert.match(response.body.error, /synthetic company write failure/);
    });
    assert.deepEqual((await store.readStore()).companies.find((company: any) => company.id === 's01-failing-target'), before);

    await withFailingTrigger('DELETE', 'companies', 's01-failing-target', async () => {
      const response = await request<any>('/api/companies/s01-failing-target', bare('DELETE', staffToken));
      assert.equal(response.status, 500, JSON.stringify(response.body));
      assert.match(response.body.error, /synthetic company write failure/);
    });
    assert.deepEqual((await store.readStore()).companies.find((company: any) => company.id === 's01-failing-target'), before);
  });

  test('S01-AC4: concurrent company mutations do not lose committed changes', async () => {
    await seedCompany('s01-concurrent-target', 'S01 Concurrent');
    const [description, location, ...creates] = await Promise.all([
      request<any>('/api/companies/s01-concurrent-target', json('PUT', { description: 'Concurrent description' }, staffToken)),
      request<any>('/api/companies/s01-concurrent-target', json('PUT', { location: 'Concurrent location' }, managerToken)),
      ...Array.from({ length: 8 }, (_, index) =>
        request<any>('/api/companies', json('POST', { companyName: `S01 Parallel ${index}` }, staffToken))),
    ]);
    assert.equal(description.status, 200, JSON.stringify(description.body));
    assert.equal(location.status, 200, JSON.stringify(location.body));
    for (const created of creates) assert.equal(created.status, 201, JSON.stringify(created.body));

    const snapshot = await store.readStore();
    const target = snapshot.companies.find((company: any) => company.id === 's01-concurrent-target');
    assert.equal(target.description, 'Concurrent description');
    assert.equal(target.location, 'Concurrent location');
    for (const created of creates) {
      assert.ok(snapshot.companies.some((company: any) => company.id === created.body.id), `lost ${created.body.companyName}`);
    }
    assert.equal(new Set(creates.map((created) => created.body.id)).size, creates.length);
  });

  test('S01-AC4: no company route uses writeStore', () => {
    const source = readFileSync('src/routes/companies.ts', 'utf8');
    assert.equal(/\bwriteStore\b/.test(source), false);
  });

  test('S01-AC5: direct PostgreSQL writeStore rejection remains intact', async () => {
    const snapshot = await store.readStore();
    await assert.rejects(store.writeStore(snapshot), store.LegacyWholesaleWriteError);
  });

  test('S01-AC6: role restrictions and auth errors are unchanged and write nothing', async () => {
    const recruiter = await registerUser('s01-other-role', 'recruiter');
    const before = await store.readStore();
    await seedCompany('s01-auth-target', 'S01 Auth Target');
    const seeded = await store.readStore();

    const unauthCreate = await request<any>('/api/companies', json('POST', { companyName: 'S01 Unauth' }));
    assert.equal(unauthCreate.status, 401);
    assert.deepEqual(unauthCreate.body, { error: 'No authentication token provided' });

    const forbiddenCreate = await request<any>('/api/companies', json('POST', { companyName: 'S01 Forbidden' }, recruiter.token));
    assert.equal(forbiddenCreate.status, 403);
    assert.deepEqual(forbiddenCreate.body, { error: 'Insufficient permissions' });

    const forbiddenUpdate = await request<any>('/api/companies/s01-auth-target', json('PUT', { companyName: 'Nope' }, recruiter.token));
    assert.equal(forbiddenUpdate.status, 403);

    const managerDelete = await request<any>('/api/companies/s01-auth-target', bare('DELETE', managerToken));
    assert.equal(managerDelete.status, 403);
    assert.deepEqual(managerDelete.body, { error: 'Insufficient permissions' });

    const unauthDelete = await request<any>('/api/companies/s01-auth-target', bare('DELETE'));
    assert.equal(unauthDelete.status, 401);
    assert.deepEqual(unauthDelete.body, { error: 'No authentication token provided' });

    const after = await store.readStore();
    assert.deepEqual(after.companies, seeded.companies);
    assert.equal(after.companies.length, before.companies.length + 1);
    assert.equal(after.users.find((user: any) => user.id === recruiter.id).companyId, undefined);
    assert.deepEqual(await companyAudits(undefined, 'S01 Forbidden'), []);
  });
});
