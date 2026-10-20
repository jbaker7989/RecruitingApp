import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { trace } from '@opentelemetry/api';
import { createTestTelemetry } from '../src/telemetry/testing.js';
import { traceAIInvocation } from '../src/telemetry/ai.js';

let telemetry: ReturnType<typeof createTestTelemetry>;
before(() => { telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } }); });
after(async () => { await telemetry?.shutdown(); });

test('S02: throwing tracer start never repeats the callback or changes its result', async t => {
  t.mock.method(trace, 'getTracer', () => ({ startSpan: () => { throw new Error('synthetic tracer failure'); } }));
  let calls = 0;
  const result = await traceAIInvocation({ provider: 'openai', model: 'gpt-4o' }, async () => {
    calls++;
    return 'business-result';
  });
  assert.equal(result, 'business-result');
  assert.equal(calls, 1);
});

test('S02: throwing span mutation and end preserve original business error', async t => {
  t.mock.method(trace, 'getTracer', () => ({ startSpan: () => ({
    spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }),
    setAttribute: () => { throw new Error('synthetic mutation failure'); },
    setStatus: () => { throw new Error('synthetic status failure'); },
    end: () => { throw new Error('synthetic end failure'); },
  }) }));
  const failure = new Error('business failure');
  let calls = 0;
  await assert.rejects(traceAIInvocation({ provider: 'openai', model: 'gpt-4o' }, async () => {
    calls++;
    throw failure;
  }), thrown => thrown === failure);
  assert.equal(calls, 1);
});
