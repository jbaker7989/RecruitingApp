/**
 * Fail-open export wrapper, bounded flush/shutdown, and export-health tracking
 * (OBS-P1-S07). Health is held in-process and surfaced through the readiness /
 * diagnostics path, so it keeps working when the OTLP pipeline itself is down.
 */
import { errorCategory, logger } from './logger.js';

export type Signal = 'traces' | 'metrics' | 'logs';
export type ExportState = 'never' | 'fresh' | 'stale' | 'disabled';

/** PROPOSED values for OBS-P1-S07-AC1. Not approved: approver and baseline workload are still required. */
export const EXPORT_BUDGET_PROPOSAL = {
  approved: false,
  exportTimeoutMs: 3000,
  flushTimeoutMs: 2000,
  breakerThreshold: 3,
  breakerCooldownMs: 30_000,
  staleAfterMs: 120_000,
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMs: 5000,
  retries: 0,
} as const;

export interface SignalHealth {
  state: ExportState;
  last_success_at?: string;
  last_failure_at?: string;
  consecutive_failures: number;
  failures_by_category: Record<string, number>;
  dropped_items: number;
  timeouts: number;
  breaker_open: boolean;
  /**
   * Drops inside the SDK batch queue happen before the exporter callback fires and are not
   * observable from this wrapper. Total queue drops ARE captured separately via the SDK's fixed
   * diagnostic warning ("Dropped N spans because maxQueueSize reached") which the safe diag logger
   * in privacy.ts parses into counters.queueDroppedSpans — exposed via getTelemetryStatus().dropped.
   * This field remains 'unmeasured' because the exporter wrapper itself cannot observe queue events.
   */
  queue_saturation: 'unmeasured';
}

interface Internal {
  lastSuccess?: number;
  lastFailure?: number;
  consecutiveFailures: number;
  byCategory: Map<string, number>;
  dropped: number;
  timeouts: number;
  breakerOpenUntil: number;
  everExported: boolean;
}

const SIGNALS: Signal[] = ['traces', 'metrics', 'logs'];
const MAX_CATEGORIES = 12;
const state = new Map<Signal, Internal>();

function entry(signal: Signal): Internal {
  let s = state.get(signal);
  if (!s) {
    s = { consecutiveFailures: 0, byCategory: new Map(), dropped: 0, timeouts: 0, breakerOpenUntil: 0, everExported: false };
    state.set(signal, s);
  }
  return s;
}

function staleAfterMs(): number {
  const n = Number(process.env.TELEMETRY_STALE_AFTER_MS);
  return n > 0 ? n : EXPORT_BUDGET_PROPOSAL.staleAfterMs;
}

export function recordExportResult(r: { signal: Signal; ok: boolean; category?: string; dropped?: number; timedOut?: boolean; at?: number }): void {
  const s = entry(r.signal);
  const at = r.at ?? Date.now();
  s.everExported = true;
  if (r.ok) {
    s.lastSuccess = at;
    s.consecutiveFailures = 0;
    return;
  }
  s.lastFailure = at;
  s.consecutiveFailures += 1;
  if (r.timedOut) s.timeouts += 1;
  if (r.dropped) s.dropped += r.dropped;
  const cat = r.category && /^[a-z_]{1,32}$/.test(r.category) ? r.category : 'error';
  if (s.byCategory.has(cat) || s.byCategory.size < MAX_CATEGORIES) s.byCategory.set(cat, (s.byCategory.get(cat) ?? 0) + 1);
}

export function isTelemetryDisabled(): boolean {
  return process.env.OTEL_SDK_DISABLED === 'true';
}

export function getExportHealth(now: number = Date.now()): Record<Signal, SignalHealth> {
  const out = {} as Record<Signal, SignalHealth>;
  const disabled = isTelemetryDisabled();
  for (const signal of SIGNALS) {
    const s = entry(signal);
    let st: ExportState;
    if (disabled) st = 'disabled';
    else if (s.lastSuccess === undefined) st = 'never';
    else st = now - s.lastSuccess > staleAfterMs() ? 'stale' : 'fresh';
    out[signal] = {
      state: st,
      ...(s.lastSuccess !== undefined ? { last_success_at: new Date(s.lastSuccess).toISOString() } : {}),
      ...(s.lastFailure !== undefined ? { last_failure_at: new Date(s.lastFailure).toISOString() } : {}),
      consecutive_failures: s.consecutiveFailures,
      failures_by_category: Object.fromEntries(s.byCategory),
      dropped_items: s.dropped,
      timeouts: s.timeouts,
      breaker_open: s.breakerOpenUntil > now,
      queue_saturation: 'unmeasured',
    };
  }
  return out;
}

// ─── Exporter wrapper ─────────────────────────────────────────────────────────

/** Structural subset of the official OTel exporter interfaces (SpanExporter, PushMetricExporter, LogRecordExporter). */
export interface ExporterLike {
  export(items: any, resultCallback: (result: { code: number; error?: Error }) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

export interface InstrumentOptions {
  exportTimeoutMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  /** Run the real export outside tracing (foundation passes `suppressTracing` from @opentelemetry/core). */
  isolate?: <T>(fn: () => T) => T;
}

const SUCCESS = 0;
const FAILED = 1;

function countItems(items: unknown): number {
  if (Array.isArray(items)) return items.length;
  const rm = (items as { scopeMetrics?: unknown[] } | null)?.scopeMetrics;
  return Array.isArray(rm) ? rm.length : 1;
}

/**
 * Wrap an exporter so it can never throw, hang past `exportTimeoutMs`, or retry unboundedly.
 * After `breakerThreshold` consecutive failures further exports are dropped (and reported
 * as FAILED to the SDK) until the cooldown elapses; one probe export then closes the breaker.
 */
export function instrumentExporter<T extends ExporterLike>(signal: Signal, exporter: T, opts: InstrumentOptions = {}): T {
  const timeoutMs = opts.exportTimeoutMs ?? EXPORT_BUDGET_PROPOSAL.exportTimeoutMs;
  const threshold = opts.breakerThreshold ?? EXPORT_BUDGET_PROPOSAL.breakerThreshold;
  const cooldown = opts.breakerCooldownMs ?? EXPORT_BUDGET_PROPOSAL.breakerCooldownMs;
  const isolate = opts.isolate ?? (<R>(fn: () => R) => fn());

  const wrapped: ExporterLike = {
    export(items, cb) {
      const s = entry(signal);
      const n = countItems(items);
      if (isTelemetryDisabled()) {
        cb({ code: SUCCESS });
        return;
      }
      if (s.breakerOpenUntil > Date.now()) {
        s.dropped += n;
        cb({ code: FAILED, error: new Error('telemetry export circuit open') });
        return;
      }
      let settled = false;
      const settle = (ok: boolean, category?: string, timedOut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recordExportResult({ signal, ok, category, dropped: ok ? 0 : n, timedOut });
        if (ok) {
          s.breakerOpenUntil = 0;
        } else {
          if (s.consecutiveFailures >= threshold) s.breakerOpenUntil = Date.now() + cooldown;
          // Sanitized, rate-limited log event; exporter payloads/URLs are never included.
          logger.warn('telemetry.export.failed', {
            outcome: timedOut ? 'timeout' : 'failed',
            category: category ?? 'error',
            attrs: { signal, consecutive_failures: s.consecutiveFailures, breaker_open: s.breakerOpenUntil > Date.now() },
          });
        }
        try {
          cb(ok ? { code: SUCCESS } : { code: FAILED, error: new Error(`telemetry export ${category ?? 'failed'}`) });
        } catch {
          // callback errors are the SDK's concern, never the app's
        }
      };
      const timer = setTimeout(() => settle(false, 'timeout', true), timeoutMs);
      timer.unref?.();
      try {
        isolate(() =>
          exporter.export(items, (result) => {
            if (result.code === SUCCESS) settle(true);
            else settle(false, result.error ? errorCategory(result.error) : 'error');
          }),
        );
      } catch (err) {
        settle(false, errorCategory(err));
      }
    },
    async shutdown() {
      try {
        await withTimeout(exporter.shutdown(), timeoutMs);
      } catch {
        // fail open
      }
    },
    async forceFlush() {
      try {
        if (exporter.forceFlush) await withTimeout(exporter.forceFlush(), timeoutMs);
      } catch {
        // fail open
      }
    },
  };
  // Preserve any extra methods the SDK expects (e.g. selectAggregation* on metric exporters).
  return new Proxy(exporter, {
    get(target, prop, receiver) {
      if (prop in wrapped) return (wrapped as unknown as Record<string | symbol, unknown>)[prop];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ─── Flush / shutdown ─────────────────────────────────────────────────────────

export interface Flushable {
  forceFlush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    t.unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Bounded flush; never rejects and never exceeds `timeoutMs` plus scheduler jitter. */
export async function flushTelemetry(flushables: Flushable[], timeoutMs: number = EXPORT_BUDGET_PROPOSAL.flushTimeoutMs): Promise<{ ok: boolean; timed_out: boolean }> {
  let timedOut = false;
  let ok = true;
  await Promise.all(
    flushables.map(async (f) => {
      try {
        if (f.forceFlush) await withTimeout(f.forceFlush(), timeoutMs);
      } catch (err) {
        ok = false;
        if (err instanceof Error && err.message === 'timeout') timedOut = true;
      }
    }),
  );
  if (!ok) logger.warn('telemetry.flush.failed', { outcome: timedOut ? 'timeout' : 'failed' });
  return { ok, timed_out: timedOut };
}

let hooksInstalled = false;
const installedListeners: Array<[string, (...a: any[]) => void]> = [];

/** Flush on beforeExit and SIGTERM/SIGINT; signal handlers re-raise so default termination is preserved. */
export function registerLifecycleHooks(flushables: Flushable[], timeoutMs: number = EXPORT_BUDGET_PROPOSAL.flushTimeoutMs): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const onBeforeExit = () => { void flushTelemetry(flushables, timeoutMs); };
  process.once('beforeExit', onBeforeExit);
  installedListeners.push(['beforeExit', onBeforeExit]);
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    const handler = () => {
      void flushTelemetry(flushables, timeoutMs).finally(() => {
        process.removeListener(sig, handler);
        process.kill(process.pid, sig);
      });
    };
    process.on(sig, handler);
    installedListeners.push([sig, handler]);
  }
}

export function resetLifecycleForTests(): void {
  state.clear();
  for (const [ev, fn] of installedListeners) process.removeListener(ev, fn);
  installedListeners.length = 0;
  hooksInstalled = false;
}
