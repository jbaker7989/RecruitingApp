/**
 * Safe telemetry schema (OBS-P1-S04). Everything that leaves the process passes through the
 * sanitizing exporters in this file: attribute keys are allow-listed, values are bounded and
 * secret-pattern redacted, exception text / status messages / URLs are never exported.
 *
 * The allow-list below is a PROPOSED engineering default for isolated synthetic development.
 * It is not an approved data policy (OBS-P1-S02 remains open).
 */
import type { Attributes, AttributeValue, Span, SpanContext } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import type { DiagLogFunction, DiagLogger } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { TelemetryConfig } from './config.js';

export const MAX_STRING_LENGTH = 128;
const REDACTED = '[redacted]';

export const ERROR_CATEGORIES = [
  'timeout', 'network', 'validation', 'auth', 'not_found', 'rate_limit', 'upstream', 'parse', 'aborted', 'internal',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export type Signal = 'resource' | 'span' | 'metric';

type Validator = (v: AttributeValue) => AttributeValue | undefined;
const pattern = (re: RegExp): Validator => (v) => (typeof v === 'string' && re.test(v) ? v : undefined);
const oneOf = (...vals: string[]): Validator => {
  const set = new Set(vals);
  return (v) => (typeof v === 'string' && set.has(v) ? v : undefined);
};
const intRange = (min: number, max: number): Validator => (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const bool: Validator = (v) => (typeof v === 'boolean' ? v : undefined);

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', '_OTHER'];
const ROUTE_RE = /^(\/[A-Za-z0-9_:.*-]{0,64}){0,12}$|^(unmatched|other)$/;
const OUTCOMES = [
  'success', 'client_error', 'server_error', 'aborted', 'other', 'timeout', 'dns_failure', 'connect_failure',
  'tls_failure', 'rate_limited', 'invalid_configuration', 'user_cancelled', 'invalid_state', 'validation_error', 'unknown',
];
const ENUM_TOKEN = /^[a-z][a-z0-9_.]{0,39}$/;

interface KeySpec { signals: readonly Signal[]; validate: Validator }
const spec = (signals: readonly Signal[], validate: Validator): KeySpec => ({ signals, validate });
const R: readonly Signal[] = ['resource'];
const S: readonly Signal[] = ['span'];
const SM: readonly Signal[] = ['span', 'metric'];
const M: readonly Signal[] = ['metric'];
const TOKEN40 = pattern(/^[A-Za-z0-9._-]{1,40}$/);

/**
 * Per-key schema. Each key lists the signals it may appear in and a value validator (bounded enum,
 * charset-limited token or integer range). Anything else is dropped, so free text cannot be
 * exported under an allowed key. Identifiers (app.request.id) are span-only: never metric labels.
 */
const SCHEMA: Record<string, KeySpec> = {
  'service.name': spec(R, pattern(/^[A-Za-z0-9._-]{1,64}$/)),
  'service.version': spec(R, TOKEN40),
  'deployment.environment.name': spec(R, pattern(/^[a-z0-9_-]{1,32}$/)),
  'telemetry.sdk.name': spec(R, TOKEN40),
  'telemetry.sdk.language': spec(R, TOKEN40),
  'telemetry.sdk.version': spec(R, TOKEN40),
  'process.runtime.name': spec(R, TOKEN40),
  'process.runtime.version': spec(R, TOKEN40),
  'http.request.method': spec(SM, oneOf(...METHODS)),
  'http.route': spec(SM, pattern(ROUTE_RE)),
  'http.response.status_code': spec(S, intRange(100, 599)),
  'url.scheme': spec(S, oneOf('http', 'https')),
  'network.protocol.version': spec(S, oneOf('1.0', '1.1', '2', '3')),
  'server.address': spec(S, pattern(/^[A-Za-z0-9.-]{1,128}$/)),
  'server.port': spec(S, intRange(1, 65535)),
  'error.type': spec(SM, oneOf(...ERROR_CATEGORIES, 'other')),
  'app.request.id': spec(S, pattern(/^[A-Za-z0-9_-]{8,64}$/)),
  'app.feature': spec(SM, pattern(/^[a-z][a-z0-9_]{0,31}$/)),
  'app.outcome': spec(SM, oneOf(...OUTCOMES)),
  'app.status_class': spec(SM, oneOf('1xx', '2xx', '3xx', '4xx', '5xx', 'aborted')),
  'app.environment': spec(SM, pattern(/^[a-z0-9_-]{1,32}$/)),
  'app.traffic': spec(SM, oneOf('real', 'synthetic')),
  'app.dependency': spec(SM, pattern(ENUM_TOKEN)),
  'app.operation': spec(SM, pattern(ENUM_TOKEN)),
  'app.reason': spec(SM, oneOf('health', 'static', 'synthetic')),
  'app.attempt': spec(S, intRange(1, 100)),
  'db.system.name': spec(SM, oneOf('redis')),
  'db.operation.name': spec(SM, oneOf('setex', 'getdel', 'get', 'set', 'del', 'connect', 'other')),
  'oauth.provider': spec(SM, oneOf('google', 'linkedin', 'facebook', 'other')),
  'oauth.operation': spec(SM, oneOf('token_exchange', 'userinfo')),
  'oauth.attempt_bucket': spec(SM, oneOf('1', '2', '3+')),
  'oauth.outcome': spec(SM, oneOf(...OUTCOMES)),
  'oauth.recovered': spec(SM, bool),
  'oauth.state_outcome': spec(SM, oneOf('stored', 'consumed', 'missing_or_expired', 'redis_unavailable_fallback', 'memory_fallback')),
  category: spec(M, oneOf('startup', 'store_init', 'telemetry_init', 'listen', 'other')),
};

const keysFor = (signal: Signal): ReadonlySet<string> =>
  new Set(Object.keys(SCHEMA).filter((k) => SCHEMA[k].signals.includes(signal)));
export const ALLOWED_RESOURCE_KEYS = keysFor('resource');
export const ALLOWED_SPAN_KEYS = keysFor('span');
export const ALLOWED_METRIC_KEYS = keysFor('metric');
export const ALLOWED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(Object.keys(SCHEMA));

/** Value patterns that must never be exported (defence in depth for validators and free text). */
const SECRET_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  /\bbearer\s+\S+/i,
  /\b(sk|pk|pcsk|ghp|xox[bap])[-_][A-Za-z0-9_-]{8,}/i,
  /[?&](code|state|token|access_token|id_token|key|secret|password)=/i,
  /\?[^\s]*=/,
  /(^|[^A-Za-z0-9])[A-Fa-f0-9]{32,}($|[^A-Za-z0-9])/,
  /[A-Za-z0-9+/_-]{40,}={0,2}/,
  /\b(session|cookie|set-cookie)\b\s*[:=]/i,
  /\b(sid|session_id|connect\.sid)=/i,
  /https?:\/\/[^\s/]*:[^\s/@]*@/i,
];

export function containsSecretPattern(value: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(value));
}

export function sanitizeString(value: unknown, max: number = MAX_STRING_LENGTH): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  if (containsSecretPattern(s)) return REDACTED;
  return s.length > max ? s.slice(0, max) : s;
}

/** Allow-list by signal + per-key value validation. Unknown keys / invalid values are dropped. */
export function sanitizeAttributes(attrs: Attributes | undefined, signal: Signal = 'span'): Attributes {
  const out: Attributes = {};
  if (!attrs) return out;
  for (const key of Object.keys(attrs)) {
    const sp = Object.prototype.hasOwnProperty.call(SCHEMA, key) ? SCHEMA[key] : undefined;
    if (!sp || !sp.signals.includes(signal)) continue;
    const raw = attrs[key];
    if (raw === undefined || raw === null) continue;
    const v = sp.validate(raw);
    if (v === undefined) continue;
    if (typeof v === 'string' && containsSecretPattern(v)) continue;
    out[key] = v;
  }
  return out;
}

// ---------- names (span / event / scope / metric) ----------
// Free-form names can smuggle content, so exact names (or tightly-patterned families) only.

const HTTP_SPAN_NAME = new RegExp(`^(${METHODS.join('|')}|HTTP)( (/[A-Za-z0-9_:.*-]{0,64}){0,12}| unmatched| other)?$`);
const SPAN_NAMES = new Set<string>([
  'oauth.token_exchange', 'oauth.userinfo', 'oauth.login.callback',
  'redis.setex', 'redis.getdel', 'redis.get', 'redis.set', 'redis.del', 'redis.connect', 'redis.other',
]);
const EVENT_NAMES = new Set<string>();
const SCOPE_NAMES = new Set<string>([
  'rec-app', 'rec-app.http', 'rec-app.provider', 'rec-app.runtime', '@opentelemetry/instrumentation-undici',
]);
const METRIC_NAMES = new Set<string>([
  'http.server.request.duration', 'app.http.server.excluded_requests',
  'app.runtime.startup.failures', 'app.runtime.memory.rss', 'app.runtime.memory.heap_used',
  'app.runtime.event_loop.delay.p99', 'app.runtime.requests.in_flight', 'app.runtime.cold_start',
  'app.oauth.client.attempts', 'app.oauth.client.duration', 'app.oauth.login.outcomes', 'app.oauth.state.outcomes',
  'app.redis.operation.count', 'app.redis.operation.duration',
]);
const NAME_RE = /^[a-z@][a-z0-9_.@/-]{0,79}$/;

/**
 * Register additional exact names. This is a code-review gate: call at module load with static string
 * literals only, never with request-derived values. Invalid names are ignored.
 */
export function registerSafeNames(names: { spans?: string[]; events?: string[]; scopes?: string[]; metrics?: string[] }): void {
  const add = (set: Set<string>, list?: string[]) => {
    for (const n of list ?? []) if (typeof n === 'string' && NAME_RE.test(n) && !containsSecretPattern(n)) set.add(n);
  };
  add(SPAN_NAMES, names.spans); add(EVENT_NAMES, names.events); add(SCOPE_NAMES, names.scopes); add(METRIC_NAMES, names.metrics);
}

export function sanitizeSpanName(name: string): string {
  return typeof name === 'string' && (SPAN_NAMES.has(name) || HTTP_SPAN_NAME.test(name)) ? name : 'span';
}
export function sanitizeScopeName(name: string): string {
  return SCOPE_NAMES.has(name) ? name : 'unknown';
}

// ---------- error classification (never reads message text) ----------

export function classifyError(err: unknown): ErrorCategory {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = Number(e.status ?? e.statusCode);
  if (name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/i.test(code)) return 'timeout';
  if (name === 'AbortError' || code === 'ABORT_ERR' || code === 'ECONNABORTED') return 'aborted';
  if (/^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH)$/.test(code) || /^UND_ERR/.test(code)) return 'network';
  if (name === 'ZodError' || name === 'ValidationError') return 'validation';
  if (name === 'SyntaxError' || /Parse/i.test(name)) return 'parse';
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limit';
    if (status >= 400 && status < 500) return 'validation';
    if (status >= 500) return 'upstream';
  }
  if (e.cause && e.cause !== err) {
    const c = classifyError(e.cause);
    if (c !== 'internal') return c;
  }
  return 'internal';
}

/** Mark a span as failed with a controlled category. Exception message/stack are never recorded. */
export function recordSafeError(span: Span, err: unknown): ErrorCategory {
  const category = classifyError(err);
  span.setAttribute('error.type', category);
  span.setStatus({ code: SpanStatusCode.ERROR });
  return category;
}

// ---------- outbound propagation policy ----------

export function isPropagationAllowed(target: string | URL | undefined, config?: Pick<TelemetryConfig, 'propagationAllowlist'>): boolean {
  const allow = config?.propagationAllowlist ?? [];
  if (!target || allow.length === 0) return false;
  try {
    const u = target instanceof URL ? target : new URL(/^[a-z]+:\/\//i.test(target) ? target : `http://${target}`);
    const host = u.hostname.toLowerCase();
    const port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
    return allow.includes(host) || allow.includes(`${host}:${port}`);
  } catch {
    return false;
  }
}

// ---------- exporter wrappers ----------

// Scope versions: plain numeric semver only (no prerelease/build text that could carry content).
const TOKEN_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Drop tracestate (vendor-controlled free text); keep only ids and flags. */
function stripTraceState(sc: SpanContext): SpanContext {
  return { traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags, isRemote: sc.isRemote };
}

export function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const sanitizedResource = resourceFromAttributes(sanitizeAttributes(span.resource.attributes as Attributes, 'resource'));
  const status = { code: span.status.code } as ReadableSpan['status']; // message dropped
  const ctx = stripTraceState(span.spanContext());
  return {
    name: sanitizeSpanName(span.name),
    kind: span.kind,
    spanContext: () => ctx,
    parentSpanContext: span.parentSpanContext ? stripTraceState(span.parentSpanContext) : undefined,
    startTime: span.startTime,
    endTime: span.endTime,
    status,
    attributes: sanitizeAttributes(span.attributes, 'span'),
    links: span.links.map((l) => ({ context: stripTraceState(l.context), attributes: sanitizeAttributes(l.attributes, 'span') })),
    // Exception events carry message + stack; drop them. Keep other events by safe name + allow-listed attrs.
    events: span.events
      .filter((ev) => EVENT_NAMES.has(ev.name))
      .map((ev) => ({ name: ev.name, time: ev.time, attributes: sanitizeAttributes(ev.attributes, 'span') })),
    duration: span.duration,
    ended: span.ended,
    resource: sanitizedResource,
    instrumentationScope: {
      name: sanitizeScopeName(span.instrumentationScope.name),
      version: TOKEN_VERSION.test(span.instrumentationScope.version ?? '') ? span.instrumentationScope.version : undefined,
    },
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount + span.events.filter((ev) => !EVENT_NAMES.has(ev.name)).length,
    droppedLinksCount: span.droppedLinksCount,
  };
}

export interface ExportCounters { exportFailures: number; queueDroppedSpans: number; sdkDiagnostics: number }
export function newCounters(): ExportCounters { return { exportFailures: 0, queueDroppedSpans: 0, sdkDiagnostics: 0 }; }

export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter, private readonly counters: ExportCounters = newCounters()) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    let safe: ReadableSpan[];
    try {
      safe = spans.map(sanitizeSpan);
    } catch {
      this.counters.exportFailures += 1;
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }
    try {
      this.inner.export(safe, (r) => {
        if (r.code !== ExportResultCode.SUCCESS) this.counters.exportFailures += 1;
        // Strip error objects: exporter errors may embed endpoint URLs/body fragments.
        resultCallback({ code: r.code });
      });
    } catch {
      this.counters.exportFailures += 1;
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }
  shutdown(): Promise<void> { return this.inner.shutdown(); }
  forceFlush(): Promise<void> { return this.inner.forceFlush?.() ?? Promise.resolve(); }
}

export function sanitizeResourceMetrics(rm: ResourceMetrics): ResourceMetrics {
  return {
    resource: resourceFromAttributes(sanitizeAttributes(rm.resource.attributes as Attributes, 'resource')),
    scopeMetrics: rm.scopeMetrics
      .map((sm) => ({
        scope: { name: sanitizeScopeName(sm.scope.name), version: TOKEN_VERSION.test(sm.scope.version ?? '') ? sm.scope.version : undefined },
        metrics: sm.metrics
          .filter((m) => METRIC_NAMES.has(m.descriptor.name))
          .map((m) => ({
            ...m,
            descriptor: {
              name: m.descriptor.name,
              description: '',
              unit: /^[A-Za-z0-9{}/_.%-]{0,16}$/.test(m.descriptor.unit) ? m.descriptor.unit : '',
              valueType: m.descriptor.valueType,
            },
            dataPoints: (m.dataPoints as Array<{ attributes: Attributes; exemplars?: unknown }>).map((dp) => {
              const { exemplars: _drop, ...rest } = dp;
              void _drop;
              return { ...rest, attributes: sanitizeAttributes(dp.attributes, 'metric') };
            }),
          })) as unknown as typeof sm.metrics,
      }))
      .filter((sm) => sm.metrics.length > 0),
  };
}

export class SanitizingMetricExporter implements PushMetricExporter {
  constructor(private readonly inner: PushMetricExporter, private readonly counters: ExportCounters = newCounters()) {
    // Forward optional temporality / aggregation selectors so the official exporter's choices are preserved.
    if (inner.selectAggregationTemporality) this.selectAggregationTemporality = inner.selectAggregationTemporality.bind(inner);
    if (inner.selectAggregation) this.selectAggregation = inner.selectAggregation.bind(inner);
  }
  selectAggregationTemporality?: PushMetricExporter['selectAggregationTemporality'];
  selectAggregation?: PushMetricExporter['selectAggregation'];

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    try {
      this.inner.export(sanitizeResourceMetrics(metrics), (r) => {
        if (r.code !== ExportResultCode.SUCCESS) this.counters.exportFailures += 1;
        resultCallback({ code: r.code });
      });
    } catch {
      this.counters.exportFailures += 1;
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }
  forceFlush(): Promise<void> { return this.inner.forceFlush(); }
  shutdown(): Promise<void> { return this.inner.shutdown(); }
}

// ---------- exporter / SDK diagnostics ----------

/**
 * OTel's internal diag logger. SDK errors can embed URLs, headers or response bodies, so this
 * logger prints a fixed code only and discards message/arguments.
 */
// Only these exact SDK messages are interpreted (fixed text; arguments are never read).
const QUEUE_DROP_RE = /^Dropped (\d{1,9}) spans because maxQueueSize reached$/;

export function createSafeDiagLogger(
  sink: (line: string) => void = (l) => console.warn(l),
  counters?: ExportCounters,
): DiagLogger {
  let emitted = 0;
  const log: DiagLogFunction = (message: string) => {
    if (counters) counters.sdkDiagnostics += 1;
    const drop = typeof message === 'string' ? QUEUE_DROP_RE.exec(message) : null;
    if (drop && counters) counters.queueDroppedSpans += Number(drop[1]);
    if (emitted >= 20) return; // bounded noise
    emitted += 1;
    const m = typeof message === 'string' ? message : '';
    const code = drop ? 'queue_saturated'
      : /timed? ?out|timeout/i.test(m) ? 'timeout'
      : /ECONNREFUSED|ENOTFOUND|network|fetch failed|socket/i.test(m) ? 'network'
        : /40\d|50\d|status/i.test(m) ? 'http_status'
          : 'other';
    sink(`[telemetry] sdk diagnostic: category=${code}`);
  };
  const noop: DiagLogFunction = () => undefined;
  return { error: log, warn: log, info: noop, debug: noop, verbose: noop };
}
