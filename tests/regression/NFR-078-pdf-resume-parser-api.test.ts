/**
 * NFR-078: Restore PDF resume parsing with the installed parser API.
 *
 * The installed `pdf-parse` v2 exports a `PDFParse` class, not a callable
 * default, so the old `(pdfModule as any).default || pdfModule` call threw
 * `TypeError: pdfParse is not a function` before any text was extracted.
 *
 * These tests use a real, hand-built PDF (correct xref table) and the real
 * pdf-parse library. Only the downstream LLM boundary is stubbed.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { buildDocx, buildPdf } from '../fixtures/syntheticDocuments.js';

const MARKER = 'NFR078-SYNTHETIC-RESUME-MARKER-4417';

describe('NFR-078: PDF resume extraction with the installed parser API', () => {
  let originalInvoke: PropertyDescriptor | undefined;
  let capturedPrompt = '';
  const oldKey = process.env.OPENAI_API_KEY;

  before(() => {
    process.env.OPENAI_API_KEY = 'synthetic-no-network-key';
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

  after(() => {
    if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
    else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });

  it('extracts text from a valid PDF and passes it to the parsing stage intact', async () => {
    const { parseResumeFromBuffer } = await import('../../src/chains/resumeParsing.js');
    capturedPrompt = '';

    const parsed = await parseResumeFromBuffer(buildPdf(MARKER), 'application/pdf');

    assert.ok(
      capturedPrompt.includes(MARKER),
      `extracted PDF text must reach the parser prompt; captured prompt was: ${capturedPrompt.slice(0, 400)}`,
    );
    assert.equal(parsed.email, 'synthetic@example.invalid');
  });

  it('fails with a bounded error on a corrupt PDF instead of throwing the parser type error', async () => {
    const { parseResumeFromBuffer } = await import('../../src/chains/resumeParsing.js');
    const corrupt = Buffer.from('%PDF-1.4\nthis is not a valid pdf body\n', 'latin1');

    await assert.rejects(
      () => parseResumeFromBuffer(corrupt, 'application/pdf'),
      (error: Error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Failed to extract text from PDF/);
        assert.doesNotMatch(
          error.message,
          /pdfParse is not a function/,
          'the old API-mismatch failure must not recur',
        );
        assert.ok(error.message.length < 2000, 'error message must stay bounded');
        return true;
      },
    );
  });

  it('rejects a PDF whose page contains no extractable text', async () => {
    const { parseResumeFromBuffer } = await import('../../src/chains/resumeParsing.js');
    const empty = buildPdf('');

    await assert.rejects(
      () => parseResumeFromBuffer(empty, 'application/pdf'),
      (error: Error) => {
        assert.match(error.message, /No text could be extracted/);
        return true;
      },
    );
  });

  it('retains the unsupported-file-type rejection', async () => {
    const { parseResumeFromBuffer } = await import('../../src/chains/resumeParsing.js');

    await assert.rejects(
      () => parseResumeFromBuffer(Buffer.from('hello'), 'text/plain'),
      (error: Error) => {
        assert.match(error.message, /Unsupported file type/);
        return true;
      },
    );
  });

  it('keeps DOCX extraction functional', async () => {
    const { parseResumeFromBuffer } = await import('../../src/chains/resumeParsing.js');
    capturedPrompt = '';

    const parsed = await parseResumeFromBuffer(
      buildDocx('NFR078-SYNTHETIC-DOCX-MARKER-9911'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    assert.ok(
      capturedPrompt.includes('NFR078-SYNTHETIC-DOCX-MARKER-9911'),
      `extracted DOCX text must reach the parser prompt; captured prompt was: ${capturedPrompt.slice(0, 400)}`,
    );
    assert.equal(parsed.email, 'synthetic@example.invalid');
  });
});