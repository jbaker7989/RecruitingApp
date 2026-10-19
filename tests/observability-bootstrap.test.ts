import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExportResultCode } from '@opentelemetry/core';
import { createTestTelemetry, forceFlushTelemetry, getTelemetryStatus, getTracer, initTelemetry, shutdownTelemetry } from '../src/telemetry/index.js';
import { setLogSink } from '../src/telemetry/logger.js';

test('S03: repeated initialization returns the same official pipeline and exports once', async () => {
  const telemetry = await createTestTelemetry();
  try {
    assert.equal(initTelemetry(), telemetry.runtime);
    getTracer().startSpan('oauth.token_exchange').end();
    await telemetry.flush();
    assert.equal(telemetry.spans().length, 1);
    assert.equal(getTelemetryStatus().exporting, true);
  } finally { await telemetry.shutdown(); }
});

test('S07: official batch queue overflow reports actual dropped spans through safe SDK diagnostics', async () => {
  const telemetry = await createTestTelemetry({ spanProcessor: 'batch', overrides: { maxQueueSize: 16, maxExportBatchSize: 4, scheduleDelayMs: 60_000 } });
  try {
    for (let index = 0; index < 100; index++) getTracer().startSpan('oauth.token_exchange').end();
    await telemetry.flush();
    const delivered = telemetry.spans().length;
    assert.ok(delivered > 0 && delivered < 100, 'fixture really saturated the official SDK queue');
    // This SDK emits its exact drop warning on the next accepted span after capacity recovers.
    getTracer().startSpan('oauth.token_exchange').end();
    await telemetry.flush();
    assert.equal(getTelemetryStatus().dropped.queueDroppedSpans, 100 - delivered);
    assert.equal(getTelemetryStatus().dropped.exportFailures, 0, 'SDK queue loss is separate from exporter failure');
    assert.equal(telemetry.spans().length, delivered + 1);
  } finally { await telemetry.shutdown(); }
});

test('S03/S07: flush returns false for a failed official SDK export rather than reporting delivery success', async () => {
  setLogSink(() => {});
  initTelemetry({ env: {}, testing: { spanExporter: {
    export(_items, callback) { callback({ code: ExportResultCode.FAILED }); },
    shutdown: async () => {},
  } } });
  try {
    getTracer().startSpan('oauth.token_exchange').end();
    assert.equal(await forceFlushTelemetry(1000), false);
    assert.ok(getTelemetryStatus().dropped.exportFailures > 0);
  } finally { await shutdownTelemetry(); setLogSink(null); }
});
