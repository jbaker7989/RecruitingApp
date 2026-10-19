import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import express from 'express';
import { context, propagation, SpanKind } from '@opentelemetry/api';
import { createTestTelemetry, getTracer, telemetryErrorMiddleware, telemetryMiddleware } from '../src/telemetry/index.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function fixture(run: (fixture: { base: string; app: express.Express; telemetry: Awaited<ReturnType<typeof createTestTelemetry>> }) => Promise<void>, sampleRatio = 1, overrides = {}) {
  const telemetry = await createTestTelemetry({ overrides: { traceSampleRatio: sampleRatio, ...overrides } });
  const app = express();
  app.use(telemetryMiddleware());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run({ base: `http://127.0.0.1:${address.port}`, app, telemetry }); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await telemetry.shutdown();
  }
}

for (const sampleRatio of [1, 0]) {
  test(`S05: full-population mixed HTTP histogram is exact with trace sample ratio ${sampleRatio}`, async () => {
    await fixture(async ({ base, app, telemetry }) => {
      app.get('/success/:id', (_req, res) => res.sendStatus(200));
      app.get('/auth', (_req, res) => res.sendStatus(401));
      app.get('/validation', (_req, res) => res.sendStatus(422));
      app.get('/handled', (_req, res) => res.sendStatus(503));
      app.get('/thrown', () => { throw new Error('SYNTHETIC_RESUME_93812'); });
      app.use(telemetryErrorMiddleware());
      app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(500));
      const statuses = [];
      for (const path of ['/success/one', '/auth', '/validation', '/handled', '/thrown', '/unknown/93812']) {
        const response = await fetch(base + path, { headers: { 'x-telemetry-synthetic': '1' } });
        statuses.push(response.status); await response.arrayBuffer();
      }
      assert.deepEqual(statuses, [200, 401, 422, 503, 500, 404]);
      await tick(); await telemetry.flush();
      const histogram = telemetry.histogram('http.server.request.duration');
      assert.equal(histogram.reduce((sum, point) => sum + point.count, 0), 6);
      assert.equal(telemetry.count('http.server.request.duration', { 'app.outcome': 'server_error' }), 2);
      assert.equal(telemetry.count('http.server.request.duration', { 'app.outcome': 'client_error' }), 3);
      assert.equal(telemetry.count('http.server.request.duration', { 'app.traffic': 'synthetic' }), 6);
      for (const point of histogram) {
        assert.ok(point.sum >= 0 && point.sum < 10, 'duration is in seconds');
        assert.equal(point.buckets.reduce((sum: number, count: number) => sum + count, 0), point.count);
        assert.ok(!('app.request.id' in point.attributes));
      }
      const servers = telemetry.spans().filter(span => span.kind === SpanKind.SERVER);
      assert.equal(servers.length, sampleRatio === 0 ? 0 : 6);
      assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_RESUME_93812'));
    }, sampleRatio);
  });
}

test('S04/S05: 100 varied IDs and unknown URLs produce bounded templates and fallback series', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    app.get('/candidate/:candidateId', (_req, res) => res.sendStatus(200));
    for (let index = 0; index < 100; index++) {
      for (const path of [`/candidate/private-${index}`, `/not-found/private-${index}`]) {
        const response = await fetch(base + path); await response.arrayBuffer();
      }
    }
    await telemetry.flush();
    const histogram = telemetry.histogram('http.server.request.duration');
    assert.equal(histogram.reduce((total, point) => total + point.count, 0), 200);
    const routes = new Set(histogram.map(point => point.attributes['http.route']));
    assert.deepEqual(routes, new Set(['/candidate/:candidateId', 'unmatched']));
    assert.equal(histogram.length, 2);
    assert.ok(!telemetry.payloadJson().includes('private-'));
    assert.ok(telemetry.spans().every(span => !span.name.includes('private-')));
  });
});

test('S03/S04: concurrent public requests have isolated traces and exactly one local child each', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    app.get('/work/:id', async (_req, res) => {
      await tick();
      await getTracer('test').startActiveSpan('redis.get', { kind: SpanKind.CLIENT }, async child => { await tick(); child.end(); });
      res.sendStatus(200);
    });
    const attackerTraceId = '12345678901234567890123456789012';
    await Promise.all(Array.from({ length: 24 }, async (_, index) => {
      const response = await fetch(`${base}/work/${index}`, { headers: { traceparent: `00-${attackerTraceId}-1234567890123456-01`, baggage: 'email=SYNTHETIC_EMAIL_93812', 'x-request-id': `test-request-${index}` } });
      assert.equal(response.headers.get('x-request-id'), `test-request-${index}`);
      await response.arrayBuffer();
    }));
    await telemetry.flush();
    const finished = telemetry.spans();
    const servers = finished.filter(span => span.kind === SpanKind.SERVER);
    const children = finished.filter(span => span.name === 'redis.get');
    assert.equal(servers.length, 24); assert.equal(children.length, 24);
    assert.equal(new Set(servers.map(span => span.spanContext().traceId)).size, 24);
    assert.ok(servers.every(span => span.spanContext().traceId !== attackerTraceId));
    for (const server of servers) {
      const matching = children.filter(child => child.parentSpanContext?.spanId === server.spanContext().spanId);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].spanContext().traceId, server.spanContext().traceId);
    }
    assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_EMAIL_93812'));
  });
});

test('S05: a client disconnect is counted once as aborted even when finish/close compete', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    let entered!: () => void;
    const received = new Promise<void>(resolve => { entered = resolve; });
    let closed!: () => void;
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    app.get('/disconnect', (_req, res) => { res.once('close', closed); entered(); });
    const client = request(base + '/disconnect');
    client.on('error', () => {}); client.end();
    await received; client.destroy(); await disconnected;
    await tick(); await telemetry.flush();
    assert.equal(telemetry.count('http.server.request.duration'), 1);
    assert.equal(telemetry.count('http.server.request.duration', { 'app.outcome': 'aborted' }), 1);
  });
});

test('S04: malformed and oversized request context is replaced rather than echoed', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    app.get('/context', (_req, res) => res.sendStatus(200));
    for (const invalid of ['bad', 'SYNTHETIC@EMAIL.invalid', 'x'.repeat(1000)]) {
      const response = await fetch(base + '/context', { headers: { 'x-request-id': invalid, traceparent: 'not-a-trace', baggage: 'secret=SYNTHETIC_BAGGAGE_93812' } });
      const safeId = response.headers.get('x-request-id');
      assert.ok(safeId && /^[A-Za-z0-9_-]{8,64}$/.test(safeId));
      assert.notEqual(safeId, invalid); await response.arrayBuffer();
    }
    await telemetry.flush();
    assert.equal(telemetry.count('http.server.request.duration'), 3);
    for (const marker of ['SYNTHETIC@EMAIL.invalid', 'SYNTHETIC_BAGGAGE_93812', 'not-a-trace']) assert.ok(!telemetry.payloadJson().includes(marker));
  });
});


test('S04: real outbound HTTP propagates only to approved destination and never sends baggage', async () => {
  const seen: Array<{ destination: string; traceparent?: string; baggage?: string }> = [];
  const destinations = ['trusted', 'denied'].map(destination => createServer((req, res) => {
    seen.push({ destination, traceparent: req.headers.traceparent as string | undefined, baggage: req.headers.baggage as string | undefined });
    res.end('synthetic response');
  }));
  const urls: string[] = [];
  for (const server of destinations) {
    server.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    urls.push(`http://127.0.0.1:${address.port}`);
  }
  try {
    await fixture(async ({ base, app, telemetry }) => {
      app.get('/outbound', async (_req, res) => {
        const contaminated = propagation.setBaggage(context.active(), propagation.createBaggage({ email: { value: 'SYNTHETIC_BAGGAGE_93812' } }));
        await context.with(contaminated, async () => {
          for (const url of urls) { const response = await fetch(url + '/private?code=SYNTHETIC_CODE_93812'); await response.text(); }
        });
        res.sendStatus(200);
      });
      const response = await fetch(base + '/outbound'); assert.equal(response.status, 200); await response.text();
      await telemetry.flush();
      assert.equal(seen.length, 2);
      assert.match(seen.find(item => item.destination === 'trusted')?.traceparent ?? '', /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/);
      assert.equal(seen.find(item => item.destination === 'denied')?.traceparent, undefined);
      assert.ok(seen.every(item => item.baggage === undefined));
      const servers = telemetry.spans().filter(span => span.kind === SpanKind.SERVER);
      assert.equal(servers.length, 1);
      const children = telemetry.spans().filter(span => span.kind === SpanKind.CLIENT && span.spanContext().traceId === servers[0].spanContext().traceId);
      assert.equal(children.length, 2, 'denied propagation retains local client visibility');
      assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_CODE_93812'));
      assert.ok(!telemetry.payloadJson().includes('SYNTHETIC_BAGGAGE_93812'));
    }, 1, { propagationAllowlist: [new URL(urls[0]).host] });
  } finally {
    for (const server of destinations) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test('S04/S05: trusted sampled parent cannot force traces when local ratio is zero', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    app.get('/sample', (_req, res) => res.sendStatus(200));
    const response = await fetch(base + '/sample', { headers: { traceparent: '00-12345678901234567890123456789012-1234567890123456-01' } });
    assert.equal(response.status, 200); await response.text();
    await telemetry.flush();
    assert.equal(telemetry.spans().filter(span => span.kind === SpanKind.SERVER).length, 0);
    assert.equal(telemetry.count('http.server.request.duration'), 1);
  }, 0, { trustInboundTrace: true });
});

test('S05: health/static exclusions are explicit while API file routes and synthetic requests remain counted', async () => {
  await fixture(async ({ base, app, telemetry }) => {
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.get('/asset.css', (_req, res) => res.send('synthetic css'));
    app.get('/api/file.css', (_req, res) => res.json({ ok: true }));
    app.get('/eligible', (_req, res) => res.sendStatus(200));
    for (const path of ['/health', '/asset.css', '/api/file.css', '/eligible']) {
      const response = await fetch(base + path, { headers: { 'x-telemetry-synthetic': '1' } });
      await response.arrayBuffer();
    }
    await telemetry.flush();
    assert.equal(telemetry.count('http.server.request.duration'), 2);
    assert.equal(telemetry.count('http.server.request.duration', { 'app.traffic': 'synthetic' }), 2);
    assert.equal(telemetry.count('app.http.server.excluded_requests', { 'app.reason': 'health' }), 1);
    assert.equal(telemetry.count('app.http.server.excluded_requests', { 'app.reason': 'static' }), 1);
  });
});
