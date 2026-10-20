import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { trace } from '@opentelemetry/api';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';
import { traceAIInvocation } from '../src/telemetry/ai.js';
import { registerSafeNames } from '../src/telemetry/privacy.js';

const canary = 'synthetic-private-output-840271';
let telemetry: TestTelemetry;

before(() => {
  registerSafeNames({ spans: ['synthetic-root'] });
  telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
});
after(async () => { await telemetry?.shutdown(); });

test('S02/S04: a parented model response records exact nonoverlapping token categories', async () => {
  const value = await trace.getTracer('p2-test').startActiveSpan('synthetic-root', async root => {
    try {
      return await traceAIInvocation({ provider: 'openai', model: 'gpt-4o', feature: 'resume_parsing' }, async ctx => {
        ctx.recordUsage({ response_metadata: { usage: {
          prompt_tokens: 120, completion_tokens: 45,
          prompt_tokens_details: { cached_tokens: 20 },
          completion_tokens_details: { reasoning_tokens: 15 },
        } } });
        return canary;
      });
    } finally { root.end(); }
  });
  assert.equal(value, canary);
  await telemetry.flush();
  const span = telemetry.spans().find(item => item.name === 'ai.chat');
  const root = telemetry.spans().find(item => item.name === 'synthetic-root');
  assert.ok(span);
  assert.ok(root);
  assert.equal(span.parentSpanContext?.spanId, root.spanContext().spanId);
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'input' }), 100);
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'cache_read' }), 20);
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'output' }), 30);
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'reasoning' }), 15);
  assert.ok(!telemetry.payloadJson().includes(canary));
});

test('S02: provider success followed by malformed JSON is distinct from provider failure', async () => {
  const failure = new SyntaxError(canary);
  await assert.rejects(traceAIInvocation({ provider: 'openai', model: 'gpt-4o' }, async ctx => {
    ctx.recordUsage({ usage_metadata: { input_tokens: 3, output_tokens: 2 } });
    ctx.markParseOutcome('json_failure');
    throw failure;
  }), thrown => thrown === failure);
  await telemetry.flush();
  const span = telemetry.spans().filter(item => item.name === 'ai.chat').at(-1);
  assert.ok(span);
  assert.equal(span.attributes['ai.parse_outcome'], 'json_failure');
  assert.equal(span.attributes['error.type'], 'parse');
  assert.ok(!telemetry.payloadJson().includes(canary));
});

test('S02: aborted invocation preserves the original error and records a bounded outcome', async () => {
  const failure = Object.assign(new Error(canary), { name: 'AbortError' });
  await assert.rejects(traceAIInvocation({ provider: 'openai', model: 'gpt-4o' }, async () => {
    throw failure;
  }), thrown => thrown === failure);
  await telemetry.flush();
  const span = telemetry.spans().filter(item => item.name === 'ai.chat').at(-1);
  assert.ok(span);
  assert.equal(span.attributes['app.outcome'], 'aborted');
  assert.ok(!telemetry.payloadJson().includes(canary));
});

test('S04: unrecognized request features cannot create one metric series per caller value', async () => {
  for (let index = 0; index < 40; index++) {
    await traceAIInvocation({
      provider: 'openai', model: 'gpt-4o', feature: `synthetic_unique_${index}`,
    }, async () => 'synthetic');
  }
  await telemetry.flush();
  const features = new Set<string>();
  for (const rm of telemetry.latestMetrics()?.scopeMetrics ?? []) {
    for (const metric of rm.metrics) {
      if (metric.descriptor.name !== 'app.ai.invocation.count') continue;
      for (const point of metric.dataPoints) {
        const feature = point.attributes['app.feature'];
        if (typeof feature === 'string' && feature.startsWith('synthetic_unique_')) features.add(feature);
      }
    }
  }
  assert.equal(features.size, 0, 'unrecognized caller features should normalize to a static fallback');
});

test('S04: duplicate usage callback for one provider response does not bill twice', async () => {
  const response = { usage_metadata: { input_tokens: 9, output_tokens: 4 } };
  await telemetry.flush();
  const before = telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' });
  await traceAIInvocation({ provider: 'openai', model: 'gpt-4o', feature: 'resume_parsing' }, async ctx => {
    ctx.recordUsage(response);
    ctx.recordUsage(response);
    return 'synthetic';
  });
  await telemetry.flush();
  assert.equal(telemetry.count('app.ai.tokens', { 'app.feature': 'resume_parsing' }) - before, 13);
});

test('S04: rejected provider response without reported usage increments unknown coverage once', async () => {
  const failure = new Error(canary);
  await telemetry.flush();
  const before = telemetry.count('app.ai.usage.unknown_count', { 'app.feature': 'resume_parsing' });
  await assert.rejects(traceAIInvocation({ provider: 'openai', model: 'gpt-4o', feature: 'resume_parsing' },
    async () => { throw failure; }), thrown => thrown === failure);
  await telemetry.flush();
  assert.equal(telemetry.count('app.ai.usage.unknown_count', { 'app.feature': 'resume_parsing' }) - before, 1);
});
