import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ChatOpenAI } from '@langchain/openai';
import { parseResumeFromBuffer } from '../../src/chains/resumeParsing.js';

test('NFR-072: a real PDF produces extracted text for the resume LLM', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-no-network';
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  // Only the paid external LLM is stubbed; PDF extraction executes the real library.
  t.mock.method(ChatOpenAI.prototype, 'invoke', async (prompt: unknown) => ({
    content: JSON.stringify({
      firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '5551234',
      educationHistory: [], employmentHistory: [], skills: [], achievements: [],
      confidenceScores: {}, rawText: String(prompt),
    }),
  }));
  const buffer = readFileSync('tests/fixtures/resume.pdf');
  const original = Buffer.from(buffer);
  const result = await parseResumeFromBuffer(buffer, 'application/pdf');
  assert.match(result.rawText, /Ada Lovelace - Software Engineer/);
  assert.deepEqual(buffer, original, 'parsing must not detach or mutate the caller buffer');
});

test('NFR-072: corrupt PDF reports the parser error, not an API TypeError', async () => {
  await assert.rejects(
    parseResumeFromBuffer(Buffer.from('not a PDF'), 'application/pdf'),
    /Failed to extract text from PDF: .*Invalid PDF structure/,
  );
});
