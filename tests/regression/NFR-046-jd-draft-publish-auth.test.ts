/**
 * NFR-046: JD draft publish lacks company authorization.
 *
 * A hiring manager must not be able to publish a draft for a company they
 * do not belong to, even if they own the draft (current code only checks
 * draft.userId). Member-services admins override the check.
 *
 * Four route-level tests:
 *   1. authorized publish (own companyId)
 *   2. cross-tenant publish rejected (foreign companyId)
 *   3. admin override (member-services can publish any draft)
 *   4. cross-tenant generate rejected (foreign companyId, no LLM call)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';

const TEST_DIR = `/tmp/nfr-046-jd-publish-auth-${process.pid}`;
const PORT = 0; // ephemeral

interface StoreModule {
  readStore(): Promise<any>;
  updateStore<T>(mutator: (store: any) => T | Promise<T>): Promise<T>;
  closeStore(): Promise<void>;
}

let store: StoreModule;
let server: any;
let baseUrl = '';
let jwtSecret = 'nfr-046-test-secret-must-be-at-least-32-chars';
let applicantSecret = 'nfr-046-applicant-secret-must-be-32-chars-min';

async function request<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
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
    redirect: 'manual',
  };
}

async function registerStaff(username: string, password: string, role: 'hiring-manager' | 'member-services'): Promise<{ token: string; userId: string }> {
  const res = await request<{ token: string; user: { id: string } }>('/api/auth/register', json('POST', {
    username,
    password,
    email: `${username}@nfr046.test`,
    role,
  }));
  assert.equal(res.status, 201, `register ${role} failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id };
}

async function login(username: string, password: string): Promise<string> {
  const res = await request<{ token: string }>('/api/auth/login', json('POST', { username, password }));
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function createCompany(token: string, name: string): Promise<string> {
  const res = await request<{ id: string }>('/api/companies', json('POST', {
    companyName: name,
    description: `${name} description`,
    location: 'Remote',
    companySize: '1-50',
    industry: 'Tech',
  }, token));
  assert.equal(res.status, 201, `company create failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

interface SeededDraft {
  draftId: string;
  jobId?: string;
}

async function seedDraft(userId: string, companyId: string): Promise<SeededDraft> {
  let draftId = '';
  await store.updateStore((s) => {
    draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    s.drafts.push({
      id: draftId,
      companyId,
      userId,
      status: 'draft',
      input: {
        jobTitle: 'NFR-046 Test Engineer',
        tone: 'professional',
        requirements: [],
        responsibilities: [],
        qualifications: [],
        requiredSkills: [],
      },
      output: {
        summary: 'Synthetic test draft',
        positionDescription: 'Synthetic position description for NFR-046.',
        responsibilities: ['Test the publish authorization gate.'],
        qualifications: ['NFR-046 regression'],
        requirements: ['Trust boundary verified'],
        requiredSkills: ['TypeScript'],
        requiredExperience: 1,
        keywords: ['test'],
        confidence: 0.5,
      },
      variantsGenerated: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  });
  return { draftId };
}

describe('NFR-046: JD draft publish authorization', () => {
  let originalInvoke: PropertyDescriptor | undefined;
  let llmCalls = 0;

  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    process.env.DATA_DIR = TEST_DIR;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = jwtSecret;
    process.env.APPLICANT_JWT_SECRET = applicantSecret;

    store = await import('../../src/models/store.js') as StoreModule;
    await store.initializeStore(); // creates store.json if missing

    // Stub the LLM so /generate can run without live credentials.
    originalInvoke = Object.getOwnPropertyDescriptor(ChatOpenAI.prototype, 'invoke');
    llmCalls = 0;
    Object.defineProperty(ChatOpenAI.prototype, 'invoke', {
      configurable: true,
      value: async () => {
        llmCalls += 1;
        return new AIMessage({
          content: JSON.stringify({
            summary: 'Stubbed NFR-046 summary',
            positionDescription: 'Stubbed NFR-046 description',
            responsibilities: ['Stub'],
            qualifications: ['Stub'],
            requirements: ['Stub'],
            requiredSkills: ['Stub'],
            requiredExperience: 1,
            keywords: ['stub'],
            confidence: 0.5,
          }),
          usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        });
      },
    });

    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${(address as any).port}`;
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (store) await store.closeStore();
    if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
    else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('authorized publish: hiring-manager publishes their own draft for their own company', async () => {
    const username = `hm-own-${Date.now()}`;
    const password = 'pass1234';
    const registered = await registerStaff(username, password, 'hiring-manager');
    const companyId = await createCompany(registered.token, `Own Co ${Date.now()}`);
    // Re-login so the JWT carries companyId (register tokens omit it)
    const hmToken = await login(username, password);

    const { draftId } = await seedDraft(registered.userId, companyId);

    const res = await request<{ success: boolean; jobId: string }>(
      `/api/agents/jd/drafts/${draftId}/publish`,
      json('POST', {}, hmToken),
    );
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.jobId === 'string' && res.body.jobId.length > 0);

    // Confirm a JobPosting was actually written
    const after = await store.readStore();
    const job = after.jobs.find((j: { id: string }) => j.id === res.body.jobId);
    assert.ok(job, 'job posting must be persisted');
    assert.equal(job.companyId, companyId);

    // Draft status flipped to published
    const draft = after.drafts.find((d: { id: string }) => d.id === draftId);
    assert.equal(draft.status, 'published');
  });

  it('cross-tenant publish rejected: hiring-manager cannot publish for a foreign company', async () => {
    const username = `hm-cross-${Date.now()}`;
    const password = 'pass1234';
    const registered = await registerStaff(username, password, 'hiring-manager');
    const ownCompanyId = await createCompany(registered.token, `Own Co ${Date.now()}`);
    const hmToken = await login(username, password);

    // Seed a draft whose companyId is NOT the hiring-manager's own company
    const foreignCompanyId = `foreign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { draftId } = await seedDraft(registered.userId, foreignCompanyId);

    const res = await request<{ error: string }>(
      `/api/agents/jd/drafts/${draftId}/publish`,
      json('POST', {}, hmToken),
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /company/i);

    // No JobPosting should have been created
    const after = await store.readStore();
    const jobsForForeign = after.jobs.filter((j: { companyId: string }) => j.companyId === foreignCompanyId);
    assert.equal(jobsForForeign.length, 0, 'no job posting may be written for the foreign company');

    // Draft must remain unpublished
    const draft = after.drafts.find((d: { id: string }) => d.id === draftId);
    assert.equal(draft.status, 'draft', 'draft status must be unchanged on rejection');
  });

  it('admin override: member-services publishes a draft owned by a hiring-manager for any company', async () => {
    // Set up a hiring-manager who owns a company and has a draft
    const hmUsername = `hm-admin-${Date.now()}`;
    const hmPassword = 'pass1234';
    const hmRegistered = await registerStaff(hmUsername, hmPassword, 'hiring-manager');
    const companyId = await createCompany(hmRegistered.token, `Admin Co ${Date.now()}`);
    const { draftId } = await seedDraft(hmRegistered.userId, companyId);

    // Admin registers and publishes on behalf of the hiring-manager
    const adminUsername = `ms-${Date.now()}`;
    const adminPassword = 'pass1234';
    const adminRegistered = await registerStaff(adminUsername, adminPassword, 'member-services');
    const adminToken = await login(adminUsername, adminPassword);

    const res = await request<{ success: boolean; jobId: string }>(
      `/api/agents/jd/drafts/${draftId}/publish`,
      json('POST', {}, adminRegistered.token), // register token has no companyId — admin override still wins
    );
    assert.equal(res.status, 201, `admin expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.jobId);

    // The publish through the fresh admin login should also succeed (sanity check both token paths)
    const res2 = await request<{ error?: string }>(
      `/api/agents/jd/drafts/${draftId}/publish`,
      json('POST', {}, adminToken),
    );
    // Draft is already published by now; expect 400, not 403
    assert.equal(res2.status, 400, `second publish expected 400 (already published), got ${res2.status}: ${JSON.stringify(res2.body)}`);
  });

  it('cross-tenant generate rejected: hiring-manager cannot generate a draft for a foreign company', async () => {
    const username = `hm-gen-${Date.now()}`;
    const password = 'pass1234';
    const registered = await registerStaff(username, password, 'hiring-manager');
    await createCompany(registered.token, `Gen Co ${Date.now()}`);
    const hmToken = await login(username, password);

    const callsBefore = llmCalls;
    const draftsBefore = (await store.readStore()).drafts.length;
    const res = await request<{ error: string }>(
      `/api/agents/jd/generate`,
      json('POST', {
        companyId: randomUUID(),
        jobTitle: 'Foreign Co Engineer',
        tone: 'professional',
      }, hmToken),
    );
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /company/i);
    // Authorization must fire before the LLM call.
    assert.equal(llmCalls, callsBefore, 'no LLM call may occur on rejected generate');

    const after = await store.readStore();
    assert.equal(after.drafts.length, draftsBefore, 'no draft must be persisted on rejected generate');
  });
});