/**
 * NFR-FEAT-001 — Applicant Profile, Phase 1 (foundation/core profile)
 *
 * All tests are written before implementation and must fail in the Red phase.
 * Coverage: AC-001, AC-003/visibility policy, AC-004, AC-005, AC-009,
 * AC-010, AC-011 and ownership/mass-assignment safeguards.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let store: typeof import('../../src/models/store.js');
let server: Server;
let baseUrl: string;

const APPLICANT = {
  id: 'u-app-1', username: 'applicant1', passwordHash: 'encrypted_pw', role: 'applicant',
  email: 'jane@example.com', createdAt: '2026-09-12T00:00:00.000Z', oauthProvider: null,
};
const APPLICANT_2 = {
  id: 'u-app-2', username: 'applicant2', passwordHash: 'encrypted_pw', role: 'applicant',
  email: 'alex@example.com', createdAt: '2026-09-12T00:00:00.000Z', oauthProvider: null,
};
const RECRUITER = {
  id: 'u-rec-1', username: 'recruiter1', passwordHash: 'encrypted_pw', role: 'recruiter',
  email: 'recruiter@example.com', createdAt: '2026-09-12T00:00:00.000Z', oauthProvider: null,
};

function initialStore(overrides: Record<string, unknown> = {}) {
  return {
    companies: [], jobs: [], applicants: [], applications: [], hires: [], observability: [],
    users: [structuredClone(APPLICANT), structuredClone(APPLICANT_2), structuredClone(RECRUITER)],
    ...overrides,
  } as any;
}

function profileBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com',
    emailConfirmation: 'jane@example.com', phone: '+12125550123',
    preferredContactMethod: 'email',
    address: { state: 'NY', zip: '10001', country: 'US' },
    rightToWork: true, requiresSponsorship: false,
    ...overrides,
  };
}

function employmentBody(overrides: Record<string, unknown> = {}) {
  return {
    company: 'Example Corp', position: 'Software Engineer',
    positionDescription: 'Designed and maintained reliable recruiting workflow services for enterprise customers.',
    startDate: '2021-01', endDate: '2024-02', currentPosition: false,
    responsibilities: ['Designed backend services'],
    accomplishments: ['Reduced processing time by 30%'],
    skills: ['TypeScript', 'Node.js'], employmentType: 'full-time',
    location: 'New York, NY', workMode: 'hybrid',
    ...overrides,
  };
}

async function api(path: string, token = APPLICANT.id, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
}

async function createProfile(body = profileBody(), token = APPLICANT.id) {
  return api('/api/applicants/profile', token, { method: 'POST', body: JSON.stringify(body) });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr-feat-001-core-'));
  process.env.DATA_DIR = dataDir;
  store = await import('../../src/models/store.js');
  const { app } = await import('../../src/index.js');
  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

beforeEach(async () => {
  await store.writeStore(initialStore());
  await store.writeObservability([]);
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

test('NFR-FEAT-001 AC-001: applicant creates one owned profile with neutral race-agnostic default icon', async () => {
  const res = await createProfile();
  assert.equal(res.status, 201, await res.clone().text());
  const profile = await res.json() as any;

  assert.equal(profile.userId, APPLICANT.id);
  assert.ok(profile.personId);
  assert.equal(profile.avatar.kind, 'default-person-icon');
  assert.equal(profile.avatar.icon, 'person');
  assert.equal(profile.avatar.race, undefined, 'avatar must not store/infer race');
  assert.deepEqual(profile.contactVisibility, {
    email: 'authorized-staff', phone: 'post-initial-review',
  });

  const saved = await store.readStore();
  assert.equal(saved.users.find((u: any) => u.id === APPLICANT.id)?.applicantId, profile.id);
});

test('NFR-FEAT-001 AC-001: duplicate profile, staff creation, and cross-applicant mutation are denied', async () => {
  const first = await createProfile();
  assert.equal(first.status, 201, await first.clone().text());
  const profile = await first.json() as any;

  const duplicate = await createProfile();
  assert.equal(duplicate.status, 409);

  const staffAttempt = await createProfile(
    profileBody({ email: RECRUITER.email, emailConfirmation: RECRUITER.email }),
    RECRUITER.id,
  );
  assert.equal(staffAttempt.status, 403);

  const crossUpdate = await api(`/api/applicants/${profile.id}`, APPLICANT_2.id, {
    method: 'PUT', body: JSON.stringify({ firstName: 'Hijacked' }),
  });
  assert.equal(crossUpdate.status, 403, 'another applicant must not mutate the profile via legacy endpoint');

  const crossRead = await api(`/api/applicants/${profile.id}`, APPLICANT_2.id);
  assert.equal(crossRead.status, 403, 'another applicant must not read the profile via legacy endpoint');

  const recruiterRead = await api(`/api/applicants/${profile.id}`, RECRUITER.id);
  assert.equal(recruiterRead.status, 200);
  const recruiterView = await recruiterRead.json() as any;
  assert.equal(recruiterView.firstName, 'Jane');
  assert.equal(recruiterView.email, APPLICANT.email);
  assert.equal(recruiterView.avatar.kind, 'default-person-icon');
  assert.equal(recruiterView.phone, undefined, 'phone stays hidden during initial review');

  const legacyCreate = await api('/api/applicants', APPLICANT.id, {
    method: 'POST', body: JSON.stringify({}),
  });
  assert.equal(legacyCreate.status, 403, 'applicants must use the owned /profile endpoint, not legacy creation');
});

test('NFR-FEAT-001 AC-003: GET /me returns only the authenticated applicant profile and fixed visibility policy', async () => {
  const created = await createProfile();
  assert.equal(created.status, 201, await created.clone().text());
  const profile = await created.json() as any;

  const own = await api('/api/applicants/me');
  assert.equal(own.status, 200, await own.clone().text());
  const body = await own.json() as any;
  assert.equal(body.id, profile.id);
  assert.equal(body.email, APPLICANT.email);
  assert.equal(body.phone, '+12125550123');
  assert.equal(body.contactVisibility.email, 'authorized-staff');
  assert.equal(body.contactVisibility.phone, 'post-initial-review');

  const other = await api('/api/applicants/me', APPLICANT_2.id);
  assert.equal(other.status, 404, 'second applicant must not receive another applicant profile');
});

test('NFR-FEAT-001 AC-004: valid employment entry requires and preserves a position description', async () => {
  assert.equal((await createProfile()).status, 201);
  const res = await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody()),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const entry = await res.json() as any;
  assert.ok(entry.id, 'employment entry must have stable id');
  assert.equal(entry.positionDescription, employmentBody().positionDescription);
  assert.deepEqual(entry.responsibilities, ['Designed backend services']);
  assert.deepEqual(entry.accomplishments, ['Reduced processing time by 30%']);
  assert.deepEqual(entry.skills, ['TypeScript', 'Node.js']);
});

test('NFR-FEAT-001 AC-004: employment rejects missing/short description and invalid dates', async (t) => {
  await t.test('missing description', async () => {
    assert.equal((await createProfile()).status, 201);
    const bad = employmentBody();
    delete (bad as any).positionDescription;
    const res = await api('/api/applicants/me/employment', APPLICANT.id, {
      method: 'POST', body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400);
  });

  await t.test('description shorter than 50 characters', async () => {
    assert.equal((await createProfile()).status, 201);
    const res = await api('/api/applicants/me/employment', APPLICANT.id, {
      method: 'POST', body: JSON.stringify(employmentBody({ positionDescription: 'Too short' })),
    });
    assert.equal(res.status, 400);
  });

  await t.test('end date before start date', async () => {
    assert.equal((await createProfile()).status, 201);
    const res = await api('/api/applicants/me/employment', APPLICANT.id, {
      method: 'POST', body: JSON.stringify(employmentBody({ startDate: '2024-01', endDate: '2023-01' })),
    });
    assert.equal(res.status, 400);
  });

  await t.test('current position cannot include end date', async () => {
    assert.equal((await createProfile()).status, 201);
    const res = await api('/api/applicants/me/employment', APPLICANT.id, {
      method: 'POST', body: JSON.stringify(employmentBody({ currentPosition: true, endDate: '2024-02' })),
    });
    assert.equal(res.status, 400);
  });
});

test('NFR-FEAT-001 AC-004 security: applicant cannot choose a client-supplied employment entry ID', async () => {
  assert.equal((await createProfile()).status, 201);
  const res = await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody({ id: 'attacker-controlled-id' })),
  });
  assert.equal(res.status, 400, 'server must generate stable IDs and reject caller-controlled IDs');
});

test('NFR-FEAT-001 AC-005: applicant can update, reorder, and delete owned employment entries with stable IDs', async () => {
  assert.equal((await createProfile()).status, 201);
  const first = await (await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody({ company: 'First Corp' })),
  })).json() as any;
  const second = await (await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody({ company: 'Second Corp', startDate: '2018-01', endDate: '2020-12' })),
  })).json() as any;

  const update = await api(`/api/applicants/me/employment/${first.id}`, APPLICANT.id, {
    method: 'PATCH', body: JSON.stringify({ accomplishments: ['Promoted twice', 'Improved uptime to 99.9%'] }),
  });
  assert.equal(update.status, 200, await update.clone().text());
  assert.equal((await update.json() as any).id, first.id);

  const reorder = await api('/api/applicants/me/employment/reorder', APPLICANT.id, {
    method: 'PUT', body: JSON.stringify({ ids: [second.id, first.id] }),
  });
  assert.equal(reorder.status, 200, await reorder.clone().text());
  assert.deepEqual((await reorder.json() as any).map((e: any) => e.id), [second.id, first.id]);

  const remove = await api(`/api/applicants/me/employment/${first.id}`, APPLICANT.id, { method: 'DELETE' });
  assert.equal(remove.status, 204);
  const profile = await (await api('/api/applicants/me')).json() as any;
  assert.deepEqual(profile.employmentHistory.map((e: any) => e.id), [second.id]);
});

test('NFR-FEAT-001 AC-009: unique email match links and normalizes a legacy applicant without losing data', async () => {
  const legacy = {
    id: 'legacy-applicant', firstName: 'Jane', lastName: 'Doe', email: APPLICANT.email,
    phone: '+12125550123', preferredContactMethod: 'email', address: { state: 'NY', zip: '10001' },
    educationHistory: [],
    employmentHistory: [{
      company: 'Legacy Corp', position: 'Developer', startDate: '2019-01', endDate: '2020-01',
      responsibilities: ['Maintained legacy services'],
    }],
    rightToWork: true, requiresSponsorship: false, expectedPay: 0,
    notificationToManager: false, hireRecords: [],
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  };
  await store.writeStore(initialStore({ applicants: [legacy] }));

  const res = await api('/api/applicants/me');
  assert.equal(res.status, 200, await res.clone().text());
  const profile = await res.json() as any;
  assert.equal(profile.id, legacy.id);
  assert.equal(profile.userId, APPLICANT.id);
  assert.equal(profile.address.country, 'US');
  assert.equal(profile.avatar.kind, 'default-person-icon');
  assert.ok(profile.employmentHistory[0].id);
  assert.equal(profile.employmentHistory[0].company, 'Legacy Corp');
  assert.equal(profile.employmentHistory[0].positionDescription, '');
  assert.ok(profile.completeness.missingSections.includes('employmentHistory'));

  const saved = await store.readStore();
  assert.equal(saved.users.find((u: any) => u.id === APPLICANT.id)?.applicantId, legacy.id);
});

test('NFR-FEAT-001 AC-010: profile and employment changes are observable without logging PII or descriptions', async () => {
  assert.equal((await createProfile()).status, 201);
  assert.equal((await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody()),
  })).status, 201);

  const logs = await store.readObservability();
  assert.ok(logs.some((l: any) => l.action === 'profile_create' && l.userId === APPLICANT.id));
  assert.ok(logs.some((l: any) => l.action === 'employment_create' && l.userId === APPLICANT.id));
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /jane@example\.com/i);
  assert.doesNotMatch(serialized, /\+12125550123/);
  assert.doesNotMatch(serialized, /Designed and maintained reliable recruiting/i);
});

test('NFR-FEAT-001 AC-011: completeness is progressive and never penalizes optional photo or pronouns', async () => {
  const created = await createProfile();
  assert.equal(created.status, 201, await created.clone().text());
  const draft = await created.json() as any;
  assert.equal(draft.profileStatus, 'draft');
  assert.equal(draft.completeness.percent, 50);
  assert.ok(!draft.completeness.missingSections.includes('avatar'));
  assert.ok(!draft.completeness.missingSections.includes('photo'));
  assert.ok(!draft.completeness.missingSections.includes('pronouns'));

  const patch = await api('/api/applicants/me', APPLICANT.id, {
    method: 'PATCH',
    body: JSON.stringify({
      headline: 'Senior Software Engineer',
      professionalSummary: 'Experienced engineer focused on reliable systems and accessible recruiting products.',
      educationHistory: [{ institution: 'State University', degree: 'BS', fieldOfStudy: 'Computer Science', startDate: '2015-08', endDate: '2019-05' }],
      skills: [{ name: 'TypeScript', proficiency: 'advanced', yearsUsed: 5 }],
    }),
  });
  assert.equal(patch.status, 200, await patch.clone().text());
  assert.equal((await api('/api/applicants/me/employment', APPLICANT.id, {
    method: 'POST', body: JSON.stringify(employmentBody()),
  })).status, 201);

  const complete = await (await api('/api/applicants/me')).json() as any;
  assert.equal(complete.completeness.percent, 100);
  assert.deepEqual(complete.completeness.missingSections, []);
  assert.equal(complete.profileStatus, 'complete');
});

test('NFR-FEAT-001 security: PATCH /me rejects protected/unknown fields and cannot change ownership', async () => {
  const created = await createProfile();
  assert.equal(created.status, 201, await created.clone().text());
  const profile = await created.json() as any;

  for (const payload of [
    { id: 'replacement-id' },
    { userId: APPLICANT_2.id },
    { personId: 'another-person' },
    { avatar: { kind: 'upload', race: 'inferred' } },
    { arbitraryUnknownField: true },
  ]) {
    const res = await api('/api/applicants/me', APPLICANT.id, {
      method: 'PATCH', body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400, `payload should be rejected: ${JSON.stringify(payload)}; body=${await res.text()}`);
  }

  const own = await (await api('/api/applicants/me')).json() as any;
  assert.equal(own.id, profile.id);
  assert.equal(own.userId, APPLICANT.id);
});
