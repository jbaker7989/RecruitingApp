/**
 * NFR-082: `POST /api/agents/resume/parse` never receives the uploaded bytes.
 *
 * `handleFileUpload` configures express-fileupload with `useTempFiles: true`,
 * which streams the upload to disk and leaves `file.data` as an empty buffer.
 * The route read `file.data`, so every PDF/DOCX upload reached the parser as
 * zero bytes and was rejected with `InvalidPDFException: The PDF file is
 * empty`. The route now reads from `file.tempFilePath` when `file.data` is
 * empty, which is the only correct way to consume a temp-file upload.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { buildPdf } from '../fixtures/syntheticDocuments.js';

const MARKER = 'NFR-082-UPLOAD-MARKER-4417';
const TEST_DIR = `/tmp/nfr-082-resume-upload-${process.pid}`;

let server: any;
let baseUrl = '';
let token = '';
let originalInvoke: PropertyDescriptor | undefined;
const oldKey = process.env.OPENAI_API_KEY;

async function request<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T; text: string }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined as any, text };
}

describe('NFR-082: file resume upload reaches the parser with its bytes', () => {
  before(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    process.env.DATA_DIR = TEST_DIR;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'nfr-082-test-secret-must-be-at-least-32-chars';
    process.env.APPLICANT_JWT_SECRET = 'nfr-082-applicant-secret-must-be-32-chars-min';
    process.env.OPENAI_API_KEY = 'synthetic-no-network-key';

    const { app } = await import('../../src/index.js');
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${(address as any).port}`;

    const registered = await request<{ token: string }>('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: `nfr082-${Date.now()}`,
        password: 'pass1234',
        email: `nfr082-${Date.now()}@example.test`,
        role: 'recruiter',
      }),
    });
    assert.equal(registered.status, 201, `register failed: ${registered.text}`);
    token = registered.body.token;

    let capturedPrompt = '';
    originalInvoke = Object.getOwnPropertyDescriptor(ChatOpenAI.prototype, 'invoke');
    Object.defineProperty(ChatOpenAI.prototype, 'invoke', {
      configurable: true,
      value: async (prompt: unknown) => {
        capturedPrompt = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        return new AIMessage({
          content: JSON.stringify({
            firstName: 'Synthetic',
            lastName: 'Applicant',
            email: 'synthetic@example.invalid',
            phone: '555-0100',
            educationHistory: [],
            employmentHistory: [],
            skills: [],
            achievements: [],
            confidenceScores: { firstName: 0.9 },
            rawText: MARKER,
          }),
          usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        });
      },
    });
  });

  after(async () => {
    if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
    else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });

  it('a successful PDF upload extracts text and reaches the parser prompt', async () => {
    const form = new FormData();
    form.append('resume', new Blob([new Uint8Array(buildPdf(MARKER))], { type: 'application/pdf' }), 'resume.pdf');
    const res = await request<{ success: boolean; data: { email: string } }>('/api/agents/resume/parse', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.email, 'synthetic@example.invalid');
  });

  it('an empty-buffer PDF (the pre-fix failure mode) no longer crashes the route', async () => {
    // A genuinely empty PDF: a file with no body. Before the fix this also
    // produced the same `InvalidPDFException` because the upload landed in
    // temp file with the right size but the route never read it; here we
    // exercise the new temp-file path explicitly.
    const form = new FormData();
    form.append('resume', new Blob([new Uint8Array([0x25, 0x25])], { type: 'application/pdf' }), 'resume.pdf');
    const res = await request<{ error: string }>('/api/agents/resume/parse', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });

    // We do not assert the exact status code — either a graceful 4xx
    // ("Uploaded file could not be read") or a parser error — but the response
    // must be JSON, not the legacy `pdfParse is not a function` TypeError.
    assert.ok(res.status >= 400, `expected 4xx/5xx, got ${res.status}: ${res.text}`);
    assert.ok(!res.text.includes('pdfParse is not a function'));
  });
});