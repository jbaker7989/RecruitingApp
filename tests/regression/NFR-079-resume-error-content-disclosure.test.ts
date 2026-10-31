/**
 * NFR-079: Keep resume content out of parse errors and audit records.
 *
 * Malformed model output previously produced errors whose message embedded the
 * raw provider output (up to 500 characters) and the stringified Zod issue
 * list. Those messages reached HTTP responses, the audit trail, and stack
 * traces — so applicant content could be retained in diagnostic records.
 *
 * These tests inject malformed model output containing a synthetic marker and
 * assert the marker never reaches the HTTP response, the persisted audit
 * record, the captured log output, or exported telemetry.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { buildPdf } from '../fixtures/syntheticDocuments.js';

const MARKER = 'synthetic-applicant-marker-778213';
const TEST_DIR = `/tmp/nfr-079-resume-disclosure-${process.pid}`;

interface StoreModule {
  readObservability(): Promise<any[]>;
  closeStore(): Promise<void>;
}

let store: StoreModule;
let server: any;
let baseUrl = '';
let token = '';
let originalInvoke: PropertyDescriptor | undefined;
let capturedLogs: string[] = [];
const oldKey = process.env.OPENAI_API_KEY;

/** Make the stubbed model return `content` verbatim. */
function stubModelOutput(content: string) {
  Object.defineProperty(ChatOpenAI.prototype, 'invoke', {
    configurable: true,
    value: async () => new AIMessage({
      content,
      usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
  });
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, body: body as T };
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    redirect: 'manual',
  };
}

/** POST a synthetic PDF to the file endpoint as multipart/form-data. */
async function postResumeFile(): Promise<{ status: number; body: any; text: string }> {
  const form = new FormData();
  form.append('resume', new Blob([new Uint8Array(buildPdf('Synthetic resume body'))], { type: 'application/pdf' }), 'resume.pdf');
  const response = await fetch(`${baseUrl}/api/agents/resume/parse`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, text };
}

describe('NFR-079: resume parse failures do not disclose applicant content', () => {
  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    process.env.DATA_DIR = TEST_DIR;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'nfr-079-test-secret-must-be-at-least-32-chars';
    process.env.APPLICANT_JWT_SECRET = 'nfr-079-applicant-secret-must-be-32-chars-min';
    process.env.OPENAI_API_KEY = 'synthetic-no-network-key';

    // Capture anything written to the console so log leakage is observable.
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
    console.warn = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
    console.log = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
    after(() => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
    });

    store = await import('../../src/models/store.js') as StoreModule;
    await store.initializeStore();

    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${(address as any).port}`;

    const registered = await request<{ token: string }>('/api/auth/register', json('POST', {
      username: `nfr079-${Date.now()}`,
      password: 'pass1234',
      email: `nfr079-${Date.now()}@example.test`,
      role: 'recruiter',
    }));
    assert.equal(registered.status, 201, `register failed: ${JSON.stringify(registered.body)}`);
    token = registered.body.token;

    originalInvoke = Object.getOwnPropertyDescriptor(ChatOpenAI.prototype, 'invoke');
  });

  after(async () => {
    if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
    else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (store) await store.closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });

  it('malformed JSON: the response and logs carry no model output', async () => {
    capturedLogs = [];
    stubModelOutput(`{ "firstName": "${MARKER}", "broken": `);

    const res = await request<{ error: string; failure?: string }>(
      '/api/agents/resume/parse-text',
      json('POST', { resumeText: 'Synthetic resume body' }),
    );

    assert.equal(res.status, 500, `expected 500, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.failure, 'json_failure');
    assert.ok(!JSON.stringify(res.body).includes(MARKER), 'HTTP response must not contain the marker');
    assert.doesNotMatch(res.body.error, /Raw content/i, 'raw-content note must be gone');

    const logs = capturedLogs.join('\n');
    assert.ok(!logs.includes(MARKER), 'logs must not contain the marker');
  });

  it('schema-invalid output: the response and logs carry no schema input values', async () => {
    capturedLogs = [];
    // Valid JSON, but `email` is the marker — a Zod issue would embed the value.
    stubModelOutput(JSON.stringify({
      firstName: MARKER,
      lastName: 'Applicant',
      email: MARKER,
      phone: '555-0100',
      educationHistory: [],
      employmentHistory: [],
      skills: [],
      achievements: [],
      confidenceScores: { firstName: 0.9 },
      rawText: MARKER,
    }));

    const res = await request<{ error: string; failure?: string }>(
      '/api/agents/resume/parse-text',
      json('POST', { resumeText: 'Synthetic resume body' }),
    );

    assert.equal(res.status, 500, `expected 500, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.failure, 'schema_failure');
    assert.ok(!JSON.stringify(res.body).includes(MARKER), 'HTTP response must not contain the marker');

    const logs = capturedLogs.join('\n');
    assert.ok(!logs.includes(MARKER), 'logs must not contain the marker');
  });

  it('file endpoint: the failure audit record carries only the classification, never the model output', async () => {
    capturedLogs = [];
    stubModelOutput(`{ "firstName": "${MARKER}", "broken": `);

    const res = await postResumeFile();

    assert.equal(res.status, 500, `expected 500, got ${res.status}: ${res.text}`);
    assert.equal(res.body.failure, 'json_failure');
    assert.ok(!res.text.includes(MARKER), 'HTTP response must not contain the marker');

    const audit = await store.readObservability();
    const failureEntry = audit.filter((e: { action: string; outcome: string }) =>
      e.action === 'resume_parsed' && e.outcome === 'failure').pop();
    assert.ok(failureEntry, 'a failure audit record must be written');
    const serialized = JSON.stringify(failureEntry);
    assert.ok(!serialized.includes(MARKER), 'audit record must not contain the marker');
    assert.equal(failureEntry.details.failure, 'json_failure');
    assert.ok(!('error' in failureEntry.details), 'audit record must not carry a raw error message');
    assert.deepEqual(failureEntry.details.fields, [], 'a JSON failure has no schema field paths');

    const logs = capturedLogs.join('\n');
    assert.ok(!logs.includes(MARKER), 'logs must not contain the marker');
  });

  it('file endpoint: a schema failure records the failing field paths but no values', async () => {
    capturedLogs = [];
    stubModelOutput(JSON.stringify({
      firstName: MARKER,
      lastName: 'Applicant',
      email: MARKER,
      phone: '555-0100',
      educationHistory: [],
      employmentHistory: [],
      skills: [],
      achievements: [],
      confidenceScores: { firstName: 0.9 },
      rawText: MARKER,
    }));

    const res = await postResumeFile();

    assert.equal(res.status, 500, `expected 500, got ${res.status}: ${res.text}`);
    assert.equal(res.body.failure, 'schema_failure');
    assert.ok(!res.text.includes(MARKER), 'HTTP response must not contain the marker');

    const audit = await store.readObservability();
    const failureEntry = audit.filter((e: { action: string; outcome: string }) =>
      e.action === 'resume_parsed' && e.outcome === 'failure').pop();
    assert.ok(failureEntry, 'a failure audit record must be written');
    const serialized = JSON.stringify(failureEntry);
    assert.ok(!serialized.includes(MARKER), 'audit record must not contain the marker');
    assert.equal(failureEntry.details.failure, 'schema_failure');
    // Field paths are schema structure, not content — they are allowed and useful.
    assert.ok(Array.isArray(failureEntry.details.fields), 'failing field paths are recorded');
    assert.ok(
      failureEntry.details.fields.includes('email'),
      `expected the failing field path "email" to be recorded, got ${JSON.stringify(failureEntry.details.fields)}`,
    );

    const logs = capturedLogs.join('\n');
    assert.ok(!logs.includes(MARKER), 'logs must not contain the marker');
  });

  it('successful parsing is unchanged and still returns the parsed resume', async () => {
    stubModelOutput(JSON.stringify({
      firstName: 'Synthetic',
      lastName: 'Applicant',
      email: 'synthetic@example.invalid',
      phone: '555-0100',
      educationHistory: [],
      employmentHistory: [],
      skills: ['TypeScript'],
      achievements: [],
      confidenceScores: { firstName: 0.9 },
      rawText: 'Synthetic resume body',
    }));

    const res = await request<{ success: boolean; data: { email: string } }>(
      '/api/agents/resume/parse-text',
      json('POST', { resumeText: 'Synthetic resume body' }),
    );

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.email, 'synthetic@example.invalid');
  });
});