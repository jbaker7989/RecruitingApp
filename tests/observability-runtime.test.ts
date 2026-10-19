import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { get } from 'node:http';
import { metrics } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { concurrencyMiddleware, getRuntimeSnapshot, recordStartupFailure, registerRuntimeMetrics, resetRuntimeForTests } from '../src/telemetry/runtime.js';
import { diagnosticsHandler, readinessHandler, registerDependency, resetDependenciesForTests } from '../src/telemetry/dependencies.js';
import { getExportHealth, recordExportResult, resetLifecycleForTests } from '../src/telemetry/lifecycle.js';
import { logger, logContextMiddleware, resetLoggerForTests, setLogSink } from '../src/telemetry/logger.js';

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
const provider = new MeterProvider({ readers: [reader] });
const logs: Record<string, unknown>[] = [];
before(() => { metrics.setGlobalMeterProvider(provider); });
beforeEach(() => {
  resetRuntimeForTests(); resetDependenciesForTests(); resetLifecycleForTests(); resetLoggerForTests(); logs.length = 0;
  setLogSink(record => { logs.push(record as unknown as Record<string, unknown>); });
});
after(async () => { resetRuntimeForTests(); resetDependenciesForTests(); resetLifecycleForTests(); setLogSink(null); await provider.shutdown(); metrics.disable(); });

async function fixture(run: (base: string, app: express.Express) => Promise<void>) {
  const app = express();
  app.use(logContextMiddleware()); app.use(concurrencyMiddleware());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, app); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function jsonRequest(url: string, authorization?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    get(url, { headers: authorization ? { authorization } : {} }, response => {
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

test('S09: real concurrent responses release runtime in-flight exactly once on finish and close', async () => {
  await fixture(async (base, app) => {
    let entered = 0;
    let allEntered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { allEntered = resolve; });
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    app.get('/work', async (_req, res) => { if (++entered === 12) allEntered(); await barrier; res.json({ ok: true }); });
    const responses = Array.from({ length: 12 }, () => jsonRequest(base + '/work'));
    await enteredPromise;
    assert.equal(getRuntimeSnapshot().concurrency.in_flight, 12);
    release(); await Promise.all(responses);
    const snapshot = getRuntimeSnapshot();
    assert.equal(snapshot.concurrency.in_flight, 0);
    assert.equal(snapshot.concurrency.total_requests, 12);
    assert.equal(snapshot.concurrency.peak_in_flight, 12);
    assert.equal(snapshot.cold_start, false);
    assert.ok(snapshot.memory.rss > 0 && snapshot.memory.heap_used > 0);
    assert.ok(snapshot.unavailable.some(item => item.signal === 'cpu_throttling'));
    assert.ok(snapshot.unavailable.some(item => item.signal === 'platform_concurrency_limit'));
  });
});

test('S09: official runtime gauges expose process samples and bounded startup categories', async () => {
  registerRuntimeMetrics(); registerRuntimeMetrics();
  recordStartupFailure('startup'); recordStartupFailure('SYNTHETIC_SECRET_CATEGORY_93812');
  const { resourceMetrics, errors } = await reader.collect();
  assert.equal(errors.length, 0);
  const recorded = resourceMetrics.scopeMetrics.flatMap(scope => scope.metrics);
  const rss = recorded.find(metric => metric.descriptor.name === 'app.runtime.memory.rss');
  assert.ok(rss && Number(rss.dataPoints[0].value) > 0);
  const failures = recorded.find(metric => metric.descriptor.name === 'app.runtime.startup.failures');
  assert.ok(failures);
  assert.deepEqual(new Set(failures.dataPoints.map(point => point.attributes.category)), new Set(['startup', 'other']));
  assert.equal(getRuntimeSnapshot().startup_failures, 2);
});

test('S08/S09: real readiness responses retain public-safe status and request failure log context', async () => {
  registerDependency({ name: 'required_store', required: true, check: async () => { throw new Error('SYNTHETIC_PRIVATE_HOST_93812'); } });
  await fixture(async (base, app) => {
    app.get('/ready', readinessHandler);
    const response = await jsonRequest(base + '/ready');
    assert.equal(response.status, 503);
    assert.equal(response.body.status, 'not_ready');
    assert.ok(!JSON.stringify(response.body).includes('SYNTHETIC_PRIVATE_HOST_93812'));
    const failure = logs.find(log => log.event === 'http.request.failed');
    assert.ok(failure);
    assert.equal(failure.entry_point, 'http');
    assert.equal(typeof failure.request_id, 'string');
    assert.ok(!failure.trace_id, 'logs tolerate absent tracing');
  });
});

test('S09: diagnostics are hidden without authorization and authenticated output disclaims durability', async () => {
  process.env.TELEMETRY_DIAGNOSTICS_TOKEN = 'synthetic-diagnostics-test-93812';
  try {
    await fixture(async (base, app) => {
      app.get('/diagnostics', diagnosticsHandler);
      assert.equal((await jsonRequest(base + '/diagnostics')).status, 404);
      assert.equal((await jsonRequest(base + '/diagnostics', 'Bearer wrong-synthetic-token')).status, 404);
      const authorized = await jsonRequest(base + '/diagnostics', 'Bearer synthetic-diagnostics-test-93812');
      assert.equal(authorized.status, 200);
      assert.match(String(authorized.body.durability_note), /does not assert audit-store durability/);
      assert.ok(!JSON.stringify(authorized.body).includes('synthetic-diagnostics-test-93812'));
    });
  } finally { delete process.env.TELEMETRY_DIAGNOSTICS_TOKEN; }
});

test('S07/S09: last-success freshness separates never, fresh, stale and disabled states', () => {
  assert.equal(getExportHealth(1000).traces.state, 'never');
  recordExportResult({ signal: 'traces', ok: true, at: 1000 });
  assert.equal(getExportHealth(1001).traces.state, 'fresh');
  assert.equal(getExportHealth(1_000_000).traces.state, 'stale');
  recordExportResult({ signal: 'traces', ok: false, category: 'timeout', at: 1_000_000 });
  assert.equal(getExportHealth(1_000_001).traces.state, 'stale');
  process.env.OTEL_SDK_DISABLED = 'true';
  try { assert.equal(getExportHealth().traces.state, 'disabled'); }
  finally { delete process.env.OTEL_SDK_DISABLED; }
});

test('S08: per-event log storms are bounded and a failing sink cannot break application work', () => {
  for (let index = 0; index < 500; index++) logger.warn('telemetry.export.failed', { outcome: 'failed' });
  assert.ok(logs.length > 0 && logs.length <= 50);
  setLogSink(() => { throw new Error('synthetic sink failure'); });
  assert.doesNotThrow(() => logger.error('server.start_failed', { outcome: 'failed' }));
});
