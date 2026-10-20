import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestTelemetry, type TestTelemetry } from '../src/telemetry/testing.js';
import { traceAIInvocation, traceEmbedding } from '../src/telemetry/ai.js';

let telemetry: TestTelemetry;
before(() => { telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 0 } }); });
after(async () => { await telemetry?.shutdown(); });

test('S03/S04: unsampled AI calls still contribute exact reported tokens and explicit unknown embedding usage', async () => {
  await traceAIInvocation({ feature: 'resume_parsing', provider: 'openai', model: 'gpt-4o' }, async ctx => {
    ctx.recordUsage({ usage_metadata: { input_tokens: 7, output_tokens: 5 } });
    return 'synthetic';
  });
  await traceEmbedding({ feature: 'resume_parsing', operation: 'embed_query', model: 'text-embedding-3-small' },
    async () => [0.25, 0.5]);
  await telemetry.flush();
  assert.equal(telemetry.spans().length, 0, 'sampling at zero should export no trace spans');
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'input' }), 7);
  assert.equal(telemetry.count('app.ai.tokens', { 'ai.token_category': 'output' }), 5);
  assert.equal(telemetry.count('app.ai.usage.unknown_count', { 'ai.model': 'text-embedding-3-small' }), 1);
  assert.equal(telemetry.count('app.ai.invocation.count'), 2);
});
