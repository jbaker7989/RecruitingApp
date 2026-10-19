import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { context, metrics, trace, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OAuthFlowError, classifyFailure, observeLogin, tracedClientOperation, tracedRedisOperation } from '../src/telemetry/providerOps.js';
import { getLogContext, logger, resetLoggerForTests, runWithLogContext, setLogSink } from '../src/telemetry/logger.js';
import { getReadiness, registerDependency, resetDependenciesForTests } from '../src/telemetry/dependencies.js';

const spans = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
const meterProvider = new MeterProvider({ readers: [reader] });
const contextManager = new AsyncLocalStorageContextManager();
const logs: Record<string, unknown>[] = [];

before(() => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
});
beforeEach(() => {
  spans.reset(); logs.length = 0;
  resetLoggerForTests(); resetDependenciesForTests();
  setLogSink(record => { logs.push(record as unknown as Record<string, unknown>); });
});
after(async () => {
  setLogSink(null); resetDependenciesForTests();
  await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
  context.disable(); trace.disable(); metrics.disable();
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function collected(name: string) {
  const { resourceMetrics, errors } = await reader.collect();
  assert.equal(errors.length, 0);
  return resourceMetrics.scopeMetrics.flatMap(scope => scope.metrics).find(metric => metric.descriptor.name === name);
}

test('S06: provider failure taxonomy distinguishes transport, response and configuration failures', () => {
  const fixtures = [
    [Object.assign(new Error('synthetic'), { name: 'TimeoutError' }), undefined, 'timeout'],
    [Object.assign(new Error('synthetic'), { cause: { code: 'ENOTFOUND' } }), undefined, 'dns_failure'],
    [Object.assign(new Error('synthetic'), { cause: { code: 'ECONNREFUSED' } }), undefined, 'connect_failure'],
    [Object.assign(new Error('synthetic'), { cause: { code: 'CERT_HAS_EXPIRED' } }), undefined, 'tls_failure'],
    [new Error('synthetic'), 429, 'rate_limited'],
    [new Error('synthetic'), 503, 'server_error'],
    [new Error('synthetic'), 401, 'client_error'],
    [new OAuthFlowError('synthetic config error', 'invalid_configuration'), undefined, 'invalid_configuration'],
    [new OAuthFlowError('synthetic state error', 'invalid_state'), undefined, 'invalid_state'],
  ] as const;
  for (const [error, status, expected] of fixtures) assert.equal(classifyFailure(error, status), expected);
});

test('S06: recovered dependency failure counts two attempts and one successful logical login', async () => {
  const beforeAttempts = await collected('app.oauth.client.attempts');
  const sum = (metric: typeof beforeAttempts) => metric?.dataPoints.reduce((total, point) => total + Number(point.value), 0) ?? 0;
  const attemptStart = sum(beforeAttempts);
  const loginStart = sum(await collected('app.oauth.login.outcomes'));
  await observeLogin('linkedin', async () => {
    await assert.rejects(tracedClientOperation({ provider: 'linkedin', operation: 'userinfo', attempt: 1 }, async () => {
      throw Object.assign(new Error('synthetic'), { cause: { code: 'ENOTFOUND' } });
    }));
    return tracedClientOperation({ provider: 'linkedin', operation: 'userinfo', attempt: 2 }, async () => 'recovered');
  });
  await tracerProvider.forceFlush();
  assert.equal(sum(await collected('app.oauth.client.attempts')) - attemptStart, 2);
  assert.equal(sum(await collected('app.oauth.login.outcomes')) - loginStart, 1);
  const loginMetric = await collected('app.oauth.login.outcomes');
  assert.ok(loginMetric?.dataPoints.some(point => point.attributes['oauth.outcome'] === 'success' && point.attributes['oauth.recovered'] === true));
  const attempts = spans.getFinishedSpans().filter(span => span.name === 'oauth.userinfo');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(span => span.kind), [SpanKind.CLIENT, SpanKind.CLIENT]);
  assert.equal(spans.getFinishedSpans().filter(span => span.name === 'oauth.login.callback').length, 1);
});

test('S03/S06/S08: concurrent async dependency spans and logs retain their own context', async () => {
  const tracer = trace.getTracer('observability-test');
  await Promise.all(Array.from({ length: 24 }, (_, index) => runWithLogContext({ requestId: `synthetic-request-${index}`, entryPoint: 'http' }, () =>
    tracer.startActiveSpan(`fixture-${index}`, { kind: SpanKind.SERVER }, async server => {
      await tick();
      assert.equal(getLogContext()?.requestId, `synthetic-request-${index}`);
      await tracedClientOperation({ provider: 'google', operation: 'token_exchange' }, async () => {
        await tick(); logger.info('oauth.fixture', { outcome: 'success' });
      });
      server.end();
    }))));
  await tracerProvider.forceFlush();
  const finished = spans.getFinishedSpans();
  assert.equal(finished.length, 48);
  const servers = finished.filter(span => span.kind === SpanKind.SERVER);
  assert.equal(new Set(servers.map(span => span.spanContext().traceId)).size, 24);
  for (let index = 0; index < 24; index++) {
    const server = servers.find(span => span.name === `fixture-${index}`)!;
    const children = finished.filter(span => span.parentSpanContext?.spanId === server.spanContext().spanId);
    assert.equal(children.length, 1);
    const record = logs.find(log => log.request_id === `synthetic-request-${index}`);
    assert.ok(record);
    assert.equal(record.trace_id, server.spanContext().traceId);
    assert.equal(record.span_id, children[0].spanContext().spanId);
  }
});

test('S04/S06: thrown provider and Redis errors never emit raw exception data', async () => {
  const canary = 'SYNTHETIC_RESUME_MODEL_OUTPUT_93812';
  const failure = new Error(canary);
  await assert.rejects(tracedClientOperation({ provider: 'google', operation: 'token_exchange' }, async () => { throw failure; }), error => error === failure);
  await assert.rejects(tracedRedisOperation('getdel', async () => { throw failure; }), error => error === failure);
  await tracerProvider.forceFlush();
  assert.equal(spans.getFinishedSpans().length, 2);
  assert.ok(!JSON.stringify(spans.getFinishedSpans().map(span => ({ name: span.name, attributes: span.attributes, events: span.events, links: span.links, status: span.status, resource: span.resource.attributes }))).includes(canary));
  for (const span of spans.getFinishedSpans()) assert.equal(span.events.length, 0);
});

test('S08: startup logs work without spans and invalid/secret-bearing fields are bounded', () => {
  runWithLogContext({ entryPoint: 'startup' }, () => logger.error('server.start_failed', {
    error: new Error('Bearer synthetic-token-93812 email@example.invalid https://example.invalid/?code=93812'),
  }));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].entry_point, 'startup');
  assert.equal(logs[0].event, 'server.start_failed');
  assert.ok(!logs[0].trace_id && !logs[0].span_id);
  const serialized = JSON.stringify(logs);
  for (const value of ['synthetic-token-93812', 'email@example.invalid', '?code=93812', 'Error:']) assert.ok(!serialized.includes(value), value);
});

test('S09: optional degradation differs from required failure; public output excludes probe errors', async () => {
  registerDependency({ name: 'optional_cache', required: false, check: async () => 'down' });
  assert.equal((await getReadiness()).status, 'degraded');
  registerDependency({ name: 'required_store', required: true, check: async () => { throw new Error('SYNTHETIC_PRIVATE_HOST'); } });
  const result = await getReadiness();
  assert.equal(result.status, 'not_ready');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_HOST'));
});

test('S09: concurrent readiness callers share one bounded cached dependency probe', async () => {
  let probes = 0;
  registerDependency({ name: 'shared_store', required: true, ttlMs: 5000, timeoutMs: 1000, check: async () => { probes++; await tick(); return 'up'; } });
  const results = await Promise.all(Array.from({ length: 30 }, () => getReadiness()));
  assert.equal(probes, 1);
  assert.ok(results.every(result => result.status === 'ready'));
  assert.equal((await getReadiness()).status, 'ready');
  assert.equal(probes, 1);
});

test('S09: never-resolving required dependency becomes not-ready within timeout', async () => {
  registerDependency({ name: 'stuck_store', required: true, timeoutMs: 20, check: () => new Promise(() => {}) });
  // Keep one referenced timer because production timeouts may deliberately be unref-ed.
  const guard = setTimeout(() => {}, 1500);
  try {
    const started = performance.now();
    assert.equal((await getReadiness()).status, 'not_ready');
    assert.ok(performance.now() - started < 1000);
  } finally { clearTimeout(guard); }
});
