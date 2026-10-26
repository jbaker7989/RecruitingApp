/**
 * story-bug-applicant-passwordhash-pii-leak
 *
 * `passwordHash` and `oauthProviderId` are credentials/identifiers and must
 * never be returned to clients or accepted from client input. Acceptance
 * criteria map to the story in docs/stories/story-bug-applicant-passwordhash-pii-leak.md:
 *
 * - AC1 GET /api/applicants/:id omits passwordHash and oauthProviderId
 * - AC2 PUT /api/applicants/:id with passwordHash -> 400, nothing persisted
 * - AC3 POST /api/applicants ignores a client-supplied passwordHash
 * - AC4 unauthenticated GET /api/applicants/:id -> 401
 * - AC5 cross-applicant (or unauthorized staff) GET /api/applicants/:id -> 403
 *
 * Supporting cases cover the successful PUT allow-list, cross-applicant PUT,
 * GET/PATCH /api/applicants/me sanitization, and PATCH /me credential injection.
 *
 * Synthetic store only: a temp DATA_DIR is seeded per test; no network or provider.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let server: { address(): { port: number } | string | null; close(): void } | undefined;
let baseUrl: string;
let tokens: {
  alice: string;
  bob: string;
  recruiter: string;
  memberServices: string;
};

const STORED_HASH = 'sha256-original-hash-value';
const BOB_HASH = 'sha256-bob-hash-value';
const ALICE_ID = 'app-1';
const BOB_ID = 'app-2';

function seedStore() {
  const base = {
    firstName: 'Alice',
    lastName: 'Applicant',
    email: 'alice@test.com',
    preferredContactMethod: 'email',
    address: { state: 'CA', zip: '94102' },
    educationHistory: [],
    employmentHistory: [],
    rightToWork: true,
    requiresSponsorship: false,
    expectedPay: 0,
    notificationToManager: false,
    hireRecords: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  writeFileSync(
    join(dataDir, 'store.json'),
    JSON.stringify({
      companies: [],
      jobs: [],
      applicants: [
        {
          ...base,
          id: ALICE_ID,
          passwordHash: STORED_HASH,
          phone: '555-0000',
          oauthProvider: 'google',
          oauthProviderId: 'google-123',
        },
        {
          ...base,
          id: BOB_ID,
          firstName: 'Bob',
          lastName: 'Builder',
          email: 'bob@test.com',
          passwordHash: BOB_HASH,
          phone: '555-0001',
          oauthProvider: null,
          oauthProviderId: null,
        },
      ],
      applications: [],
      users: [],
      hires: [],
      observability: [],
      drafts: [],
    }),
  );
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
}

function readPersisted(id: string): Record<string, unknown> {
  const record = JSON.parse(readFileSync(join(dataDir, 'store.json'), 'utf-8'));
  const applicant = record.applicants.find((a: { id: string }) => a.id === id);
  assert.ok(applicant, `applicant ${id} must still exist in the store`);
  return applicant as Record<string, unknown>;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'pii-leak-'));
  seedStore();
  process.env.DATA_DIR = dataDir;

  const { app } = await import('../../src/index.js');
  const { signApplicantToken, signUserToken } = await import('../../src/services/tokenService.js');
  tokens = {
    alice: await signApplicantToken(ALICE_ID, true),
    bob: await signApplicantToken(BOB_ID, true),
    recruiter: await signUserToken('user-recruiter-1', 'recruiter', 'company-1'),
    memberServices: await signUserToken('user-ms-1', 'member-services'),
  };
  server = app.listen(0);
  const addr = server.address();
  baseUrl = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

beforeEach(async () => {
  // Each test starts from the same seed so assertions are order-independent.
  seedStore();
  const { resetRevocationState } = await import('../../src/services/revocationService.js');
  resetRevocationState();
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

type Result = { status: number; text: string; json: Record<string, unknown> | null };

async function send(method: string, path: string, opts: { token?: string; body?: object } = {}): Promise<Result> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function assertNoCredentials(result: Result, label: string) {
  assert.equal(Object.hasOwn(result.json ?? {}, 'passwordHash'), false, `${label}: passwordHash key must be absent`);
  assert.equal(Object.hasOwn(result.json ?? {}, 'oauthProviderId'), false, `${label}: oauthProviderId key must be absent`);
  assert.equal(result.text.includes(STORED_HASH), false, `${label}: stored hash must not appear in body`);
  assert.equal(result.text.includes(BOB_HASH), false, `${label}: other applicant hash must not appear in body`);
}

// ─── AC4: unauthenticated GET is rejected ─────────────────────────────────────

test('AC4: unauthenticated GET /api/applicants/:id returns 401 and no record', async () => {
  const res = await send('GET', `/api/applicants/${ALICE_ID}`);
  assert.equal(res.status, 401);
  assertNoCredentials(res, 'unauthenticated GET');
  assert.equal(res.json?.firstName, undefined, 'no profile data may be returned without auth');
});

// ─── AC1: authorized GET is sanitized ─────────────────────────────────────────

test('AC1: GET /api/applicants/:id by the applicant themself returns 200 without credentials', async () => {
  const res = await send('GET', `/api/applicants/${ALICE_ID}`, { token: tokens.alice });
  assert.equal(res.status, 200);
  assert.equal(res.json?.firstName, 'Alice');
  assertNoCredentials(res, 'own GET');
});

test('AC1: GET /api/applicants/:id by member-services staff returns 200 without credentials', async () => {
  const res = await send('GET', `/api/applicants/${ALICE_ID}`, { token: tokens.memberServices });
  assert.equal(res.status, 200);
  assert.equal(res.json?.firstName, 'Alice');
  assertNoCredentials(res, 'member-services GET');
});

// ─── AC5: cross-applicant and unauthorized staff are forbidden ────────────────

test('AC5: GET /api/applicants/:id by a different applicant returns 403 without credentials', async () => {
  const res = await send('GET', `/api/applicants/${ALICE_ID}`, { token: tokens.bob });
  assert.equal(res.status, 403);
  assert.equal(res.json?.firstName, undefined, 'no profile data may be returned to another applicant');
  assertNoCredentials(res, 'cross-applicant GET');
});

test('AC5: GET /api/applicants/:id by recruiter staff (not member-services) returns 403', async () => {
  const res = await send('GET', `/api/applicants/${ALICE_ID}`, { token: tokens.recruiter });
  assert.equal(res.status, 403);
  assert.equal(res.json?.firstName, undefined, 'no profile data may be returned to unauthorized staff');
  assertNoCredentials(res, 'unauthorized staff GET');
});

// ─── AC2: PUT rejects passwordHash and persists nothing ───────────────────────

test('AC2: PUT /api/applicants/:id with passwordHash returns 400 and does not persist it', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.alice,
    body: { firstName: 'Mallory', passwordHash: 'attacker-controlled-hash' },
  });
  assert.equal(res.status, 400, 'PUT with passwordHash must be rejected');

  const applicant = readPersisted(ALICE_ID);
  assert.equal(applicant.passwordHash, STORED_HASH, 'passwordHash must be unchanged');
  assert.equal(applicant.firstName, 'Alice', 'rejected request must not change any field');
});

test('AC2: PUT /api/applicants/:id with passwordHash by another applicant is rejected and not persisted', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.bob,
    body: { passwordHash: 'attacker-controlled-hash' },
  });
  assert.equal(res.status, 403);
  assert.equal(readPersisted(ALICE_ID).passwordHash, STORED_HASH);
});

// ─── Successful PUT: sanitized response, allow-listed persistence ─────────────

const INJECTED_PUT_BODY = {
  firstName: 'Alicia',
  phone: '555-9999',
  id: 'app-hijacked',
  oauthProvider: 'facebook',
  oauthProviderId: 'attacker-provider-id',
  hireRecords: [{ id: 'fake-hire' }],
  createdAt: '1999-01-01T00:00:00.000Z',
  unknownField: 'not-a-profile-field',
};

test('PUT /api/applicants/:id by the owner returns 200 with a sanitized view', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.alice,
    body: INJECTED_PUT_BODY,
  });
  assert.equal(res.status, 200);
  assertNoCredentials(res, 'successful PUT response');
  assert.equal(res.json?.firstName, 'Alicia');
});

test('PUT /api/applicants/:id by the owner persists only allow-listed fields', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.alice,
    body: INJECTED_PUT_BODY,
  });
  assert.equal(res.status, 200);

  const applicant = readPersisted(ALICE_ID);
  assert.equal(applicant.firstName, 'Alicia', 'allow-listed profile field must persist');
  assert.equal(applicant.phone, '555-9999', 'allow-listed profile field must persist');
  assert.equal(applicant.id, ALICE_ID, 'id must not be overwritten');
  assert.equal(applicant.oauthProvider, 'google', 'oauthProvider must not be overwritten');
  assert.equal(applicant.oauthProviderId, 'google-123', 'oauthProviderId must not be overwritten');
  assert.deepEqual(applicant.hireRecords, [], 'hireRecords must not be injected');
  assert.equal(applicant.createdAt, '2026-01-01T00:00:00.000Z', 'createdAt must not be overwritten');
  assert.equal(applicant.passwordHash, STORED_HASH, 'passwordHash must be unchanged');
  assert.equal(Object.hasOwn(applicant, 'unknownField'), false, 'non-allow-listed field must not persist');
});

test('PUT /api/applicants/:id by another applicant returns 403 and changes nothing', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.bob,
    body: { firstName: 'Mallory' },
  });
  assert.equal(res.status, 403);
  assert.equal(readPersisted(ALICE_ID).firstName, 'Alice');
});

test('PUT /api/applicants/:id without a token returns 401 and changes nothing', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, { body: { firstName: 'Mallory' } });
  assert.equal(res.status, 401);
  assert.equal(readPersisted(ALICE_ID).firstName, 'Alice');
});

test('PUT /api/applicants/:id by member-services updates a profile without exposing credentials', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.memberServices,
    body: { firstName: 'Alicia' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json?.firstName, 'Alicia');
  assertNoCredentials(res, 'member-services PUT');
  assert.equal(readPersisted(ALICE_ID).firstName, 'Alicia');
  assert.equal(readPersisted(ALICE_ID).passwordHash, STORED_HASH);
});

test('PUT /api/applicants/:id rejects an invalid profile field without partial persistence', async () => {
  const res = await send('PUT', `/api/applicants/${ALICE_ID}`, {
    token: tokens.alice,
    body: { firstName: 'Alicia', address: { state: 'NY', zip: 10001 } },
  });
  assert.equal(res.status, 400);
  assert.equal(readPersisted(ALICE_ID).firstName, 'Alice');
  assert.deepEqual(readPersisted(ALICE_ID).address, { state: 'CA', zip: '94102' });
});

// ─── AC3: POST ignores attacker-supplied passwordHash ─────────────────────────

test('AC3: POST /api/applicants ignores client-supplied passwordHash and does not echo credentials', async () => {
  const res = await send('POST', '/api/applicants', {
    body: {
      firstName: 'Carol',
      lastName: 'Creator',
      email: 'carol@test.com',
      passwordHash: 'attacker-wants-this-persisted',
      phone: '555-0002',
      address: { state: 'CA', zip: '94102' },
      educationHistory: [{ institution: 'X', degree: 'B', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024' }],
      employmentHistory: [{ company: 'Y', position: 'Dev', startDate: '2024', endDate: '2025' }],
      rightToWork: true,
    },
  });
  assert.equal(res.status, 201, 'legacy create should succeed');
  assert.equal(Object.hasOwn(res.json ?? {}, 'passwordHash'), false, 'response must not carry a passwordHash key');
  assert.equal(res.text.includes('attacker-wants-this-persisted'), false, 'attacker hash must not be echoed');

  const createdId = res.json?.id as string;
  const persisted = readPersisted(createdId);
  assert.equal(persisted.passwordHash, null, 'stored hash must be server-side only (null for legacy create)');
  assert.equal(persisted.oauthProviderId, null, 'oauthProviderId must not be client-settable');
});

test('POST /api/applicants drops nested credential fields from stored profile data', async () => {
  const res = await send('POST', '/api/applicants', {
    body: {
      firstName: 'Carol', lastName: 'Creator', email: 'carol@test.com', phone: '555-0002',
      address: { state: 'CA', zip: '94102', passwordHash: NESTED_ATTACK },
      educationHistory: [{ institution: 'X', degree: 'B', fieldOfStudy: 'CS', startDate: '2020', endDate: '2024', oauthProviderId: NESTED_ATTACK }],
      employmentHistory: [{ company: 'Y', position: 'Dev', startDate: '2024', endDate: '2025', passwordHash: NESTED_ATTACK }],
      rightToWork: true,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.text.includes(NESTED_ATTACK), false);
  assert.equal(JSON.stringify(readPersisted(res.json?.id as string)).includes(NESTED_ATTACK), false);
});

// ─── /me: GET sanitized, PATCH cannot inject credential or identity fields ────

test('GET /api/applicants/me returns 200 without passwordHash or oauthProviderId', async () => {
  const res = await send('GET', '/api/applicants/me', { token: tokens.alice });
  assert.equal(res.status, 200);
  assert.equal(res.json?.firstName, 'Alice');
  assertNoCredentials(res, 'GET /me');
});

const INJECTED_PATCH_BODY = {
  firstName: 'Alicia',
  passwordHash: 'attacker-controlled-hash',
  oauthProviderId: 'attacker-provider-id',
  oauthProvider: 'facebook',
  id: 'app-hijacked',
  hireRecords: [{ id: 'fake-hire' }],
};

test('PATCH /api/applicants/me returns 200 with a sanitized view when credential fields are injected', async () => {
  const res = await send('PATCH', '/api/applicants/me', {
    token: tokens.alice,
    body: INJECTED_PATCH_BODY,
  });
  assert.equal(res.status, 200);
  assertNoCredentials(res, 'PATCH /me response');
  assert.equal(res.json?.firstName, 'Alicia');
});

test('PATCH /api/applicants/me cannot inject credential or identity fields', async () => {
  const res = await send('PATCH', '/api/applicants/me', {
    token: tokens.alice,
    body: INJECTED_PATCH_BODY,
  });
  assert.equal(res.status, 200);

  const applicant = readPersisted(ALICE_ID);
  assert.equal(applicant.firstName, 'Alicia', 'allow-listed profile field must persist');
  assert.equal(applicant.passwordHash, STORED_HASH, 'passwordHash must not be injected via PATCH /me');
  assert.equal(applicant.oauthProviderId, 'google-123', 'oauthProviderId must not be injected via PATCH /me');
  assert.equal(applicant.oauthProvider, 'google', 'oauthProvider must not be injected via PATCH /me');
  assert.equal(applicant.id, ALICE_ID, 'id must not be injected via PATCH /me');
  assert.deepEqual(applicant.hireRecords, [], 'hireRecords must not be injected via PATCH /me');
});

const NESTED_ATTACK = 'nested-attacker-hash';
const NESTED_INJECTED_PATCH_BODY = {
  address: { state: 'NY', zip: '10001', passwordHash: NESTED_ATTACK, oauthProviderId: NESTED_ATTACK },
  educationHistory: [
    {
      institution: 'Uni',
      degree: 'BS',
      fieldOfStudy: 'CS',
      startDate: '2015',
      endDate: '2019',
      passwordHash: NESTED_ATTACK,
    },
  ],
  employmentHistory: [
    {
      company: 'Acme',
      position: 'Engineer',
      startDate: '2019',
      endDate: '2024',
      responsibilities: ['build'],
      oauthProviderId: NESTED_ATTACK,
    },
  ],
};

test('PATCH /api/applicants/me drops nested credential fields from address and history on persist and response', async () => {
  const res = await send('PATCH', '/api/applicants/me', {
    token: tokens.alice,
    body: NESTED_INJECTED_PATCH_BODY,
  });
  assert.equal(res.status, 200);
  assertNoCredentials(res, 'nested PATCH /me response');
  assert.equal(res.text.includes(NESTED_ATTACK), false, 'nested attacker value must not be echoed');
  assert.deepEqual(res.json?.address, { state: 'NY', zip: '10001' }, 'response address must be allow-listed');

  const applicant = readPersisted(ALICE_ID);
  assert.deepEqual(applicant.address, { state: 'NY', zip: '10001' }, 'persisted address must be allow-listed');
  assert.deepEqual(
    applicant.educationHistory,
    [{ institution: 'Uni', degree: 'BS', fieldOfStudy: 'CS', startDate: '2015', endDate: '2019' }],
    'persisted education entries must drop nested credential fields',
  );
  assert.deepEqual(
    applicant.employmentHistory,
    [{ company: 'Acme', position: 'Engineer', startDate: '2019', endDate: '2024', responsibilities: ['build'] }],
    'persisted employment entries must drop nested credential fields',
  );
  assert.equal(JSON.stringify(applicant).includes(NESTED_ATTACK), false, 'nested attacker value must not persist anywhere');
});

test('PATCH /api/applicants/me rejects null email without locking the owner out', async () => {
  const update = await send('PATCH', '/api/applicants/me', {
    token: tokens.alice,
    body: { email: null },
  });
  assert.equal(update.status, 400);
  assert.equal(readPersisted(ALICE_ID).email, 'alice@test.com');

  const profile = await send('GET', '/api/applicants/me', { token: tokens.alice });
  assert.equal(profile.status, 200);
  assert.equal(profile.json?.email, 'alice@test.com');
});

test('a revoked applicant token cannot read or update either profile route', async () => {
  const logout = await send('POST', '/api/applicants/logout', { token: tokens.alice });
  assert.equal(logout.status, 200);

  const requests = await Promise.all([
    send('GET', `/api/applicants/${ALICE_ID}`, { token: tokens.alice }),
    send('PUT', `/api/applicants/${ALICE_ID}`, { token: tokens.alice, body: { firstName: 'Alicia' } }),
    send('PATCH', '/api/applicants/me', { token: tokens.alice, body: { firstName: 'Alicia' } }),
  ]);
  for (const res of requests) assert.equal(res.status, 401);
  assert.equal(readPersisted(ALICE_ID).firstName, 'Alice');
});

test('PATCH /api/applicants/me accepts a current job without an end date', async () => {
  const update = await send('PATCH', '/api/applicants/me', {
    token: tokens.alice,
    body: { employmentHistory: [{ company: 'Synthetic Co', position: 'Engineer', startDate: '2025-01' }] },
  });
  assert.equal(update.status, 200);
  const persisted = readPersisted(ALICE_ID).employmentHistory as Array<Record<string, unknown>>;
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].company, 'Synthetic Co');
  assert.ok(persisted[0].endDate === undefined || persisted[0].endDate === '');
});
