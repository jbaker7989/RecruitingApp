import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import express from 'express';
import { trace } from '@opentelemetry/api';
import {
  createTestTelemetry, getTracer, initTelemetry, loadTelemetryConfig, forceFlushTelemetry, shutdownTelemetry,
  startOtlpSink, telemetryMiddleware, getTelemetryStatus, isPropagationAllowed,
} from '../src/telemetry/index.js';

async function withApp(setup: (app: express.Express) => void, run: (base: string, port: number) => Promise<void>) {
  const app = express();
  app.use(telemetryMiddleware());
  setup(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  try { await run(`http://127.0.0.1:${port}`, port); } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('default is OFF: no SDK registered, middleware still assigns a request id', async () => {
  const rt = initTelemetry({ env: {} });
  assert.equal(rt.enabled, false);
  assert.equal(getTelemetryStatus().exporting, false);
  assert.equal(trace.getTracer('x').startSpan('s').isRecording(), false);
  await withApp((a) => a.get('/ping', (_q, s) => s.json({ ok: true })), async (base) => {
    const r = await fetch(`${base}/ping`, { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.match(r.headers.get('x-request-id') ?? '', /^[A-Za-z0-9_-]{8,64}$/);
  });
});

test('config: bounded values, remote export rejected, diagnostics never echo values', () => {
  const secret = 'SYNTHETIC_SECRET_93812';
  const { config, diagnostics } = loadTelemetryConfig({
    TELEMETRY_ENABLED: 'true',
    OTEL_EXPORTER_OTLP_ENDPOINT: `https://user:${secret}@collector.example.com`,
    TELEMETRY_TRACE_SAMPLE_RATIO: '7', TELEMETRY_MAX_QUEUE_SIZE: '99999999', OTEL_SERVICE_NAME: `bad name ${secret}`,
  });
  assert.equal(config.tracesEndpoint, undefined);
  assert.equal(config.traceSampleRatio, 1);
  assert.equal(config.maxQueueSize, 512);
  assert.equal(config.serviceName, 'rec-app');
  assert.ok(diagnostics.length >= 3);
  assert.ok(!JSON.stringify(diagnostics).includes(secret));
  const ok = loadTelemetryConfig({ TELEMETRY_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' });
  assert.equal(ok.config.tracesEndpoint, 'http://127.0.0.1:4318/v1/traces');
  assert.equal(ok.config.metricsEndpoint, 'http://127.0.0.1:4318/v1/metrics');
  const missing = loadTelemetryConfig({ TELEMETRY_ENABLED: 'true' });
  assert.ok(missing.diagnostics.some((d) => d.includes('missing_export_disabled')));
});

test('real OTLP/HTTP export: trace + histogram reach a loopback sink with service/env/release', async () => {
  const sink = await startOtlpSink();
  const rt = initTelemetry({
    env: { TELEMETRY_ENVIRONMENT: 'preview', TELEMETRY_RELEASE: 'abc123' },
    overrides: { enabled: true, tracesEndpoint: `${sink.url}/v1/traces`, metricsEndpoint: `${sink.url}/v1/metrics`, scheduleDelayMs: 100 },
  });
  assert.equal(rt.exporting, true);
  try {
    await withApp((a) => a.get('/api/jobs/:id', (_q, s) => s.json({ ok: true })), async (base) => {
      await fetch(`${base}/api/jobs/12345?token=SYNTHETIC_CODE_93812`);
    });
    assert.equal(await forceFlushTelemetry(5000), true);
    const body = JSON.stringify(sink.requests.map((r) => r.json));
    assert.ok(sink.requests.some((r) => r.path === '/v1/traces'));
    assert.ok(sink.requests.some((r) => r.path === '/v1/metrics'));
    assert.match(body, /GET \/api\/jobs\/:id/);
    assert.match(body, /"preview"/);
    assert.match(body, /abc123/);
    assert.match(body, /http\.server\.request\.duration/);
    assert.ok(!body.includes('SYNTHETIC_CODE_93812'));
    assert.ok(!body.includes('12345'));
  } finally {
    await shutdownTelemetry();
    await sink.close();
  }
});

test('exporter outage is bounded and fail-open for requests', async () => {
  const sink = await startOtlpSink({ mode: 'hang' });
  initTelemetry({ env: {}, overrides: { enabled: true, tracesEndpoint: `${sink.url}/v1/traces`, metricsEndpoint: `${sink.url}/v1/metrics`, exportTimeoutMs: 500, scheduleDelayMs: 100, shutdownTimeoutMs: 500 } });
  try {
    await withApp((a) => a.get('/x', (_q, s) => s.send('ok')), async (base) => {
      const t0 = Date.now();
      assert.equal((await fetch(`${base}/x`)).status, 200);
      assert.ok(Date.now() - t0 < 1000);
    });
    const t1 = Date.now();
    await forceFlushTelemetry(800);
    assert.ok(Date.now() - t1 < 2500);
  } finally {
    const t2 = Date.now();
    await shutdownTelemetry(800);
    assert.ok(Date.now() - t2 < 2500);
    await sink.close();
  }
});

test('outbound traceparent only goes to allow-listed destinations; client span kept for denied ones', async () => {
  const seen: Array<string | undefined> = [];
  const target = createServer((req, res) => { seen.push(req.headers.traceparent as string | undefined); res.end('ok'); });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const port = (target.address() as { port: number }).port;
  try {
    for (const allow of [[], [`127.0.0.1:${port}`]]) {
      const t = createTestTelemetry({ overrides: { propagationAllowlist: allow } });
      await getTracer().startActiveSpan('app.parent', async (span) => {
        await fetch(`http://127.0.0.1:${port}/`);
        span.end();
      });
      await t.flush();
      assert.ok(t.spans().some((s) => s.kind === 2), 'client span exists');
      await t.shutdown();
    }
    assert.equal(seen[0], undefined);
    assert.match(seen[1] ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    assert.equal(isPropagationAllowed('http://evil.example/', { propagationAllowlist: ['127.0.0.1'] }), false);
  } finally {
    await new Promise<void>((r) => target.close(() => r()));
  }
});

test('inbound traceparent: ignored by default; trusted continuation cannot force sampling', async () => {
  const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  for (const [trust, ratio, expectContinue, expectSpans] of [[false, 1, false, 1], [true, 1, true, 1], [true, 0, true, 0]] as const) {
    const t = createTestTelemetry({ overrides: { trustInboundTrace: trust, traceSampleRatio: ratio } });
    await withApp((a) => a.get('/x', (_q, s) => s.send('ok')), async (base) => {
      await fetch(`${base}/x`, { headers: { traceparent: tp, tracestate: 'vendor=SYNTHETIC_CODE_93812', baggage: 'k=v' } });
    });
    await t.flush();
    const server = t.spans().find((s) => s.kind === 1);
    assert.equal(t.spans().length >= expectSpans && (expectSpans === 0 ? t.spans().length === 0 : true), true);
    if (server) assert.equal(server.spanContext().traceId === '0af7651916cd43dd8448eb211c80319c', expectContinue);
    assert.ok(!t.payloadJson().includes('SYNTHETIC_CODE_93812'));
    await t.shutdown();
  }
});

test('client disconnect is observed once as aborted', async () => {
  const t = createTestTelemetry();
  try {
    await withApp((a) => a.get('/slow', (_q, s) => { setTimeout(() => s.send('late'), 150); }), async (_base, port) => {
      const sock = connect(port, '127.0.0.1');
      await new Promise<void>((r) => sock.once('connect', r));
      sock.write('GET /slow HTTP/1.1\r\nHost: x\r\n\r\n');
      await new Promise((r) => setTimeout(r, 30));
      sock.destroy();
      await new Promise((r) => setTimeout(r, 300));
    });
    await t.flush();
    assert.equal(t.count('http.server.request.duration'), 1);
    assert.equal(t.count('http.server.request.duration', { 'app.outcome': 'aborted' }), 1);
  } finally { await t.shutdown(); }
});

test('metric attributes never include identifiers or free text', async () => {
  const t = createTestTelemetry();
  try {
    await withApp((a) => a.get('/api/applicants/:id', (_q, s) => s.send('ok')), async (base) => {
      await fetch(`${base}/api/applicants/jane@example.com?q=resume`);
      await fetch(`${base}/no/such/path/9f8b7c6d-1234-4abc-8def-0123456789ab`);
    });
    await t.flush();
    const keys = new Set(t.histogram('http.server.request.duration').flatMap((p) => Object.keys(p.attributes)));
    assert.ok(!keys.has('app.request.id'));
    const routes = t.histogram('http.server.request.duration').map((p) => p.attributes['http.route']);
    assert.deepEqual(new Set(routes), new Set(['/api/applicants/:id', 'unmatched']));
    assert.ok(!t.payloadJson().includes('jane@example.com'));
  } finally { await t.shutdown(); }
});
