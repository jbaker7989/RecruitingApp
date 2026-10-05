// Exercise only modules from the supplied deployment bundle, not repository node_modules.
// Run with Node's --experimental-import-meta-resolve to honor the parent URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const sourceDir = process.argv[4] ?? 'dist'; // nft traces dist; Vercel transpiles into src.
const parent = pathToFileURL(join(root, 'package.json')).href;
const { app } = await import(pathToFileURL(join(root, sourceDir, 'index.js')).href);
const { ChatOpenAI } = await import(import.meta.resolve('@langchain/openai', parent));
const { PromptTemplate } = await import(import.meta.resolve('@langchain/core/prompts', parent));
const { parseResumeFromBuffer } = await import(pathToFileURL(join(root, sourceDir, 'chains/resumeParsing.js')).href);
process.env.OPENAI_API_KEY = 'test-only-no-network';
// Only downstream prompt/LLM work is stubbed: NFR-078 is separately tracked.
PromptTemplate.prototype.format = async (values) => values.resumeText;
ChatOpenAI.prototype.invoke = async (text) => ({ content: JSON.stringify({
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '5551234',
  educationHistory: [], employmentHistory: [], skills: [], achievements: [],
  confidenceScores: {}, rawText: text,
}) });
const buffer = readFileSync(process.argv[3]);
const result = await parseResumeFromBuffer(buffer, 'application/pdf');
assert.match(result.rawText, /Ada Lovelace - Software Engineer/);
await assert.rejects(parseResumeFromBuffer(Buffer.from('corrupt'), 'application/pdf'), /Invalid PDF structure/);

const server = app.listen(0, '127.0.0.1');
await new Promise((ready) => server.once('listening', ready));
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
} finally {
  await new Promise((closed) => server.close(closed));
}
console.log('pdf-bundle=ok health=200 real-pdf=ok corrupt-pdf=rejected');
