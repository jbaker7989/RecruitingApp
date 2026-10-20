import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';
import { emptyStore, writeStore } from '../src/models/store.js';
import type { Applicant, JobPosting } from '../src/models/store.js';

const marker = 'synthetic-match-private-492781';
let directory: string;
let telemetry: TestTelemetry;
let oldDataDir: string | undefined;
let oldOpenAIKey: string | undefined;
let oldPineconeKey: string | undefined;
let calculateMatchScore: typeof import('../src/chains/matching.js').calculateMatchScore;
let rebuildSemanticIndex: typeof import('../src/chains/matching.js').rebuildSemanticIndex;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rec-p2-matching-'));
  oldDataDir = process.env.DATA_DIR;
  oldOpenAIKey = process.env.OPENAI_API_KEY;
  oldPineconeKey = process.env.PINECONE_API_KEY;
  process.env.DATA_DIR = directory;
  // The failure fixture intentionally has no provider credential. It must never
  // reach a live SDK call, even if the parent environment has one configured.
  delete process.env.OPENAI_API_KEY;
  delete process.env.PINECONE_API_KEY;
  ({ calculateMatchScore, rebuildSemanticIndex } = await import('../src/chains/matching.js'));
  telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
  const data = emptyStore();
  data.applicants.push({
    id: marker, employmentHistory: [], educationHistory: [],
  } as Applicant);
  data.jobs.push({
    id: marker, isActive: true, requirements: [], requiredSkills: [],
    qualifications: [], requiredExperience: 0,
  } as JobPosting);
  await writeStore(data);
});

after(async () => {
  await telemetry?.shutdown();
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  if (oldOpenAIKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldOpenAIKey;
  if (oldPineconeKey === undefined) delete process.env.PINECONE_API_KEY; else process.env.PINECONE_API_KEY = oldPineconeKey;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('S07/S09: a caught semantic failure preserves a valid fallback result and a failed child span', async () => {
  const score = await calculateMatchScore(marker, marker);
  assert.equal(score.semanticScore, 0);
  assert.ok(score.finalScore >= 1);
  await telemetry.flush();
  const failed = telemetry.spans().find(span => span.name === 'vectorstore.semantic_similarity');
  assert.ok(failed);
  assert.notEqual(failed.attributes['app.outcome'], 'success');
  assert.ok(!telemetry.payloadJson().includes(marker));
});

test('S09: a caught rebuild failure is visible as a partial logical outcome', async () => {
  const result = await rebuildSemanticIndex();
  assert.equal(result.jobsIndexed, 0);
  assert.ok(result.errors > 0);
  await telemetry.flush();
  const span = telemetry.spans().filter(item => item.name === 'vectorstore.reindex').at(-1);
  assert.ok(span);
  assert.ok(['partial', 'degraded'].includes(String(span.attributes['app.outcome'])),
    'the outer rebuild must show partial success when an item fails but the call returns');
  assert.ok(!telemetry.payloadJson().includes(marker));
});
