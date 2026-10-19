import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { flushTelemetry, getExportHealth, instrumentExporter, resetLifecycleForTests } from '../src/telemetry/lifecycle.js';
import { resetLoggerForTests, setLogSink } from '../src/telemetry/logger.js';

for (const status of [200, 401, 429, 503, 'hang'] as const) {
  test(`S07: real official OTLP/HTTP exporter handles loopback ${status} without blocking business work`, async () => {
    resetLifecycleForTests(); resetLoggerForTests();
    const diagnostics: unknown[] = [];
    setLogSink(record => { diagnostics.push(record); });
    const captured: Array<{ path: string; payload: unknown }> = [];
    const collector = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      captured.push({ path: req.url!, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      if (status === 'hang') return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      if (status === 429 || status === 503) res.setHeader('Retry-After', '1');
      res.end(status === 200 ? '{}' : '{"error":"SYNTHETIC_PRIVATE_COLLECTOR_RESPONSE_93812"}');
    });
    collector.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => collector.once('listening', resolve));
    const address = collector.address(); assert.ok(address && typeof address !== 'string');
    const exporter = new OTLPTraceExporter({ url: `http://127.0.0.1:${address.port}/v1/traces`, timeoutMillis: 100 });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'synthetic-otlp-fixture' }),
      spanProcessors: [new SimpleSpanProcessor(instrumentExporter('traces', exporter, { exportTimeoutMs: 200 }))],
    });
    try {
      let businessCompleted = false;
      const span = provider.getTracer('synthetic-otlp-test').startSpan('oauth.token_exchange');
      span.end(); businessCompleted = true;
      assert.equal(businessCompleted, true);
      const result = await flushTelemetry([provider], 1000);
      assert.ok(captured.length >= 1, 'real collector received a protocol payload');
      assert.equal(captured[0].path, '/v1/traces');
      assert.match(JSON.stringify(captured[0].payload), /oauth.token_exchange/);
      if (status === 200) {
        assert.equal(result.ok, true);
        assert.equal(getExportHealth().traces.state, 'fresh');
      } else {
        assert.equal(result.ok, false);
        assert.ok(getExportHealth().traces.consecutive_failures >= 1);
      }
      assert.ok(!JSON.stringify(diagnostics).includes('SYNTHETIC_PRIVATE_COLLECTOR_RESPONSE_93812'));
    } finally {
      await provider.shutdown();
      collector.closeAllConnections();
      await new Promise<void>(resolve => collector.close(() => resolve()));
      setLogSink(null); resetLifecycleForTests();
    }
  });
}
