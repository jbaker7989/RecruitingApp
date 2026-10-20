import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';
import { getEmbeddingsClient, getLLMClient } from '../src/services/llm/index.js';
import { parseResume } from '../src/chains/resumeParsing.js';
import { traceAIInvocation } from '../src/telemetry/ai.js';

const canary = 'synthetic-private-resume-942817';
const oldKey = process.env.OPENAI_API_KEY;
const originalInvoke = Object.getOwnPropertyDescriptor(ChatOpenAI.prototype, 'invoke');
const originalEmbedQuery = Object.getOwnPropertyDescriptor(OpenAIEmbeddings.prototype, 'embedQuery');
const originalEmbedDocuments = Object.getOwnPropertyDescriptor(OpenAIEmbeddings.prototype, 'embedDocuments');
const originalEmbeddingWithRetry = Object.getOwnPropertyDescriptor(OpenAIEmbeddings.prototype, 'embeddingWithRetry');
let telemetry: TestTelemetry;

function fakeInvoke(fn: () => Promise<AIMessage>) {
  // Patching the official SDK object's network entry point leaves the real chain,
  // factory and telemetry wrappers active while making any live call impossible.
  Object.defineProperty(ChatOpenAI.prototype, 'invoke', {
    configurable: true, value: fn,
  });
}

before(() => {
  process.env.OPENAI_API_KEY = 'synthetic-no-network-key';
  telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
});

after(async () => {
  if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
  else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
  if (originalEmbedQuery) Object.defineProperty(OpenAIEmbeddings.prototype, 'embedQuery', originalEmbedQuery);
  else delete (OpenAIEmbeddings.prototype as { embedQuery?: unknown }).embedQuery;
  if (originalEmbedDocuments) Object.defineProperty(OpenAIEmbeddings.prototype, 'embedDocuments', originalEmbedDocuments);
  else delete (OpenAIEmbeddings.prototype as { embedDocuments?: unknown }).embedDocuments;
  if (originalEmbeddingWithRetry) Object.defineProperty(OpenAIEmbeddings.prototype, 'embeddingWithRetry', originalEmbeddingWithRetry);
  else delete (OpenAIEmbeddings.prototype as unknown as { embeddingWithRetry?: unknown }).embeddingWithRetry;
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = oldKey;
  await telemetry?.shutdown();
});

test('S02/S04: actual factory client reports one model call and usage without exporting source text', async () => {
  let calls = 0;
  fakeInvoke(async () => {
    calls += 1;
    return new AIMessage({
      content: JSON.stringify({
        firstName: 'Synthetic', lastName: 'Person', email: 'synthetic@example.invalid',
        phone: '000', educationHistory: [], employmentHistory: [], skills: [],
        achievements: [], confidenceScores: {}, rawText: canary,
      }),
      usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    });
  });
  const response = await getLLMClient('resume-parsing').invoke(canary);
  assert.ok(response instanceof AIMessage);
  assert.equal(calls, 1);
  await telemetry.flush();
  const signal = telemetry.payloadJson();
  assert.ok(!signal.includes(canary));
  assert.ok(!signal.includes('synthetic@example.invalid'));
  assert.ok(telemetry.spans().some(span => /llm|model|chat/i.test(span.name)),
    'the actual factory client invocation must produce an AI operation span');
  assert.ok(telemetry.metrics().length > 0, 'usage must be reported through metrics');
});

test('S02: provider rejection keeps its error identity and hides raw exception text', async () => {
  const failure = new Error(canary);
  fakeInvoke(async () => { throw failure; });
  await assert.rejects(getLLMClient('resume-parsing').invoke(canary), thrown => thrown === failure);
  await telemetry.flush();
  const signal = telemetry.payloadJson();
  assert.ok(!signal.includes(canary));
  assert.ok(telemetry.spans().some(span => /llm|model|chat/i.test(span.name) && span.status.code !== 0),
    'the model attempt must show a sanitized error outcome');
});

test('S04: a direct rejected factory attempt records unknown usage exactly once', async () => {
  const failure = new Error(canary);
  fakeInvoke(async () => { throw failure; });
  await telemetry.flush();
  const beforeUnknown = telemetry.count('app.ai.usage.unknown_count', { 'ai.model': 'gpt-4o' });
  const beforeAttempts = telemetry.count('app.ai.attempt.count', { 'ai.model': 'gpt-4o' });
  await assert.rejects(getLLMClient('resume-parsing').invoke(canary), thrown => thrown === failure);
  await telemetry.flush();
  assert.equal(telemetry.count('app.ai.usage.unknown_count', { 'ai.model': 'gpt-4o' }) - beforeUnknown, 1);
  assert.equal(telemetry.count('app.ai.attempt.count', { 'ai.model': 'gpt-4o' }) - beforeAttempts, 1);
  const attempt = telemetry.spans().filter(span => span.name === 'ai.chat.attempt').at(-1);
  assert.equal(attempt?.attributes['app.outcome'], 'other');
  assert.ok(!telemetry.payloadJson().includes(canary));
});

test('S04: logical usage callback and factory response account for one paid call', async () => {
  const response = new AIMessage({ content: 'synthetic', usage_metadata: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } });
  fakeInvoke(async () => response);
  await telemetry.flush();
  const beforeTokens = telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' });
  const beforeKnown = telemetry.count('app.ai.usage.known_count', { 'app.feature': 'resume_parsing' });
  const before = telemetry.spans().length;
  await traceAIInvocation({ provider: 'openai', model: 'gpt-4o', feature: 'resume_parsing' }, async ctx => {
    const result = await getLLMClient('resume-parsing').invoke(canary);
    ctx.recordUsage(result);
    return result;
  });
  await telemetry.flush();
  assert.equal(telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' }) - beforeTokens, 13);
  assert.equal(telemetry.count('app.ai.usage.known_count', { 'app.feature': 'resume_parsing' }) - beforeKnown, 1);
  const spans = telemetry.spans().slice(before);
  const logical = spans.find(span => span.name === 'ai.chat');
  const attempt = spans.find(span => span.name === 'ai.chat.attempt');
  assert.ok(logical && attempt);
  assert.equal(attempt.parentSpanContext?.spanId, logical.spanContext().spanId);
});

test('S03: actual embedding factory wraps query and document batch while leaving usage unknown', async () => {
  let queries = 0;
  let batches = 0;
  Object.defineProperty(OpenAIEmbeddings.prototype, 'embedQuery', {
    configurable: true, value: async () => { queries++; return [0.25, 0.5]; },
  });
  Object.defineProperty(OpenAIEmbeddings.prototype, 'embedDocuments', {
    configurable: true, value: async (texts: string[]) => { batches++; return texts.map(() => [0.25, 0.5]); },
  });
  const embeddings = getEmbeddingsClient();
  assert.deepEqual(await embeddings.embedQuery(canary), [0.25, 0.5]);
  assert.deepEqual(await embeddings.embedDocuments([canary, canary]), [[0.25, 0.5], [0.25, 0.5]]);
  assert.equal(queries, 1);
  assert.equal(batches, 1);
  await telemetry.flush();
  const spans = telemetry.spans().filter(span => span.name === 'ai.embed');
  assert.equal(spans.length, 2);
  assert.ok(spans.every(span => span.attributes['ai.model'] === 'text-embedding-3-small'));
  assert.ok(!telemetry.payloadJson().includes(canary));
  assert.equal(telemetry.count('app.ai.usage.unknown_count', { 'ai.model': 'text-embedding-3-small' }), 2);
});

test('S02/S04: real resume chain separates one provider attempt from each logical parse outcome', async () => {
  const valid = {
    firstName: 'Synthetic', lastName: 'Person', email: 'synthetic@example.invalid',
    phone: '000', educationHistory: [], employmentHistory: [], skills: [],
    achievements: [], confidenceScores: {}, rawText: canary,
  };
  const responses = [JSON.stringify(valid), '{malformed', JSON.stringify({ ...valid, email: 'invalid' })];
  let calls = 0;
  fakeInvoke(async () => new AIMessage({
    content: responses[calls++]!,
    usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
  }));
  const beforeSpans = telemetry.spans().length;
  await telemetry.flush();
  const beforeTokens = telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' });
  assert.equal((await parseResume(canary)).email, valid.email);
  await assert.rejects(parseResume(canary), /Failed to parse resume JSON/);
  await assert.rejects(parseResume(canary), /Failed to parse resume JSON/);
  assert.equal(calls, 3, 'prompt formatting and validation must reach exactly three fake provider calls');
  await telemetry.flush();
  const spans = telemetry.spans().slice(beforeSpans);
  const logical = spans.filter(span => span.name === 'ai.chat');
  const attempts = spans.filter(span => span.name === 'ai.chat.attempt');
  assert.equal(logical.length, 3);
  assert.equal(attempts.length, 3, 'a parse error does not create another provider attempt');
  assert.ok(attempts.every(attempt => logical.some(parent =>
    attempt.parentSpanContext?.spanId === parent.spanContext().spanId)));
  assert.deepEqual(logical.map(span => span.attributes['ai.parse_outcome']),
    ['success', 'json_failure', 'schema_failure']);
  assert.ok(attempts.every(span => span.attributes['app.outcome'] === 'success'));
  assert.equal(telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' }) - beforeTokens, 54,
    'reported tokens are counted once per provider response, including validation failures');
  assert.ok(!telemetry.payloadJson().includes(canary));
  assert.ok(!telemetry.payloadJson().includes('synthetic@example.invalid'));
});

test('S03: installed embedding methods hit the fake network seam once per query and batch', async () => {
  if (originalEmbedQuery) Object.defineProperty(OpenAIEmbeddings.prototype, 'embedQuery', originalEmbedQuery);
  if (originalEmbedDocuments) Object.defineProperty(OpenAIEmbeddings.prototype, 'embedDocuments', originalEmbedDocuments);
  const requests: Array<{ model: string; input: string | string[] }> = [];
  Object.defineProperty(OpenAIEmbeddings.prototype, 'embeddingWithRetry', {
    configurable: true,
    value: async (request: { model: string; input: string | string[] }) => {
      requests.push(request);
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      return { data: inputs.map(() => ({ embedding: [0.25, 0.5] })) };
    },
  });
  const before = telemetry.spans().length;
  const embedder = getEmbeddingsClient();
  assert.deepEqual(await embedder.embedQuery(canary), [0.25, 0.5]);
  assert.deepEqual(await embedder.embedDocuments([canary, canary]), [[0.25, 0.5], [0.25, 0.5]]);
  assert.deepEqual(requests.map(request => [request.model, Array.isArray(request.input) ? request.input.length : 1]),
    [['text-embedding-3-small', 1], ['text-embedding-3-small', 2]]);
  await telemetry.flush();
  const spans = telemetry.spans().slice(before).filter(span => span.name === 'ai.embed');
  assert.equal(spans.length, 2, 'installed embedQuery does not nest embedDocuments in this SDK version');
  assert.deepEqual(spans.map(span => span.attributes['ai.operation']), ['embed_query', 'embed_batch']);
  assert.ok(!telemetry.payloadJson().includes(canary));
});
