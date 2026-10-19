/**
 * Bounded runtime / resource-pressure diagnostics (OBS-P1-S09-AC2).
 *
 * Values the platform cannot supply are reported as `unavailable` with a reason —
 * never as zero — so "no data" cannot render as "healthy".
 */
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import { metrics } from '@opentelemetry/api';

export interface RuntimeSnapshot {
  memory: { rss: number; heap_used: number; heap_total: number; external: number };
  event_loop_delay_ms: { p50: number; p99: number; max: number } | null;
  concurrency: { in_flight: number; peak_in_flight: number; total_requests: number };
  uptime_s: number;
  cold_start: boolean;
  startup_failures: number;
  unavailable: Array<{ signal: string; reason: string }>;
}

const STARTUP_CATEGORIES = new Set(['startup', 'store_init', 'telemetry_init', 'listen']);

let loopHistogram: IntervalHistogram | null = null;
let inFlight = 0;
let peakInFlight = 0;
let totalRequests = 0;
let startupFailures = 0;
let coldStartServed = false;
let metricsRegistered = false;

function histogram(): IntervalHistogram | null {
  if (loopHistogram) return loopHistogram;
  try {
    loopHistogram = monitorEventLoopDelay({ resolution: 20 });
    loopHistogram.enable();
    // enable() creates an unref'd timer inside libuv; it cannot keep the process alive.
  } catch {
    loopHistogram = null;
  }
  return loopHistogram;
}

const nsToMs = (n: number) => Math.round((n / 1e6) * 100) / 100;

export function getRuntimeSnapshot(): RuntimeSnapshot {
  const mem = process.memoryUsage();
  const h = histogram();
  const unavailable: RuntimeSnapshot['unavailable'] = [
    { signal: 'cpu_throttling', reason: 'not exposed to application code on this platform' },
    { signal: 'platform_concurrency_limit', reason: 'platform setting is not visible to the process' },
  ];
  const constrained = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  if (!constrained) unavailable.push({ signal: 'memory_limit', reason: 'no cgroup/platform memory limit reported' });
  const hasLoopSamples = !!h && h.count > 0;
  if (!hasLoopSamples) unavailable.push({ signal: 'event_loop_delay', reason: 'no samples collected yet' });
  const wasCold = !coldStartServed;
  return {
    memory: { rss: mem.rss, heap_used: mem.heapUsed, heap_total: mem.heapTotal, external: mem.external },
    event_loop_delay_ms: hasLoopSamples
      ? { p50: nsToMs(h!.percentile(50)), p99: nsToMs(h!.percentile(99)), max: nsToMs(h!.max) }
      : null,
    concurrency: { in_flight: inFlight, peak_in_flight: peakInFlight, total_requests: totalRequests },
    uptime_s: Math.round(process.uptime()),
    cold_start: wasCold,
    startup_failures: startupFailures,
    unavailable,
  };
}

/** Counts each request exactly once on finish or close, whichever fires first. */
export function concurrencyMiddleware() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    inFlight += 1;
    totalRequests += 1;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      inFlight = Math.max(0, inFlight - 1);
      coldStartServed = true;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

export function recordStartupFailure(category: string): void {
  startupFailures += 1;
  const safe = STARTUP_CATEGORIES.has(category) ? category : 'other';
  try {
    metrics.getMeter('rec-app.runtime').createCounter('app.runtime.startup.failures', {
      description: 'Startup failures by bounded category',
    }).add(1, { category: safe });
  } catch {
    // metrics must never break startup handling
  }
}

/** Registers official observable gauges. Idempotent. */
export function registerRuntimeMetrics(): void {
  if (metricsRegistered) return;
  metricsRegistered = true;
  const meter = metrics.getMeter('rec-app.runtime');
  const rss = meter.createObservableGauge('app.runtime.memory.rss', { unit: 'By' });
  const heap = meter.createObservableGauge('app.runtime.memory.heap_used', { unit: 'By' });
  const loop = meter.createObservableGauge('app.runtime.event_loop.delay.p99', { unit: 'ms' });
  const flight = meter.createObservableGauge('app.runtime.requests.in_flight');
  const cold = meter.createObservableGauge('app.runtime.cold_start');
  meter.addBatchObservableCallback((r) => {
    const s = getRuntimeSnapshot();
    r.observe(rss, s.memory.rss);
    r.observe(heap, s.memory.heap_used);
    // Omitted (not zero) when unavailable.
    if (s.event_loop_delay_ms) r.observe(loop, s.event_loop_delay_ms.p99);
    r.observe(flight, s.concurrency.in_flight);
    r.observe(cold, s.cold_start ? 1 : 0);
  }, [rss, heap, loop, flight, cold]);
}

export function resetRuntimeForTests(): void {
  inFlight = 0;
  peakInFlight = 0;
  totalRequests = 0;
  startupFailures = 0;
  coldStartServed = false;
  metricsRegistered = false;
  loopHistogram?.disable();
  loopHistogram = null;
}
