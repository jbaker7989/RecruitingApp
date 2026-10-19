import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpanStatusCode, createTraceState } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { SanitizingSpanExporter, createTestTelemetry, getMeter, getTracer, loadTelemetryConfig, recordSafeError } from '../src/telemetry/index.js';
import { logger, resetLoggerForTests, setLogSink } from '../src/telemetry/logger.js';

const canaries = {
  resume: 'SYNTHETIC_RESUME_93812',
  model: 'SYNTHETIC_MODEL_OUTPUT_93812',
  email: 'canary93812@example.invalid',
  token: 'Bearer synthetic-token-93812',
  state: 'SYNTHETIC_STATE_93812',
  code: 'SYNTHETIC_CODE_93812',
  redis: 'SYNTHETIC_REDIS_KEY_VALUE_93812',
};

test('S04: exported SDK payloads drop prohibited attributes and raw exception events/status', async () => {
  const telemetry = await createTestTelemetry();
  try {
    const tracer = getTracer('privacy-fixture');
    for (const marker of Object.values(canaries)) {
      const span = tracer.startSpan('oauth.token_exchange', { attributes: {
        'oauth.provider': 'google', 'oauth.operation': 'token_exchange',
        'http.url': `https://example.invalid/?code=${marker}`,
        'url.full': `https://example.invalid/?state=${marker}`,
        'http.request.header.authorization': marker,
        'db.statement': `GET ${marker}`, 'db.redis.key': marker,
        'resume.content': marker, 'gen_ai.completion': marker,
        'exception.message': marker, 'exception.stacktrace': marker,
      } });
      // Simulate automatic instrumentation, which may record unsafe exception data.
      span.recordException(new Error(marker));
      span.setStatus({ code: SpanStatusCode.ERROR, message: marker });
      span.end();
      getMeter('privacy-fixture').createCounter('app.oauth.client.attempts').add(1, { 'http.route': '/safe', 'resume.content': marker, 'app.request.id': marker });
    }
    await telemetry.flush();
    assert.equal(telemetry.spans().length, Object.keys(canaries).length);
    const payload = telemetry.payloadJson();
    for (const marker of Object.values(canaries)) assert.ok(!payload.includes(marker), `prohibited value escaped: ${marker}`);
    for (const span of telemetry.spans()) {
      assert.equal(span.attributes['oauth.provider'], 'google');
      assert.equal(span.status.message, undefined);
      assert.equal(span.events.length, 0);
    }
    const metrics = telemetry.metrics().flatMap(resource => resource.scopeMetrics.flatMap(scope => scope.metrics));
    const points = metrics.filter(metric => metric.descriptor.name === 'app.oauth.client.attempts').flatMap(metric => metric.dataPoints);
    assert.ok(points.length > 0, 'inspect an actual metric payload');
    for (const point of points) assert.ok(!('app.request.id' in point.attributes), 'request IDs cannot label metrics');
  } finally { await telemetry.shutdown(); }
});

test('S02/S04: 100 untrusted request IDs collapse to one exported metric series', async () => {
  const telemetry = createTestTelemetry();
  try {
    const attempts = getMeter('privacy-fixture').createCounter('app.oauth.client.attempts');
    for (let index = 0; index < 100; index++) {
      attempts.add(1, { 'oauth.provider': 'google', 'app.request.id': `synthetic-request-${index}` });
    }
    await telemetry.flush();
    const points = telemetry.metrics().at(-1)?.scopeMetrics
      .flatMap(scope => scope.metrics)
      .filter(metric => metric.descriptor.name === 'app.oauth.client.attempts')
      .flatMap(metric => metric.dataPoints) ?? [];
    assert.equal(points.length, 1, 'unsafe labels must not leave duplicate indistinguishable series');
    assert.deepEqual(points[0].attributes, { 'oauth.provider': 'google' });
    assert.equal(points[0].value, 100);
  } finally { await telemetry.shutdown(); }
});

test('S04: invalid values on allowed metric keys are removed before aggregation', async () => {
  const telemetry = createTestTelemetry();
  try {
    const counter = getMeter('privacy-fixture').createCounter('app.oauth.client.attempts');
    for (let i = 0; i < 100; i++) counter.add(1, { 'oauth.provider': `invalid-provider-${i}` });
    await telemetry.flush();
    const points = telemetry.metrics().at(-1)?.scopeMetrics.flatMap(s => s.metrics)
      .filter(m => m.descriptor.name === 'app.oauth.client.attempts').flatMap(m => m.dataPoints) ?? [];
    assert.equal(points.length, 1);
    assert.equal(points[0].value, 100);
    assert.deepEqual(points[0].attributes, {});
  } finally { await telemetry.shutdown(); }
});

test('S04: safe error recording preserves controlled category without model output', async () => {
  const telemetry = await createTestTelemetry();
  try {
    const span = getTracer().startSpan('resume.parse');
    const error = new SyntaxError(`Parser failed on resume model output ${canaries.model}`);
    const category = recordSafeError(span, error);
    span.end(); await telemetry.flush();
    assert.ok(['parse', 'validation', 'internal'].includes(category));
    assert.equal(telemetry.spans()[0].status.code, SpanStatusCode.ERROR);
    assert.ok(!telemetry.payloadJson().includes(canaries.model));
  } finally { await telemetry.shutdown(); }
});

test('S04/S08: logger drops raw exception/model/resume content rather than relying on secret regexes', () => {
  const records: unknown[] = [];
  resetLoggerForTests(); setLogSink(record => { records.push(record); });
  try {
    logger.error('resume.parse.failed', { error: new Error(canaries.model), attrs: { resume: canaries.resume, model_output: canaries.model, redis_key: canaries.redis, email: canaries.email, token: canaries.token, state: canaries.state, code: canaries.code } });
    assert.equal(records.length, 1);
    const payload = JSON.stringify(records);
    for (const marker of Object.values(canaries)) assert.ok(!payload.includes(marker), `logger leaked ${marker}`);
  } finally { setLogSink(null); resetLoggerForTests(); }
});

test('S03/S04: configuration diagnostics expose fixed codes and never unsafe endpoint values', () => {
  const { config, diagnostics } = loadTelemetryConfig({ TELEMETRY_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: `https://user:${canaries.code}@example.invalid/path?token=${canaries.state}`, TELEMETRY_TRACE_SAMPLE_RATIO: '-20' });
  assert.ok(diagnostics.length > 0);
  assert.ok(!JSON.stringify(diagnostics).includes(canaries.code));
  assert.ok(!JSON.stringify(diagnostics).includes(canaries.state));
  assert.ok(config.traceSampleRatio >= 0 && config.traceSampleRatio <= 1);
});


test('S04: final exporter strips canaries in event names, link context, resource and scope metadata', async () => {
  const captured = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'rec-app', 'applicant.resume': canaries.resume }),
    spanProcessors: [new SimpleSpanProcessor(new SanitizingSpanExporter(captured))],
  });
  try {
    const span = provider.getTracer(canaries.model, canaries.state).startSpan('oauth.token_exchange', {
      links: [{ context: { traceId: '12345678901234567890123456789012', spanId: '1234567890123456', traceFlags: 0, traceState: createTraceState(`vendor=${canaries.code}`) }, attributes: { 'resume.content': canaries.resume } }],
    });
    span.addEvent(canaries.model, { 'resume.content': canaries.resume });
    span.addEvent('exception', { 'exception.message': canaries.model });
    span.end(); await provider.forceFlush();
    const finished = captured.getFinishedSpans();
    assert.equal(finished.length, 1);
    const payload = JSON.stringify(finished.map(item => ({ name: item.name, events: item.events, links: item.links.map(link => ({ attributes: link.attributes, context: { ...link.context, traceState: link.context.traceState?.serialize() } })), resource: item.resource.attributes, scope: item.instrumentationScope })));
    for (const marker of Object.values(canaries)) assert.ok(!payload.includes(marker), `exported metadata leaked ${marker}`);
    assert.equal(finished[0].attributes['oauth.provider'], undefined);
    assert.equal(finished[0].resource.attributes['service.name'], 'rec-app');
  } finally { await provider.shutdown(); }
});
