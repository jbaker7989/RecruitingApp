import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pinecone } from '@pinecone-database/pinecone';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';

const marker = 'synthetic-applicant-837492';
const originalIndex = Object.getOwnPropertyDescriptor(Pinecone.prototype, 'index');
const oldKey = process.env.PINECONE_API_KEY;
let telemetry: TestTelemetry;
let store: import('../src/services/vectorStore/pinecone.js').PineconeVectorStore;

const calls = { query: 0, fetch: 0, upsert: 0, delete: 0 };
let queryFailure: Error | undefined;
let lastQuery: Record<string, unknown> | undefined;
const fakeIndex = {
  query: async (query: Record<string, unknown>) => {
    calls.query++;
    lastQuery = query;
    if (queryFailure) throw queryFailure;
    return { matches: [] };
  },
  fetch: async () => { calls.fetch++; return { records: {} }; },
  upsert: async () => { calls.upsert++; return {}; },
  deleteOne: async () => { calls.delete++; return {}; },
};

before(async () => {
  process.env.PINECONE_API_KEY = 'synthetic-no-network-key';
  Object.defineProperty(Pinecone.prototype, 'index', { configurable: true, value: () => fakeIndex });
  const mod = await import('../src/services/vectorStore/pinecone.js');
  store = new mod.PineconeVectorStore();
  telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
});

after(async () => {
  if (originalIndex) Object.defineProperty(Pinecone.prototype, 'index', originalIndex);
  else delete (Pinecone.prototype as { index?: unknown }).index;
  if (oldKey === undefined) delete process.env.PINECONE_API_KEY;
  else process.env.PINECONE_API_KEY = oldKey;
  await telemetry?.shutdown();
});

test('S07: actual query/fetch/upsert/delete methods preserve results and keep records out of exported telemetry', async () => {
  assert.deepEqual(await store.similaritySearch([837492], { entityIds: [marker] }, 4), []);
  assert.equal(await store.getEntry(marker), undefined);
  await store.addEntry(marker, 'applicant', marker, marker, [837492]);
  await store.deleteEntry(marker);
  assert.deepEqual(calls, { query: 1, fetch: 1, upsert: 1, delete: 1 });

  await telemetry.flush();
  const spans = telemetry.spans();
  for (const op of ['query', 'fetch', 'upsert', 'delete']) {
    assert.equal(spans.filter(span => span.name === `pinecone.${op}`).length, 1, `${op} needs one real SDK-call span`);
  }
  assert.ok(!telemetry.payloadJson().includes(marker));
  assert.ok(!telemetry.payloadJson().includes('837492'));
  assert.equal(telemetry.count('app.pinecone.operation.count'), 4);
});

test('S07: timeout preserves the same error object and differs from an empty search', async () => {
  const error = Object.assign(new Error(marker), { name: 'TimeoutError' });
  queryFailure = error;
  try {
    await assert.rejects(store.similaritySearch([837492], undefined, 4), thrown => thrown === error);
  } finally {
    queryFailure = undefined;
  }
  await telemetry.flush();
  const timeout = telemetry.spans().filter(span => span.name === 'pinecone.query').at(-1);
  assert.ok(timeout);
  assert.notEqual(timeout.attributes['app.outcome'], 'success');
  assert.ok(!telemetry.payloadJson().includes(marker));
  assert.equal(telemetry.count('app.pinecone.operation.count'), 5);
});

test('S07: empty result preserves requested topK and records an empty outcome', async () => {
  const before = telemetry.spans().length;
  assert.deepEqual(await store.similaritySearch([0.25, 0.5], { entityType: 'job' }, 7), []);
  assert.equal(lastQuery?.topK, 7);
  await telemetry.flush();
  const query = telemetry.spans().slice(before).find(span => span.name === 'pinecone.query');
  assert.ok(query);
  assert.equal(query.attributes['app.outcome'], 'empty');
  assert.equal(query.attributes['app.count_bucket'], '0');
});

test('S07: auth and rate-limit failures retain error identity and bounded classification', async () => {
  for (const [status, outcome] of [[401, 'client_error'], [429, 'rate_limited']] as const) {
    const failure = Object.assign(new Error(marker), { status });
    queryFailure = failure;
    const before = telemetry.spans().length;
    try {
      await assert.rejects(store.similaritySearch([0.25], undefined, 2), thrown => thrown === failure);
    } finally { queryFailure = undefined; }
    await telemetry.flush();
    const query = telemetry.spans().slice(before).find(span => span.name === 'pinecone.query');
    assert.ok(query);
    assert.equal(query.attributes['app.outcome'], outcome);
    assert.ok(!telemetry.payloadJson().includes(marker));
  }
});
