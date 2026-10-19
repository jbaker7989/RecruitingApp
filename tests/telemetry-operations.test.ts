import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { logger, setLogSink, resetLoggerForTests, runWithEntryPoint, type LogRecord } from '../src/telemetry/logger.js';
import { instrumentExporter, getExportHealth, resetLifecycleForTests, flushTelemetry } from '../src/telemetry/lifecycle.js';
import { classifyFailure, OAuthFlowError, parseCorrelation } from '../src/telemetry/providerOps.js';
import { getRuntimeSnapshot, resetRuntimeForTests } from '../src/telemetry/runtime.js';

const records: LogRecord[] = [];
beforeEach(() => {
  records.length = 0;
  resetLoggerForTests();
  resetLifecycleForTests();
  resetRuntimeForTests();
  setLogSink((r) => records.push(r));
});

test('logger never emits error text and drops non-allow-listed attrs', () => {
  const canary = 'CANARY_MODEL_OUTPUT_7731';
  logger.error('chain.failed', { error: new Error(canary), attrs: { resume: canary, status_code: 500, method: 'has space and PII' } });
  assert.equal(JSON.stringify(records).includes(canary), false);
  assert.equal(records[0].category, 'error');
  assert.deepEqual(records[0].attrs, { status_code: 500, method: '[redacted]' });
});

test('logger stamps entry point without any span and bounds volume', () => {
  process.env.LOG_EVENT_BURST = '3';
  try {
    runWithEntryPoint('scheduled', () => { for (let i = 0; i < 10; i++) logger.info('job.tick'); });
  } finally { delete process.env.LOG_EVENT_BURST; }
  assert.equal(records.length, 3);
  assert.equal(records[0].entry_point, 'scheduled');
  assert.ok(records[0].run_id);
  assert.equal(records[0].trace_id, undefined);
});

test('exporter wrapper times out, opens breaker, never throws, reports health', async () => {
  let calls = 0;
  const hung = { export: () => { calls += 1; }, shutdown: async () => {} };
  const wrapped = instrumentExporter('traces', hung, { exportTimeoutMs: 20, breakerThreshold: 2, breakerCooldownMs: 60_000 });
  const results: number[] = [];
  const run = () => new Promise<void>((r) => wrapped.export([1, 2], (res) => { results.push(res.code); r(); }));
  await run(); await run(); await run(); // third is dropped by the open breaker without calling the exporter
  assert.deepEqual(results, [1, 1, 1]);
  assert.equal(calls, 2);
  const h = getExportHealth().traces;
  assert.equal(h.breaker_open, true);
  assert.equal(h.timeouts, 2);
  assert.equal(h.dropped_items, 6);
  assert.equal(h.state, 'never');
  assert.equal(h.queue_saturation, 'unmeasured');
});

test('successful export is fresh; disabled flag reports disabled, not healthy', async () => {
  const ok = { export: (_i: unknown, cb: (r: { code: number }) => void) => cb({ code: 0 }), shutdown: async () => {} };
  const w = instrumentExporter('metrics', ok);
  await new Promise<void>((r) => w.export([1], () => r()));
  assert.equal(getExportHealth().metrics.state, 'fresh');
  process.env.OTEL_SDK_DISABLED = 'true';
  try { assert.equal(getExportHealth().metrics.state, 'disabled'); } finally { delete process.env.OTEL_SDK_DISABLED; }
});

test('flushTelemetry is bounded and never rejects', async () => {
  const t = Date.now();
  const r = await flushTelemetry([{ forceFlush: () => new Promise(() => {}) }, { forceFlush: async () => { throw new Error('x'); } }], 50);
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t < 500);
});

test('provider failure taxonomy and correlation parsing are bounded', () => {
  assert.equal(classifyFailure(undefined, 429), 'rate_limited');
  assert.equal(classifyFailure(undefined, 503), 'server_error');
  assert.equal(classifyFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'dns_failure');
  assert.equal(classifyFailure(new OAuthFlowError('m', 'invalid_state')), 'invalid_state');
  assert.equal(parseCorrelation('not-a-correlation'), undefined);
  assert.ok(parseCorrelation(`${'a'.repeat(32)}-${'b'.repeat(16)}`));
});

test('runtime snapshot marks unsupported platform metrics unavailable', () => {
  const s = getRuntimeSnapshot();
  assert.ok(s.unavailable.some((u) => u.signal === 'cpu_throttling'));
  assert.ok(s.memory.rss > 0);
});
