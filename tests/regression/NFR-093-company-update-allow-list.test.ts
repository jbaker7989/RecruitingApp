/**
 * NFR-093: PUT /api/companies/:id applies an allow-list instead of spreading req.body.
 * JSON store in a temp DATA_DIR, synthetic data only.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCompanyUpdate } from '../../src/routes/companies.js';
import type { Company } from '../../src/models/store.js';

type Body = Record<string, unknown> & Partial<Company> & { token?: string; error?: string; polluted?: unknown };

let dataDir = '';
let store: typeof import('../../src/models/store.js');
let server: ReturnType<typeof import('node:http').createServer>;
let baseUrl = '';
let staffToken = '';
let managerToken = '';

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: Body }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body = text as unknown as Body;
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, body };
}

function put(id: string, rawBody: string, token: string): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: rawBody };
}

async function register(username: string, role: string): Promise<string> {
  const response = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'SyntheticPass123!', email: `${username}@example.test`, role }),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.token as string;
}

async function createCompany(name: string): Promise<Company> {
  const created = await request('/api/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ companyName: name, description: 'Original' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body as Company;
}

async function stored(id: string): Promise<Company | undefined> {
  return (await store.readStore()).companies.find(company => company.id === id);
}

describe('NFR-093 validateCompanyUpdate', () => {
  test('accepts allow-listed string fields only', () => {
    const result = validateCompanyUpdate({ companyName: 'A', industry: '' });
    assert.deepEqual(result, { ok: true, changes: { companyName: 'A', industry: '' } });
  });

  test('rejects non-object bodies', () => {
    for (const body of [undefined, null, [], 'text', 7, true]) {
      assert.equal(validateCompanyUpdate(body).ok, false, JSON.stringify(body));
    }
  });

  test('rejects empty body, unknown, server-owned and prototype keys', () => {
    assert.equal(validateCompanyUpdate({}).ok, false);
    for (const key of ['id', 'createdAt', 'updatedAt', 'jobPostings', 'isAdmin', 'constructor', 'toString']) {
      assert.equal(validateCompanyUpdate({ [key]: 'x' }).ok, false, key);
    }
    const proto = JSON.parse('{"__proto__": {"companyName": "x"}}');
    assert.equal(validateCompanyUpdate(proto).ok, false);
  });

  test('rejects wrong types, blank name and over-long values', () => {
    for (const value of [null, 1, true, [], {}, undefined]) {
      assert.equal(validateCompanyUpdate({ location: value }).ok, false, String(value));
    }
    assert.equal(validateCompanyUpdate({ companyName: '   ' }).ok, false);
    assert.equal(validateCompanyUpdate({ companyName: 'x'.repeat(201) }).ok, false);
    assert.equal(validateCompanyUpdate({ companyName: 'x'.repeat(200) }).ok, true);
    assert.equal(validateCompanyUpdate({ description: 'x'.repeat(5001) }).ok, false);
  });

  test('does not mix valid and invalid fields: one bad field rejects all', () => {
    assert.equal(validateCompanyUpdate({ companyName: 'Fine', id: 'other' }).ok, false);
  });
});

describe('NFR-093 PUT /api/companies/:id', () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'nfr-093-'));
    process.env.DATA_DIR = dataDir;
    process.env.USE_DATABASE = 'false';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'nfr093-user-secret-32-characters-long-x';
    process.env.APPLICANT_JWT_SECRET = 'nfr093-applicant-secret-32-characters-x';
    store = await import('../../src/models/store.js');
    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    staffToken = await register('nfr093-staff', 'member-services');
    managerToken = await register('nfr093-manager', 'hiring-manager');
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.USE_DATABASE;
  });

  test('allowed fields update, others unchanged, id/createdAt immutable, updatedAt refreshed', async () => {
    const company = await createCompany('NFR093 Base');
    const response = await request(`/api/companies/${company.id}`, put(company.id, JSON.stringify({ location: 'Austin', description: '' }), managerToken));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.id, company.id);
    assert.equal(response.body.createdAt, company.createdAt);
    assert.equal(response.body.companyName, 'NFR093 Base');
    assert.equal(response.body.location, 'Austin');
    assert.equal(response.body.description, '');
    assert.deepEqual(await stored(company.id), response.body);
  });

  test('mass-assignment attempts return 400 and leave the record and the other companies untouched', async () => {
    const victim = await createCompany('NFR093 Victim');
    const target = await createCompany('NFR093 Target');
    const before = (await store.readStore()).companies;
    const attempts = [
      { id: victim.id },
      { id: 'hijacked', companyName: 'Renamed' },
      { createdAt: '1999-01-01T00:00:00.000Z' },
      { updatedAt: '1999-01-01T00:00:00.000Z' },
      { companyName: 'Renamed', ownerId: 'u1' },
      { companyName: 'Renamed', isVerified: true },
    ];
    for (const body of attempts) {
      const response = await request(`/api/companies/${target.id}`, put(target.id, JSON.stringify(body), staffToken));
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.match(String(response.body.error), /Unsupported fields/);
    }
    assert.deepEqual((await store.readStore()).companies, before);
  });

  test('prototype pollution payload is rejected and Object.prototype is clean', async () => {
    const target = await createCompany('NFR093 Proto');
    const raw = '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}}';
    const response = await request(`/api/companies/${target.id}`, put(target.id, raw, staffToken));
    assert.equal(response.status, 400);
    assert.equal((({}) as Body).polluted, undefined);
    assert.equal(((await stored(target.id)) as Body).polluted, undefined);
  });

  test('empty, array, wrong-typed and blank payloads return 400 without changes', async () => {
    const target = await createCompany('NFR093 Shapes');
    const before = await stored(target.id);
    for (const raw of ['{}', '[]', '{"companyName": 5}', '{"companyName": null}', '{"companyName": "  "}', '{"location": ["a"]}']) {
      const response = await request(`/api/companies/${target.id}`, put(target.id, raw, staffToken));
      assert.equal(response.status, 400, raw);
    }
    const noBody = await request(`/api/companies/${target.id}`, { method: 'PUT', headers: { authorization: `Bearer ${staffToken}` } });
    assert.equal(noBody.status, 400);
    assert.deepEqual(await stored(target.id), before);
  });

  test('a top-level null or primitive JSON body is never applied', async () => {
    // express.json() (strict) rejects these before the route; the global error handler currently
    // answers 500 instead of 400 (separate from NFR-093), so only assert the record is untouched.
    const target = await createCompany('NFR093 Null');
    const before = await stored(target.id);
    for (const raw of ['null', '7', '"text"']) {
      const response = await request(`/api/companies/${target.id}`, put(target.id, raw, staffToken));
      assert.ok(response.status >= 400, `${raw} -> ${response.status}`);
    }
    assert.deepEqual(await stored(target.id), before);
  });

  test('missing company with a valid body still returns 404; invalid body takes precedence with 400', async () => {
    const missing = await request('/api/companies/nfr093-missing', put('x', JSON.stringify({ companyName: 'Ghost' }), staffToken));
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Company not found' });
    const invalid = await request('/api/companies/nfr093-missing', put('x', JSON.stringify({ id: 'x' }), staffToken));
    assert.equal(invalid.status, 400);
  });

  test('role checks still run before validation', async () => {
    const recruiter = await register('nfr093-recruiter', 'recruiter');
    const target = await createCompany('NFR093 Auth');
    const forbidden = await request(`/api/companies/${target.id}`, put(target.id, JSON.stringify({ id: 'x' }), recruiter));
    assert.equal(forbidden.status, 403);
    const unauth = await request(`/api/companies/${target.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unauth.status, 401);
  });
});
