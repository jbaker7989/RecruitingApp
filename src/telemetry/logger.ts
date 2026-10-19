/**
 * Structured operational logger (OBS-P1-S08).
 *
 * Operational events only — business audit records stay in the audit store and are
 * never streamed here. Every record is sanitized and volume-bounded; a missing or
 * unsampled trace is a normal case, not an error.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { trace, isSpanContextValid } from '@opentelemetry/api';
import { getRequestContext, parseInboundRequestId } from './context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type EntryPoint = 'http' | 'cli' | 'scheduled' | 'replay' | 'startup';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  environment: string;
  release: string;
  entry_point: EntryPoint | 'unknown';
  request_id?: string;
  run_id?: string;
  trace_id?: string;
  span_id?: string;
  outcome?: string;
  category?: string;
  message?: string;
  attrs?: Record<string, string | number | boolean>;
}

export interface LogFields {
  outcome?: string;
  category?: string;
  message?: string;
  /** Reduced to a bounded category ONLY. Error message, stack and cause are never emitted. */
  error?: unknown;
  attrs?: Record<string, unknown>;
}

export interface LogContext {
  requestId?: string;
  runId?: string;
  entryPoint: EntryPoint;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const EVENT_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const KEY_RE = /^[a-z][a-z0-9_.]{0,39}$/;
const MAX_ATTRS = 12;
const SAFE_TOKEN_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** Allow-list of log attribute keys; anything else (resume, prompt, model_output, email, ...) is dropped. */
export const LOG_ATTR_KEYS: ReadonlySet<string> = new Set([
  'status_code', 'method', 'signal', 'consecutive_failures', 'breaker_open', 'dependency', 'required',
  'event_name', 'suppressed', 'provider', 'operation', 'attempt', 'duration_ms', 'store_mode', 'feature',
  'route', 'count', 'timed_out',
]);
const MAX_TEXT = 120;
const MAX_MESSAGE = 200;
const WINDOW_MS = 10_000;
const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const storage = new AsyncLocalStorage<LogContext>();

export type LogSink = (record: LogRecord) => void;
let customSink: LogSink | null = null;

interface Bucket { windowStart: number; count: number; suppressed: number }
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 256;

// ─── Sanitization ─────────────────────────────────────────────────────────────

/** Remove values that must never reach telemetry: URLs, emails, JWTs, bearer tokens, long opaque blobs. */
export function sanitizeText(input: unknown, max = MAX_TEXT): string {
  let text = typeof input === 'string' ? input : String(input ?? '');
  text = text
    .replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(code|state|token|secret|password|key|authorization)=\S+/gi, '$1=[redacted]')
    .replace(/\b[A-Fa-f0-9]{24,}\b/g, '[id]')
    .replace(/\b[A-Za-z0-9_-]{32,}={0,2}/g, '[blob]')
    .replace(/[\r\n\t]+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Bounded error taxonomy shared by logs and metrics; never derived from free-form message content. */
export function errorCategory(err: unknown): string {
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as { name?: unknown; code?: unknown; cause?: unknown };
  const code = typeof e.code === 'string' ? e.code : typeof (e.cause as { code?: unknown } | undefined)?.code === 'string' ? String((e.cause as { code: string }).code) : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failure';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'connect_failure';
  if (/^(CERT_|ERR_TLS|DEPTH_ZERO|UNABLE_TO_VERIFY|SELF_SIGNED)/.test(code)) return 'tls_failure';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  if (e.name === 'ZodError' || e.name === 'SyntaxError') return 'validation_error';
  if (e.name === 'TypeError' || e.name === 'RangeError' || e.name === 'ReferenceError') return 'internal_error';
  return 'error';
}

function cleanAttrs(attrs?: Record<string, unknown>): LogRecord['attrs'] | undefined {
  if (!attrs) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(attrs)) {
    if (n >= MAX_ATTRS) break;
    if (!KEY_RE.test(k) || !LOG_ATTR_KEYS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = SAFE_TOKEN_RE.test(v) ? v : '[redacted]';
    else continue;
    n += 1;
  }
  return n > 0 ? out : undefined;
}

// ─── Identity and context ─────────────────────────────────────────────────────

function identity() {
  return {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE_ID || 'unknown').slice(0, 12),
  };
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Stamp non-HTTP origins (CLI, scheduled, replay, startup) at their entry point. */
export function runWithEntryPoint<T>(entryPoint: Exclude<EntryPoint, 'http'>, fn: () => T, runId: string = randomUUID()): T {
  return storage.run({ entryPoint, runId }, fn);
}

// ─── Emission ─────────────────────────────────────────────────────────────────

function defaultSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function setLogSink(sink: LogSink | null): void {
  customSink = sink;
}

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVEL_RANK[raw as LogLevel] ?? LEVEL_RANK.info;
}

function emit(record: LogRecord): void {
  try {
    (customSink ?? defaultSink)(record);
  } catch {
    // A failing sink must never affect the application.
  }
}

function build(level: LogLevel, event: string, fields: LogFields = {}): LogRecord {
  const ctx = storage.getStore();
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...identity(),
    entry_point: ctx?.entryPoint ?? 'unknown',
  };
  // Foundation request context (A) is the single source of request IDs when present.
  const foundationId = getRequestContext()?.requestId;
  const requestId = ctx?.requestId ?? foundationId;
  if (!ctx && foundationId) record.entry_point = 'http';
  if (requestId) record.request_id = requestId;
  if (ctx?.runId) record.run_id = ctx.runId;
  try {
    const sc = trace.getActiveSpan()?.spanContext();
    if (sc && isSpanContextValid(sc)) {
      record.trace_id = sc.traceId;
      record.span_id = sc.spanId;
    }
  } catch {
    // tracing unavailable: log without trace identifiers
  }
  if (fields.outcome) record.outcome = sanitizeText(fields.outcome, 40);
  const category = fields.category ?? (fields.error !== undefined ? errorCategory(fields.error) : undefined);
  if (category) record.category = sanitizeText(category, 40);
  // Free-form text from errors is never exported: regexes cannot prove absence of PII or model output.
  if (fields.message) record.message = sanitizeText(fields.message, MAX_MESSAGE);
  const attrs = cleanAttrs(fields.attrs);
  if (attrs) record.attrs = attrs;
  return record;
}

function admit(event: string): 'ok' | 'drop' {
  const t = Date.now();
  let b = buckets.get(event);
  if (!b || t - b.windowStart >= WINDOW_MS) {
    if (b && b.suppressed > 0) {
      const summary = build('warn', 'log.suppressed', { attrs: { event_name: event, suppressed: b.suppressed } });
      emit(summary);
    }
    if (!b && buckets.size >= MAX_BUCKETS) buckets.clear();
    b = { windowStart: t, count: 0, suppressed: 0 };
    buckets.set(event, b);
  }
  const limit = Number(process.env.LOG_EVENT_BURST) > 0 ? Number(process.env.LOG_EVENT_BURST) : 50;
  b.count += 1;
  if (b.count > limit) {
    b.suppressed += 1;
    return 'drop';
  }
  return 'ok';
}

export function logEvent(level: LogLevel, event: string, fields?: LogFields): void {
  try {
    if (LEVEL_RANK[level] < minLevel()) return;
    if (!EVENT_RE.test(event)) {
      event = 'log.invalid_event';
    }
    if (admit(event) === 'drop') return;
    emit(build(level, event, fields));
  } catch {
    // never throw from logging
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => logEvent('debug', event, fields),
  info: (event: string, fields?: LogFields) => logEvent('info', event, fields),
  warn: (event: string, fields?: LogFields) => logEvent('warn', event, fields),
  error: (event: string, fields?: LogFields) => logEvent('error', event, fields),
};

// ─── Express middleware ───────────────────────────────────────────────────────

/** Stamps request ID + entry point at origin; inbound IDs are validated, never trusted blindly. */
export function logContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Reuse the foundation's ID when telemetryMiddleware already ran; otherwise validate/mint with the same rules.
    const requestId = getRequestContext()?.requestId ?? parseInboundRequestId(req.headers['x-request-id']);
    if (!res.getHeader('x-request-id')) res.setHeader('x-request-id', requestId);
    storage.run({ requestId, entryPoint: 'http' }, () => {
      let logged = false;
      const finish = () => {
        if (logged) return;
        logged = true;
        if (res.statusCode >= 500) {
          logEvent('error', 'http.request.failed', {
            outcome: 'server_error',
            attrs: { status_code: res.statusCode, method: KNOWN_METHODS.has(req.method) ? req.method : 'OTHER' },
          });
        }
      };
      res.once('finish', finish);
      res.once('close', finish);
      next();
    });
  };
}

export function resetLoggerForTests(): void {
  customSink = null;
  buckets.clear();
}
