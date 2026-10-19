/**
 * Telemetry bootstrap (OBS-P1-S03). Wires the official OpenTelemetry JS SDK:
 *   NodeTracerProvider + BatchSpanProcessor, MeterProvider + PeriodicExportingMetricReader,
 *   OTLP/HTTP (JSON) exporters, undici (fetch) instrumentation.
 * Default OFF. Every exporter is wrapped: Sanitizing (allow-list) -> instrumentExporter (fail-open
 * deadline + breaker, agent B) -> official exporter. Init/flush/shutdown never throw and are time-bounded.
 */
import {
  context, diag, DiagLogLevel, metrics, propagation, trace, ROOT_CONTEXT, defaultTextMapGetter,
} from '@opentelemetry/api';
import type { Context, Histogram, Counter, TextMapGetter, TextMapPropagator, TextMapSetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator, suppressTracing } from '@opentelemetry/core';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOffSampler, AlwaysOnSampler, BatchSpanProcessor, ParentBasedSampler, SimpleSpanProcessor, TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { applyOverrides, loadTelemetryConfig } from './config.js';
import type { TelemetryConfig } from './config.js';
import {
  createSafeDiagLogger, isPropagationAllowed, newCounters, SanitizingMetricExporter, SanitizingSpanExporter,
  sanitizeAttributes,
} from './privacy.js';
import type { ExportCounters } from './privacy.js';
import { instrumentExporter } from './lifecycle.js';

export const TRACER_NAME = 'rec-app';
export const HTTP_TRACER_NAME = 'rec-app.http';

export const HTTP_DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export interface TelemetryTestHooks {
  spanExporter?: SpanExporter;
  metricExporter?: PushMetricExporter;
  spanProcessor?: 'simple' | 'batch';
  forceEnabled?: boolean;
}

export interface InitOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: Partial<TelemetryConfig>;
  testing?: TelemetryTestHooks;
}

export interface HttpInstruments {
  duration: Histogram;
  excluded: Counter;
  seenRoutes: Set<string>;
}

export interface TelemetryRuntime {
  enabled: boolean;
  exporting: boolean;
  reason?: string;
  config: TelemetryConfig;
  diagnostics: string[];
  counters: ExportCounters;
  http?: HttpInstruments;
  /** Structural Flushable for agent B's registerLifecycleHooks / flushTelemetry. */
  flushable: { forceFlush: () => Promise<void>; shutdown: () => Promise<void> };
}

let active: TelemetryRuntime | undefined;
let lastRuntime: TelemetryRuntime | undefined;
let teardown: (() => Promise<void>) | undefined;

// ---------- outbound propagation gate ----------

/**
 * Only `traceparent` is ever injected (no baggage propagator is registered) and only for destinations
 * on TELEMETRY_PROPAGATION_ALLOWLIST. The undici requestHook runs synchronously before the instrumentation
 * calls propagation.inject(), so the hook records the decision for exactly that inject call.
 */
let pendingAllowed = false;
class DestinationGatedPropagator implements TextMapPropagator {
  private readonly w3c = new W3CTraceContextPropagator();
  inject(ctx: Context, carrier: unknown, setter: TextMapSetter): void {
    if (!pendingAllowed) return;
    this.w3c.inject(ctx, carrier, setter);
  }
  extract(ctx: Context): Context { return ctx; } // inbound context is handled (validated) in http.ts
  fields(): string[] { return ['traceparent']; }
}

export function parentContextFromTraceparent(traceparent: string): Context {
  const getter: TextMapGetter<{ traceparent: string }> = defaultTextMapGetter;
  return new W3CTraceContextPropagator().extract(ROOT_CONTEXT, { traceparent }, getter);
}

// ---------- init ----------

function disabledRuntime(config: TelemetryConfig, diagnostics: string[], counters: ExportCounters, reason: string): TelemetryRuntime {
  return {
    enabled: false, exporting: false, reason, config, diagnostics, counters,
    flushable: { forceFlush: async () => undefined, shutdown: async () => undefined },
  };
}

export function initTelemetry(options: InitOptions = {}): TelemetryRuntime {
  if (active) return active;
  const counters = newCounters();
  let config: TelemetryConfig;
  let diagnostics: string[];
  try {
    const loaded = loadTelemetryConfig(options.env ?? process.env);
    config = applyOverrides(loaded.config, options.overrides);
    diagnostics = loaded.diagnostics;
  } catch {
    const loaded = loadTelemetryConfig({});
    config = loaded.config;
    diagnostics = ['config:load_failed_telemetry_disabled'];
    lastRuntime = disabledRuntime(config, diagnostics, counters, 'config_error');
    return lastRuntime;
  }

  const t = options.testing;
  const hasInjected = Boolean(t?.spanExporter || t?.metricExporter);
  const enabled = config.enabled || (hasInjected && t?.forceEnabled !== false);
  if (!enabled) {
    lastRuntime = disabledRuntime(config, diagnostics, counters, 'disabled');
    if (diagnostics.length) printDiagnostics(diagnostics);
    return lastRuntime;
  }

  try {
    const runtime = build(config, diagnostics, counters, t);
    if (diagnostics.length) printDiagnostics(diagnostics);
    if (runtime.exporting || hasInjected) {
      active = runtime;
    }
    lastRuntime = runtime;
    return runtime;
  } catch {
    // Fail open: telemetry problems must never prevent the app from starting.
    diagnostics.push('init:failed_telemetry_disabled');
    printDiagnostics(diagnostics);
    void teardown?.();
    lastRuntime = disabledRuntime(config, diagnostics, counters, 'init_failed');
    return lastRuntime;
  }
}

function printDiagnostics(diagnostics: string[]): void {
  // Names + fixed codes only (see config.ts); safe to print.
  console.warn(`[telemetry] ${diagnostics.slice(0, 10).join('; ')}`);
}

function build(config: TelemetryConfig, diagnostics: string[], counters: ExportCounters, t?: TelemetryTestHooks): TelemetryRuntime {
  const isolate = <R>(fn: () => R): R => context.with(suppressTracing(context.active()), fn);
  const wrapOpts = { exportTimeoutMs: config.exportTimeoutMs, isolate };

  const rawSpanExporter: SpanExporter | undefined = t?.spanExporter
    ?? (config.tracesEndpoint ? new OTLPTraceExporter({ url: config.tracesEndpoint, timeoutMillis: config.exportTimeoutMs }) : undefined);
  const rawMetricExporter: PushMetricExporter | undefined = t?.metricExporter
    ?? (config.metricsEndpoint ? new OTLPMetricExporter({ url: config.metricsEndpoint, timeoutMillis: config.exportTimeoutMs }) : undefined);

  if (!rawSpanExporter && !rawMetricExporter) {
    diagnostics.push('exporters:none_configured_export_disabled');
    return disabledRuntime(config, diagnostics, counters, 'no_exporter');
  }

  diag.setLogger(createSafeDiagLogger(undefined, counters), { logLevel: DiagLogLevel.WARN });

  const resource = defaultResource().merge(resourceFromAttributes({
    'service.name': config.serviceName,
    'service.version': config.release,
    'deployment.environment.name': config.environment,
  }));

  const ratio = new TraceIdRatioBasedSampler(config.traceSampleRatio);
  // A (trusted) remote parent can never force more sampling than our own ratio, and an unsampled
  // remote parent is honoured. Metrics are unaffected by this sampler.
  const sampler = new ParentBasedSampler({
    root: ratio,
    remoteParentSampled: ratio,
    remoteParentNotSampled: new AlwaysOffSampler(),
    localParentSampled: new AlwaysOnSampler(),
    localParentNotSampled: new AlwaysOffSampler(),
  });

  const spanProcessors: SpanProcessor[] = [];
  if (rawSpanExporter) {
    const exporter = new SanitizingSpanExporter(instrumentExporter('traces', rawSpanExporter, wrapOpts), counters);
    const mode = t?.spanProcessor ?? (t?.spanExporter ? 'simple' : 'batch');
    spanProcessors.push(
      mode === 'simple'
        ? new SimpleSpanProcessor(exporter)
        : new BatchSpanProcessor(exporter, {
          maxQueueSize: config.maxQueueSize,
          maxExportBatchSize: config.maxExportBatchSize,
          scheduledDelayMillis: config.scheduleDelayMs,
          exportTimeoutMillis: config.exportTimeoutMs,
        }),
    );
  }

  const tracerProvider = new NodeTracerProvider({ resource, sampler, spanProcessors });
  tracerProvider.register({ propagator: new DestinationGatedPropagator() });

  let meterProvider: MeterProvider | undefined;
  if (rawMetricExporter) {
    const exporter = new SanitizingMetricExporter(instrumentExporter('metrics', rawMetricExporter, wrapOpts), counters);
    // attributesProcessors restricts which keys the SDK tracks BEFORE aggregation.
    // Prohibited keys (e.g. app.request.id, which is span-only) are stripped at
    // ingestion time so high-cardinality callers never create unbounded series.
    // SanitizingMetricExporter still validates the final payload for defence-in-depth.
    meterProvider = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: config.metricIntervalMs,
        exportTimeoutMillis: Math.min(config.exportTimeoutMs, config.metricIntervalMs),
      })],
      views: [{ instrumentName: '*', attributesProcessors: [{ process: (attributes) => sanitizeAttributes(attributes, 'metric') }] }],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  }

  const unregister = registerInstrumentations({
    tracerProvider,
    meterProvider,
    instrumentations: [new UndiciInstrumentation({
      requestHook: (_span, request) => {
        pendingAllowed = isPropagationAllowed(request.origin, config);
        queueMicrotask(() => { pendingAllowed = false; });
      },
    })],
  });

  const meter = metrics.getMeter(HTTP_TRACER_NAME);
  const http: HttpInstruments = {
    duration: meter.createHistogram('http.server.request.duration', {
      unit: 's',
      description: 'Server-side request processing time',
      advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS_SECONDS },
    }),
    excluded: meter.createCounter('app.http.server.excluded_requests', { description: 'Requests excluded from RED metrics' }),
    seenRoutes: new Set<string>(),
  };

  const withDeadline = async (p: Promise<unknown>, ms: number): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p.then(() => true, () => false),
        new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms); timer.unref?.(); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  // Rejects (fixed safe error) when the flush timed out or any export failed during it, so the public
  // forceFlushTelemetry() reports false; callers stay fail-open because the public API never rethrows.
  const forceFlush = async () => {
    const failuresBefore = counters.exportFailures;
    const finished = await withDeadline(
      Promise.all([tracerProvider.forceFlush(), meterProvider?.forceFlush()]), config.shutdownTimeoutMs,
    );
    if (!finished || counters.exportFailures > failuresBefore) throw new Error('telemetry flush failed');
  };
  const shutdown = async () => {
    unregister();
    await withDeadline(Promise.all([tracerProvider.shutdown(), meterProvider?.shutdown()]), config.shutdownTimeoutMs);
    trace.disable(); metrics.disable(); context.disable(); propagation.disable(); diag.disable();
    pendingAllowed = false;
    if (active?.http === http) active = undefined;
    teardown = undefined;
  };
  teardown = shutdown;

  return {
    enabled: true,
    exporting: true,
    config, diagnostics, counters, http,
    flushable: { forceFlush, shutdown },
  };
}

// ---------- accessors / lifecycle ----------

export function getTelemetryRuntime(): TelemetryRuntime | undefined { return active; }
export function isTelemetryEnabled(): boolean { return active?.enabled === true; }

export function getTelemetryStatus() {
  const r = active ?? lastRuntime;
  return {
    enabled: r?.enabled ?? false,
    exporting: r?.exporting ?? false,
    reason: r?.reason,
    serviceName: r?.config.serviceName ?? 'rec-app',
    environment: r?.config.environment ?? 'development',
    release: r?.config.release ?? 'unknown',
    sampleRatio: r?.config.traceSampleRatio ?? 1,
    diagnostics: [...(r?.diagnostics ?? [])],
    // queueDroppedSpans is learned from the SDK's fixed warning ("Dropped N spans because maxQueueSize
    // reached"), which BatchSpanProcessor emits on its next export after drops; it can lag by one batch.
    // Metric reader has no queue (exports are skipped/timed out, covered by exportFailures + B's export health).
    dropped: { exportFailures: r?.counters.exportFailures ?? 0, queueDroppedSpans: r?.counters.queueDroppedSpans ?? 0 },
  };
}

export async function forceFlushTelemetry(timeoutMs?: number): Promise<boolean> {
  const r = active;
  if (!r) return true;
  const limit = timeoutMs ?? r.config.shutdownTimeoutMs;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      r.flushable.forceFlush().then(() => true, () => false),
      new Promise<boolean>((res) => { timer = setTimeout(() => res(false), limit); timer.unref?.(); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function shutdownTelemetry(timeoutMs?: number): Promise<void> {
  const r = active;
  if (!r) return;
  const limit = timeoutMs ?? r.config.shutdownTimeoutMs;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      r.flushable.shutdown().catch(() => undefined),
      new Promise<void>((res) => { timer = setTimeout(res, limit); timer.unref?.(); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    active = undefined;
    lastRuntime = undefined;
  }
}

export function getTracer(name: string = TRACER_NAME) { return trace.getTracer(name); }
export function getMeter(name: string = TRACER_NAME) { return metrics.getMeter(name); }
