import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ExportResultCode } from '@opentelemetry/core';
import { BasicTracerProvider, BatchSpanProcessor, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resetLoggerForTests, setLogSink } from '../src/telemetry/logger.js';
import { flushTelemetry, getExportHealth, instrumentExporter, resetLifecycleForTests } from '../src/telemetry/lifecycle.js';

const diagnostics: unknown[] = [];
beforeEach(() => { resetLifecycleForTests(); resetLoggerForTests(); diagnostics.length = 0; setLogSink(record => { diagnostics.push(record); }); });
afterEach(() => { resetLifecycleForTests(); setLogSink(null); });

function health() { return getExportHealth().traces; }
function successfulBoundary() {
  return { export(_items: import('@opentelemetry/sdk-trace-base').ReadableSpan[], callback: (result: import('@opentelemetry/core').ExportResult) => void) { callback({ code: ExportResultCode.SUCCESS }); }, shutdown: async () => {} };
}

test('S07: official SDK exports real finished spans through the health wrapper', async () => {
  const destination = new InMemorySpanExporter();
  const exporter = instrumentExporter('traces', destination, { exportTimeoutMs: 100 });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    const span = provider.getTracer('fixture').startSpan('synthetic.safe_operation'); span.end();
    await flushTelemetry([provider], 1000);
    assert.equal(destination.getFinishedSpans().length, 1);
    assert.equal(destination.getFinishedSpans()[0].name, 'synthetic.safe_operation');
    assert.equal(health().state, 'fresh');
    assert.ok(health().last_success_at);
    assert.equal(health().dropped_items, 0);
  } finally { await provider.shutdown(); }
});

test('S07: synchronous exporter throw is contained and recorded without leaking exception text', async () => {
  const exporter = instrumentExporter('traces', {
    ...successfulBoundary(),
    export() { throw new Error('SYNTHETIC_SECRET_EXPORTER_98312'); },
  }, { exportTimeoutMs: 50 });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    assert.doesNotThrow(() => { const span = provider.getTracer('fixture').startSpan('safe'); span.end(); });
    await flushTelemetry([provider], 1000);
    assert.equal(health().consecutive_failures, 1);
    assert.ok(health().last_failure_at);
    assert.ok(!JSON.stringify({ health: getExportHealth(), diagnostics }).includes('SYNTHETIC_SECRET_EXPORTER_98312'));
  } finally { await provider.shutdown(); }
});

test('S07: hung exporter callback has one timeout completion and ignores late success', async () => {
  let lateCallback: ((result: import('@opentelemetry/core').ExportResult) => void) | undefined;
  const exporter = instrumentExporter('traces', {
    ...successfulBoundary(),
    export(_items: import('@opentelemetry/sdk-trace-base').ReadableSpan[], callback: (result: import('@opentelemetry/core').ExportResult) => void) { lateCallback = callback; },
  }, { exportTimeoutMs: 20 });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const guard = setTimeout(() => {}, 1500);
  try {
    const started = performance.now();
    const span = provider.getTracer('fixture').startSpan('safe'); span.end();
    await flushTelemetry([provider], 1000);
    assert.ok(performance.now() - started < 1000);
    assert.equal(health().timeouts, 1);
    assert.equal(health().consecutive_failures, 1);
    lateCallback!({ code: ExportResultCode.SUCCESS });
    assert.equal(health().timeouts, 1);
    assert.equal(health().consecutive_failures, 1);
    assert.equal(health().last_success_at, undefined);
  } finally { clearTimeout(guard); await provider.shutdown(); }
});

test('S07: repeated failures open the breaker, bound calls and count rejected records', async () => {
  let exports = 0;
  const exporter = instrumentExporter('traces', {
    ...successfulBoundary(),
    export(_items: import('@opentelemetry/sdk-trace-base').ReadableSpan[], callback: (result: import('@opentelemetry/core').ExportResult) => void) { exports++; callback({ code: ExportResultCode.FAILED, error: new Error('synthetic 429') }); },
  }, { breakerThreshold: 2, breakerCooldownMs: 60_000, exportTimeoutMs: 100 });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    for (let index = 0; index < 8; index++) {
      const span = provider.getTracer('fixture').startSpan('safe'); span.end();
      await flushTelemetry([provider], 1000);
    }
    assert.equal(exports, 2);
    assert.equal(health().breaker_open, true);
    assert.ok(health().dropped_items >= 6);
    assert.equal(health().consecutive_failures, 2);
  } finally { await provider.shutdown(); }
});

test('S07: successful recovery resets failure streak and establishes freshness', async () => {
  let failing = true;
  const exporter = instrumentExporter('traces', {
    ...successfulBoundary(),
    export(_items: import('@opentelemetry/sdk-trace-base').ReadableSpan[], callback: (result: import('@opentelemetry/core').ExportResult) => void) { callback({ code: failing ? ExportResultCode.FAILED : ExportResultCode.SUCCESS }); },
  }, { breakerThreshold: 3, exportTimeoutMs: 100 });
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  try {
    provider.getTracer('fixture').startSpan('first').end(); await flushTelemetry([provider], 1000);
    assert.equal(health().consecutive_failures, 1);
    failing = false;
    provider.getTracer('fixture').startSpan('second').end(); await flushTelemetry([provider], 1000);
    assert.equal(health().consecutive_failures, 0);
    assert.equal(health().state, 'fresh');
  } finally { await provider.shutdown(); }
});

test('S07: batch export failure does not prevent application work or unbound buffered spans', async () => {
  const exporter = instrumentExporter('traces', {
    ...successfulBoundary(), export() { /* Fault boundary deliberately never calls back. */ },
  }, { exportTimeoutMs: 20 });
  const provider = new BasicTracerProvider({ spanProcessors: [new BatchSpanProcessor(exporter, { maxQueueSize: 8, maxExportBatchSize: 4, scheduledDelayMillis: 60_000, exportTimeoutMillis: 100 })] });
  const guard = setTimeout(() => {}, 1500);
  try {
    let completed = 0;
    for (let index = 0; index < 100; index++) { provider.getTracer('fixture').startSpan('safe').end(); completed++; }
    assert.equal(completed, 100);
    const result = await flushTelemetry([provider], 1000);
    assert.equal(result.timed_out, false);
    assert.ok(health().timeouts >= 1);
  } finally { clearTimeout(guard); await provider.shutdown(); }
});

test('S07: flush deadline bounds a hung SDK lifecycle and contains rejected flushes', async () => {
  const guard = setTimeout(() => {}, 1500);
  try {
    const result = await flushTelemetry([{ forceFlush: () => new Promise<void>(() => {}) }], 20);
    assert.deepEqual(result, { ok: false, timed_out: true });
    const rejected = await flushTelemetry([{ forceFlush: async () => { throw new Error('SYNTHETIC_PRIVATE_FAILURE'); } }], 100);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.timed_out, false);
    assert.ok(!JSON.stringify(getExportHealth()).includes('SYNTHETIC_PRIVATE_FAILURE'));
  } finally { clearTimeout(guard); }
});
