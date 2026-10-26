/**
 * NFR-DATA-002-S01 JSON parity: the updateStore-based company routes keep their
 * JSON-store behavior. Forces USE_DATABASE=false with a temp DATA_DIR so it is
 * isolated even when the PostgreSQL gate exports DATABASE_URL. Synthetic data only.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMPANY_FIELDS = ['companyName', 'companySize', 'createdAt', 'description', 'id', 'industry', 'location', 'updatedAt'];

let dataDir = '';
let store: typeof import('../../src/models/store.js');
let server: any;
let baseUrl = '';
let staffToken = '';
let staffId = '';
let managerToken = '';
let managerId = '';

async function request<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body: body as T };
}

function json(method: string, body: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

describe('NFR-DATA-002-S01 JSON-mode company write parity', () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'nfr-s01-company-json-'));
    process.env.DATA_DIR = dataDir;
    process.env.USE_DATABASE = 'false';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'company-json-user-secret-32-characters-long';
    process.env.APPLICANT_JWT_SECRET = 'company-json-applicant-secret-32-characters';

    store = await import('../../src/models/store.js');
    assert.equal(store.getStoreMode(), 'json');
    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    ({ token: staffToken, id: staffId } = await registerUser('s01-json-staff', 'member-services'));
    ({ token: managerToken, id: managerId } = await registerUser('s01-json-manager', 'hiring-manager'));
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.USE_DATABASE;
  });

  test('S01-AC1/AC5 (JSON): member-services create keeps response shape, persists, audits, no association', async () => {
    const created = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Co' }, staffToken));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body).sort(), COMPANY_FIELDS);
    assert.equal(created.body.description, '');
    assert.equal(created.body.location, '');
    assert.equal(created.body.companySize, '');
    assert.equal(created.body.industry, '');

    const snapshot = await store.readStore();
    assert.deepEqual(snapshot.companies.find((company: any) => company.id === created.body.id), created.body);
    assert.equal(snapshot.users.find((user: any) => user.id === staffId).companyId, undefined);

    const audits = (await store.readObservability()).filter((entry: any) =>
      entry.entityType === 'Company' && entry.action === 'create' && entry.entityId === created.body.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].userId, staffId);
  });

  test('S01-AC2 (JSON): hiring-manager create links user.companyId', async () => {
    const created = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Manager Co' }, managerToken));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const manager = (await store.readStore()).users.find((user: any) => user.id === managerId);
    assert.equal(manager.companyId, created.body.id);
  });

  test('S01-AC3 (JSON): update, missing update, delete, missing delete keep existing responses', async () => {
    const created = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Target', description: 'Kept' }, staffToken));
    assert.equal(created.status, 201);
    const id = created.body.id;

    const updated = await request<any>(`/api/companies/${id}`, json('PUT', { companyName: 'S01 JSON Renamed' }, managerToken));
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.companyName, 'S01 JSON Renamed');
    assert.equal(updated.body.description, 'Kept');
    assert.deepEqual((await store.readStore()).companies.find((company: any) => company.id === id), updated.body);

    const before = (await store.readStore()).companies;
    const missingUpdate = await request<any>('/api/companies/s01-json-missing', json('PUT', { companyName: 'Ghost' }, staffToken));
    assert.equal(missingUpdate.status, 404);
    assert.deepEqual(missingUpdate.body, { error: 'Company not found' });
    assert.deepEqual((await store.readStore()).companies, before);

    const missingDelete = await request<any>('/api/companies/s01-json-missing', bare('DELETE', staffToken));
    assert.equal(missingDelete.status, 200);
    assert.deepEqual(missingDelete.body, { message: 'Company deleted' });
    assert.deepEqual((await store.readStore()).companies, before);

    const deleted = await request<any>(`/api/companies/${id}`, bare('DELETE', staffToken));
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { message: 'Company deleted' });
    assert.equal((await store.readStore()).companies.some((company: any) => company.id === id), false);
  });

  test('S01-AC4 (JSON): concurrent creates and updates are all retained', async () => {
    const target = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Concurrent' }, staffToken));
    const results = await Promise.all([
      request<any>(`/api/companies/${target.body.id}`, json('PUT', { description: 'Parallel description' }, staffToken)),
      request<any>(`/api/companies/${target.body.id}`, json('PUT', { location: 'Parallel location' }, managerToken)),
      ...Array.from({ length: 6 }, (_, index) =>
        request<any>('/api/companies', json('POST', { companyName: `S01 JSON Parallel ${index}` }, staffToken))),
    ]);
    const [description, location, ...creates] = results;
    assert.equal(description.status, 200);
    assert.equal(location.status, 200);
    const snapshot = await store.readStore();
    const stored = snapshot.companies.find((company: any) => company.id === target.body.id);
    assert.equal(stored.description, 'Parallel description');
    assert.equal(stored.location, 'Parallel location');
    for (const created of creates) {
      assert.equal(created.status, 201);
      assert.ok(snapshot.companies.some((company: any) => company.id === created.body.id));
    }
  });

  test('S01-AC6 (JSON): role restrictions and auth errors are unchanged', async () => {
    const recruiter = await registerUser('s01-json-recruiter', 'recruiter');
    const target = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Auth' }, staffToken));
    const before = (await store.readStore()).companies;

    const unauth = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Unauth' }));
    assert.equal(unauth.status, 401);
    assert.deepEqual(unauth.body, { error: 'No authentication token provided' });
    const forbiddenCreate = await request<any>('/api/companies', json('POST', { companyName: 'S01 JSON Forbidden' }, recruiter.token));
    assert.equal(forbiddenCreate.status, 403);
    assert.deepEqual(forbiddenCreate.body, { error: 'Insufficient permissions' });
    const forbiddenUpdate = await request<any>(`/api/companies/${target.body.id}`, json('PUT', { companyName: 'Nope' }, recruiter.token));
    assert.equal(forbiddenUpdate.status, 403);
    const managerDelete = await request<any>(`/api/companies/${target.body.id}`, bare('DELETE', managerToken));
    assert.equal(managerDelete.status, 403);
    assert.deepEqual(managerDelete.body, { error: 'Insufficient permissions' });

    assert.deepEqual((await store.readStore()).companies, before);
  });
});
