/**
 * Outbound provider (OAuth) and Redis operation telemetry (OBS-P1-S06).
 *
 * Built on the official @opentelemetry/api only. Instruments are resolved at call
 * time so any provider registered later is honoured; with no SDK they are no-ops.
 * Spans/metrics carry bounded taxonomy values only: no URLs, headers, bodies, keys,
 * tokens, OAuth codes/state, or raw exception text. Redis is traced MANUALLY here —
 * native ioredis auto-instrumentation is not enabled in this slice.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  SpanKind,
  SpanStatusCode,
  context,
  metrics,
  trace,
  isSpanContextValid,
  type SpanContext,
  TraceFlags,
} from '@opentelemetry/api';
import { errorCategory, logger } from './logger.js';

export type ProviderOutcome =
  | 'success' | 'timeout' | 'dns_failure' | 'connect_failure' | 'tls_failure'
  | 'rate_limited' | 'server_error' | 'client_error' | 'invalid_configuration'
  | 'user_cancelled' | 'invalid_state' | 'validation_error' | 'unknown';

export type OAuthProvider = 'google' | 'linkedin' | 'facebook';
export type ClientOperation = 'token_exchange' | 'userinfo';
export type StateOutcome = 'stored' | 'consumed' | 'missing_or_expired' | 'redis_unavailable_fallback' | 'memory_fallback';
export type StateStoreMode = 'unconfigured' | 'redis' | 'memory_fallback';
export type RedisOp = 'setex' | 'getdel' | 'get' | 'set' | 'del' | 'connect';

const REDIS_OPS: ReadonlySet<string> = new Set(['setex', 'getdel', 'get', 'set', 'del', 'connect']);
const PROVIDERS: ReadonlySet<string> = new Set(['google', 'linkedin', 'facebook']);
const TRACER = 'rec-app.provider';
const METER = 'rec-app.provider';

/** Error carrying a bounded outcome; message text is unchanged so existing API responses are unaffected. */
export class OAuthFlowError extends Error {
  constructor(message: string, public readonly outcome: ProviderOutcome, public readonly httpStatus?: number) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

export function classifyFailure(err: unknown, httpStatus?: number): ProviderOutcome {
  if (err instanceof OAuthFlowError) return err.outcome;
  const status = httpStatus ?? (err as { httpStatus?: number } | null)?.httpStatus;
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';
    if (status >= 400) return 'client_error';
  }
  const cat = errorCategory(err);
  switch (cat) {
    case 'timeout': case 'dns_failure': case 'connect_failure': case 'tls_failure': case 'validation_error':
      return cat;
    default:
      return 'unknown';
  }
}

// ─── State-store mode (read by readiness) ─────────────────────────────────────

let stateMode: StateStoreMode = 'unconfigured';
export function setStateStoreMode(mode: StateStoreMode): void { stateMode = mode; }
export function getStateStoreMode(): StateStoreMode { return stateMode; }

// ─── Instruments ──────────────────────────────────────────────────────────────

function m() {
  const meter = metrics.getMeter(METER);
  return {
    attempts: meter.createCounter('app.oauth.client.attempts', { description: 'Outbound provider attempts (each retry counts)' }),
    duration: meter.createHistogram('app.oauth.client.duration', { unit: 's', description: 'Outbound provider attempt duration' }),
    logins: meter.createCounter('app.oauth.login.outcomes', { description: 'Logical login outcomes (one per callback)' }),
    state: meter.createCounter('app.oauth.state.outcomes', { description: 'CSRF state-store outcomes' }),
    redisCount: meter.createCounter('app.redis.operation.count', { description: 'Redis operations by outcome' }),
    redisDuration: meter.createHistogram('app.redis.operation.duration', { unit: 's', description: 'Redis operation duration' }),
  };
}

const safeProvider = (p: string): string => (PROVIDERS.has(p) ? p : 'other');
const attemptBucket = (n: number): string => (n <= 1 ? '1' : n === 2 ? '2' : '3+');

// ─── Login scope: separates logical login from outbound attempts ──────────────

interface LoginScope { attempts: Map<string, number>; failedAttempts: number }
const loginScope = new AsyncLocalStorage<LoginScope>();

// ─── Outbound client operation ────────────────────────────────────────────────

export async function tracedClientOperation<T>(
  opts: { provider: OAuthProvider; operation: ClientOperation; attempt?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const scope = loginScope.getStore();
  const key = opts.operation;
  const attempt = opts.attempt ?? (scope ? (scope.attempts.get(key) ?? 0) + 1 : 1);
  if (scope) scope.attempts.set(key, attempt);
  const provider = safeProvider(opts.provider);
  const span = trace.getTracer(TRACER).startSpan(`oauth.${opts.operation}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'oauth.provider': provider, 'oauth.operation': opts.operation, 'oauth.attempt_bucket': attemptBucket(attempt) },
  });
  const start = process.hrtime.bigint();
  let outcome: ProviderOutcome = 'success';
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (err) {
    outcome = classifyFailure(err);
    if (scope) scope.failedAttempts += 1;
    span.setStatus({ code: SpanStatusCode.ERROR }); // no message, no recordException
    throw err;
  } finally {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    span.setAttribute('oauth.outcome', outcome);
    span.end();
    const attrs = { 'oauth.provider': provider, 'oauth.operation': opts.operation, 'oauth.outcome': outcome, 'oauth.attempt_bucket': attemptBucket(attempt) };
    try {
      const i = m();
      i.attempts.add(1, attrs);
      i.duration.record(seconds, attrs);
    } catch { /* metrics never affect the flow */ }
  }
}

// ─── Logical login outcome ────────────────────────────────────────────────────

export async function observeLogin<T>(
  provider: OAuthProvider,
  fn: () => Promise<T>,
): Promise<T> {
  const span = trace.getTracer(TRACER).startSpan('oauth.login.callback', {
    kind: SpanKind.INTERNAL,
    attributes: { 'oauth.provider': safeProvider(provider) },
  });
  const scope: LoginScope = { attempts: new Map(), failedAttempts: 0 };
  let outcome: ProviderOutcome = 'success';
  try {
    return await loginScope.run(scope, () => context.with(trace.setSpan(context.active(), span), fn));
  } catch (err) {
    outcome = classifyFailure(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    const recovered = outcome === 'success' && scope.failedAttempts > 0;
    span.setAttribute('oauth.outcome', outcome);
    span.setAttribute('oauth.recovered', recovered);
    span.end();
    try {
      m().logins.add(1, { 'oauth.provider': safeProvider(provider), 'oauth.outcome': outcome, 'oauth.recovered': recovered });
    } catch { /* ignore */ }
    logger.info('oauth.login.completed', { outcome, attrs: { provider: safeProvider(provider) } });
  }
}

/** User declined at the provider (route layer). Counts the logical outcome without any outbound attempt. */
export function recordOAuthUserDenied(provider: OAuthProvider): void {
  try { m().logins.add(1, { 'oauth.provider': safeProvider(provider), 'oauth.outcome': 'user_cancelled', 'oauth.recovered': false }); } catch { /* ignore */ }
  logger.info('oauth.login.completed', { outcome: 'user_cancelled', attrs: { provider: safeProvider(provider) } });
}

/** Missing code/state at the callback (route layer). */
export function recordOAuthValidationFailure(provider: OAuthProvider): void {
  try { m().logins.add(1, { 'oauth.provider': safeProvider(provider), 'oauth.outcome': 'validation_error', 'oauth.recovered': false }); } catch { /* ignore */ }
  logger.warn('oauth.login.completed', { outcome: 'validation_error', attrs: { provider: safeProvider(provider) } });
}

// ─── State outcomes + opaque correlation ──────────────────────────────────────

export function recordStateOutcome(outcome: StateOutcome): void {
  try { m().state.add(1, { 'oauth.state_outcome': outcome }); } catch { /* ignore */ }
  if (outcome !== 'stored' && outcome !== 'consumed') logger.warn('oauth.state.outcome', { outcome });
}

/** `traceId-spanId` of the active span (opaque; never state/tokens), or undefined when tracing is inactive or links are not opted in (OBS_OAUTH_SPAN_LINKS=true; default OFF pending policy approval). */
export function currentCorrelation(): string | undefined {
  if (process.env.OBS_OAUTH_SPAN_LINKS !== 'true') return undefined;
  const sc = trace.getActiveSpan()?.spanContext();
  return sc && isSpanContextValid(sc) ? `${sc.traceId}-${sc.spanId}` : undefined;
}

const CORRELATION_RE = /^([0-9a-f]{32})-([0-9a-f]{16})$/;
export function parseCorrelation(value: string | undefined | null): SpanContext | undefined {
  const match = value ? CORRELATION_RE.exec(value) : null;
  if (!match) return undefined;
  const sc: SpanContext = { traceId: match[1], spanId: match[2], traceFlags: TraceFlags.NONE, isRemote: true };
  return isSpanContextValid(sc) ? sc : undefined;
}

/** Link the active callback span to the initiating redirect span (opaque IDs only). */
export function linkActiveSpanTo(sc: SpanContext | undefined): void {
  if (!sc || !isSpanContextValid(sc)) return;
  try { trace.getActiveSpan()?.addLink({ context: sc }); } catch { /* links are best-effort */ }
}

// ─── Redis ────────────────────────────────────────────────────────────────────

export async function tracedRedisOperation<T>(op: RedisOp, fn: () => Promise<T>): Promise<T> {
  const name = REDIS_OPS.has(op) ? op : 'other';
  const span = trace.getTracer(TRACER).startSpan(`redis.${name}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'db.system.name': 'redis', 'db.operation.name': name },
  });
  const start = process.hrtime.bigint();
  let outcome: 'success' | ProviderOutcome = 'success';
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (err) {
    outcome = classifyFailure(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.setAttribute('app.outcome', outcome);
    span.end();
    const attrs = { 'db.system.name': 'redis', 'db.operation.name': name, 'app.outcome': outcome };
    try {
      const i = m();
      i.redisCount.add(1, attrs);
      i.redisDuration.record(Number(process.hrtime.bigint() - start) / 1e9, attrs);
    } catch { /* ignore */ }
  }
}
