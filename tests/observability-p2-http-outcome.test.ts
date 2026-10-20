import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SpanKind } from '@opentelemetry/api';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage } from '@langchain/core/messages';
import { createTestTelemetry } from '../src/telemetry/testing.js';
import { telemetryMiddleware } from '../src/telemetry/http.js';
import { parseResume } from '../src/chains/resumeParsing.js';

test('S02: caught malformed model output marks an HTTP 200 request as validation failure', async () => {
  const telemetry = createTestTelemetry({ overrides: { traceSampleRatio: 1 } });
  const previousKey = process.env.OPENAI_API_KEY;
  const originalInvoke = Object.getOwnPropertyDescriptor(ChatOpenAI.prototype, 'invoke');
  process.env.OPENAI_API_KEY = 'synthetic-no-network-key';
  let calls = 0;
  Object.defineProperty(ChatOpenAI.prototype, 'invoke', { configurable: true, value: async () => {
    calls++;
    return new AIMessage({ content: '{malformed', usage_metadata: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } });
  } });
  const app = express();
  app.use(telemetryMiddleware());
  app.get('/p2/malformed', async (_req, res) => {
    try { await parseResume('SYNTHETIC_PRIVATE_RESUME_7301'); }
    catch { res.status(200).json({ handled: true }); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/p2/malformed`, { headers: { 'x-telemetry-synthetic': '1' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { handled: true });
    assert.equal(calls, 1);
    await telemetry.flush();
    const root = telemetry.spans().find(span => span.kind === SpanKind.SERVER && span.name === 'GET /p2/malformed');
    const logical = telemetry.spans().find(span => span.name === 'ai.chat');
    const attempt = telemetry.spans().find(span => span.name === 'ai.chat.attempt');
    assert.ok(root && logical && attempt);
    assert.equal(root.attributes['app.outcome'], 'validation_error');
    assert.equal(root.attributes['error.type'], 'validation');
    assert.equal(logical.attributes['ai.parse_outcome'], 'json_failure');
    assert.equal(attempt.attributes['app.outcome'], 'success');
    assert.equal(telemetry.count('http.server.request.duration', { 'app.outcome': 'validation_error' }), 1);
    assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_PRIVATE_RESUME_7301'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (originalInvoke) Object.defineProperty(ChatOpenAI.prototype, 'invoke', originalInvoke);
    else delete (ChatOpenAI.prototype as { invoke?: unknown }).invoke;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    await telemetry.shutdown();
  }
});
