/**
 * NFR-FEAT-001 AC-002 — Applicant photo storage in private Vercel Blob.
 * Tests are written before implementation and must fail in the Red phase.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

let dataDir: string;
let store: typeof import('../../src/models/store.js');
let app: any;
let server: Server;
let baseUrl: string;

const USER = {
  id: 'u-avatar', username: 'avatar-applicant', passwordHash: 'encrypted_pw', role: 'applicant',
  email: 'avatar@example.com', createdAt: '2026-09-13T00:00:00.000Z', oauthProvider: null,
};
const AUTH = { Authorization: `Bearer ${USER.id}` };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

class FakePhotoStorage {
  uploads: any[] = [];
  deleted: string[] = [];

  async upload(input: any) {
    this.uploads.push(input);
    const n = this.uploads.length;
    const ext = input.extension;
    const pathname = `applicants/${input.applicantId}/profile-${n}.${ext}`;
    return {
      kind: 'upload', icon: 'person', altText: input.altText,
      provider: 'vercel-blob',
      url: `https://store.private.blob.vercel-storage.com/${pathname}`,
      pathname, contentType: input.contentType, size: input.body.length,
    };
  }

  async delete(pathname: string) {
    this.deleted.push(pathname);
  }
}

let fake: FakePhotoStorage;

function initialStore() {
  return {
    companies: [], jobs: [], applicants: [], applications: [], hires: [], observability: [],
    users: [structuredClone(USER)],
  } as any;
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...AUTH, ...(init.headers || {}) },
  });
}

async function createProfile() {
  return api('/api/applicants/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Avery', lastName: 'Applicant', email: USER.email, emailConfirmation: USER.email,
      phone: '+12125550199', preferredContactMethod: 'email',
      address: { state: 'NY', zip: '10001', country: 'US' },
      rightToWork: true, requiresSponsorship: false,
    }),
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr-feat-001-avatar-'));
  process.env.DATA_DIR = dataDir;
  store = await import('../../src/models/store.js');
  ({ app } = await import('../../src/index.js'));
  server = app.listen(0);
  const address = server.address();
  baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
});

beforeEach(async () => {
  await store.writeStore(initialStore());
  await store.writeObservability([]);
  fake = new FakePhotoStorage();
  app.locals.applicantPhotoStorage = fake;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

test('NFR-FEAT-001 AC-002: valid PNG is uploaded to Blob adapter and only metadata is stored', async () => {
  assert.equal((await createProfile()).status, 201);
  const res = await api('/api/applicants/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-File-Name': 'portrait.png', 'X-Alt-Text': 'Applicant portrait' },
    body: PNG as any,
  });
  assert.equal(res.status, 201, await res.clone().text());
  const avatar = await res.json() as any;
  assert.equal(fake.uploads.length, 1);
  assert.equal(fake.uploads[0].contentType, 'image/png');
  assert.equal(fake.uploads[0].extension, 'png');
  assert.deepEqual(fake.uploads[0].body, PNG);
  assert.equal(avatar.kind, 'upload');
  assert.equal(avatar.provider, 'vercel-blob');
  assert.match(avatar.pathname, /^applicants\//);

  const saved = await store.readStore();
  const profile = saved.applicants[0];
  assert.equal(profile.avatar?.pathname, avatar.pathname);
  assert.equal((profile.avatar as any).body, undefined);
  assert.equal((profile.avatar as any).data, undefined);
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(PNG.toString('base64')));
});

test('NFR-FEAT-001 AC-002: MIME type and image magic bytes must agree before Blob upload', async () => {
  assert.equal((await createProfile()).status, 201);
  const res = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: JPEG as any,
  });
  assert.equal(res.status, 400);
  assert.equal(fake.uploads.length, 0, 'invalid content must never reach Vercel Blob');
});

test('NFR-FEAT-001 AC-002: non-image and images larger than 4 MB are rejected without Blob calls', async () => {
  assert.equal((await createProfile()).status, 201);
  const text = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('not an image') as any,
  });
  assert.equal(text.status, 400);

  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1, 0);
  PNG.copy(tooLarge, 0);
  const large = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: tooLarge as any,
  });
  assert.equal(large.status, 413);
  assert.equal(fake.uploads.length, 0);
});

test('NFR-FEAT-001 AC-002: replacing a photo stores the new Blob then deletes the old Blob', async () => {
  assert.equal((await createProfile()).status, 201);
  const first = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG as any,
  });
  assert.equal(first.status, 201, await first.clone().text());
  const firstAvatar = await first.json() as any;

  const second = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: JPEG as any,
  });
  assert.equal(second.status, 201, await second.clone().text());
  const secondAvatar = await second.json() as any;
  assert.notEqual(secondAvatar.pathname, firstAvatar.pathname);
  assert.deepEqual(fake.deleted, [firstAvatar.pathname]);

  const saved = await store.readStore();
  assert.equal(saved.applicants[0].avatar?.pathname, secondAvatar.pathname);
});

test('NFR-FEAT-001 AC-002: deleting photo removes Blob and restores neutral person icon', async () => {
  assert.equal((await createProfile()).status, 201);
  const uploaded = await api('/api/applicants/me/avatar', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG as any,
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const avatar = await uploaded.json() as any;

  const removed = await api('/api/applicants/me/avatar', { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.deepEqual(fake.deleted, [avatar.pathname]);

  const profile = await (await api('/api/applicants/me')).json() as any;
  assert.equal(profile.avatar.kind, 'default-person-icon');
  assert.equal(profile.avatar.icon, 'person');
  assert.equal(profile.avatar.race, undefined);
});

test('NFR-FEAT-001 AC-002: production adapter always writes private Vercel Blob objects', async () => {
  const calls: any[] = [];
  const { VercelApplicantPhotoStorage } = await import('../../src/services/applicantPhoto.js');
  const adapter = new VercelApplicantPhotoStorage({
    put: async (...args: any[]) => {
      calls.push(args);
      return {
        url: 'https://store.private.blob.vercel-storage.com/applicants/id/photo.png',
        downloadUrl: 'https://store.private.blob.vercel-storage.com/applicants/id/photo.png?download=1',
        pathname: 'applicants/id/photo.png', contentType: 'image/png', contentDisposition: 'inline', etag: 'etag',
      };
    },
    del: async () => {},
  } as any);
  const result = await adapter.upload({
    applicantId: 'id', body: PNG, contentType: 'image/png', extension: 'png', altText: 'Photo',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^applicants\/id\/profile-[a-f0-9-]+\.png$/);
  assert.equal(calls[0][2].access, 'private');
  assert.equal(calls[0][2].addRandomSuffix, false);
  assert.equal(calls[0][2].allowOverwrite, false);
  assert.equal(result.provider, 'vercel-blob');
});

test('NFR-FEAT-001 AC-002: production adapter deletes by stored Blob pathname', async () => {
  const deleted: string[] = [];
  const { VercelApplicantPhotoStorage } = await import('../../src/services/applicantPhoto.js');
  const adapter = new VercelApplicantPhotoStorage({
    put: async () => { throw new Error('not used'); },
    del: async (pathname: string) => { deleted.push(pathname); },
  } as any);
  await adapter.delete('applicants/id/old.png');
  assert.deepEqual(deleted, ['applicants/id/old.png']);
});
