/**
 * Test helpers (synthetic data only). Official in-memory exporters sit INSIDE the sanitizing wrapper, so
 * what tests read is exactly what would leave the process. Safe to import from tests only.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { AggregationTemporality, DataPointType, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { forceFlushTelemetry, initTelemetry, shutdownTelemetry } from './bootstrap.js';
import type { InitOptions, TelemetryRuntime } from './bootstrap.js';
import type { TelemetryConfig } from './config.js';

export interface HistogramPointView {
  attributes: Record<string, unknown>;
  count: number;
  sum: number;
  buckets: number[];
  boundaries: number[];
}

export interface TestTelemetry {
  runtime: TelemetryRuntime;
  spanExporter: InMemorySpanExporter;
  metricExporter: InMemoryMetricExporter;
  flush(): Promise<boolean>;
  spans(): ReadableSpan[];
  metrics(): ResourceMetrics[];
  latestMetrics(): ResourceMetrics | undefined;
  histogram(name: string, filter?: Record<string, unknown>): HistogramPointView[];
  count(name: string, filter?: Record<string, unknown>): number;
  sumOf(name: string, filter?: Record<string, unknown>): number;
  payloadJson(): string;
  reset(): void;
  shutdown(): Promise<void>;
}

const matches = (attrs: Record<string, unknown>, filter?: Record<string, unknown>) =>
  !filter || Object.entries(filter).every(([k, v]) => attrs[k] === v);

export function createTestTelemetry(opts: { env?: NodeJS.ProcessEnv; overrides?: Partial<TelemetryConfig>; spanProcessor?: 'simple' | 'batch' } = {}): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const init: InitOptions = {
    env: opts.env ?? {},
    overrides: { metricIntervalMs: 300000, ...opts.overrides },
    testing: { spanExporter, metricExporter, spanProcessor: opts.spanProcessor ?? 'simple' },
  };
  const runtime = initTelemetry(init);
  const latestMetrics = () => metricExporter.getMetrics().at(-1);
  const points = (name: string, filter?: Record<string, unknown>) => {
    const out: Array<{ attributes: Record<string, unknown>; value: unknown; type: DataPointType }> = [];
    for (const sm of latestMetrics()?.scopeMetrics ?? []) {
      for (const m of sm.metrics) {
        if (m.descriptor.name !== name) continue;
        for (const dp of m.dataPoints as Array<{ attributes: Record<string, unknown>; value: unknown }>) {
          if (matches(dp.attributes, filter)) out.push({ attributes: dp.attributes, value: dp.value, type: m.dataPointType });
        }
      }
    }
    return out;
  };
  return {
    runtime,
    spanExporter,
    metricExporter,
    flush: () => forceFlushTelemetry(5000),
    spans: () => spanExporter.getFinishedSpans(),
    metrics: () => metricExporter.getMetrics(),
    latestMetrics,
    histogram: (name, filter) => points(name, filter).map((p) => {
      const v = p.value as { count: number; sum?: number; buckets: { counts: number[]; boundaries: number[] } };
      return { attributes: p.attributes, count: v.count, sum: v.sum ?? 0, buckets: v.buckets.counts, boundaries: v.buckets.boundaries };
    }),
    count: (name, filter) => points(name, filter).reduce((n, p) => n + (typeof p.value === 'number' ? p.value : (p.value as { count: number }).count), 0),
    sumOf: (name, filter) => points(name, filter).reduce((n, p) => n + (typeof p.value === 'number' ? p.value : (p.value as { sum?: number }).sum ?? 0), 0),
    payloadJson: () => JSON.stringify({
      spans: spanExporter.getFinishedSpans().map((s) => ({
        name: s.name, kind: s.kind, status: s.status, attributes: s.attributes, events: s.events, links: s.links.map((l) => l.attributes),
        resource: s.resource.attributes, scope: s.instrumentationScope, parent: s.parentSpanContext?.spanId, traceId: s.spanContext().traceId,
      })),
      metrics: metricExporter.getMetrics().map((rm) => ({
        resource: rm.resource.attributes,
        scopes: rm.scopeMetrics.map((sm) => ({ scope: sm.scope, metrics: sm.metrics.map((m) => ({ d: m.descriptor, dp: m.dataPoints })) })),
      })),
    }),
    reset: () => { spanExporter.reset(); metricExporter.reset(); },
    shutdown: () => shutdownTelemetry(),
  };
}

// ---------- local OTLP/HTTP (JSON) sink ----------

export type SinkMode = 'ok' | 'http500' | 'hang' | 'drop';
export interface OtlpSink {
  url: string;
  requests: Array<{ path: string; json: unknown }>;
  setMode(mode: SinkMode): void;
  close(): Promise<void>;
}

export async function startOtlpSink(opts: { mode?: SinkMode; maxBodyBytes?: number } = {}): Promise<OtlpSink> {
  let mode: SinkMode = opts.mode ?? 'ok';
  const max = opts.maxBodyBytes ?? 5_000_000;
  const requests: OtlpSink['requests'] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('end', () => {
      let json: unknown;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = undefined; }
      requests.push({ path: req.url ?? '', json });
      if (mode === 'hang') return;
      if (mode === 'drop') { req.socket.destroy(); return; }
      if (mode === 'http500') { res.writeHead(500, { 'content-type': 'application/json' }).end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode: (m) => { mode = m; },
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
