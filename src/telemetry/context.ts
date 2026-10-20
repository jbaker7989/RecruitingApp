/**
 * Request context (OBS-P1-S04/S05). AsyncLocalStorage carries our request id and bounded feature
 * label; trace correlation comes from the active OpenTelemetry span. Works whether or not the
 * SDK is enabled so logs can always carry a request id.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { trace } from '@opentelemetry/api';

export interface RequestContext {
  requestId: string;
  feature?: string;
  applicationOutcome?: 'validation_error';
}

const storage = new AsyncLocalStorage<RequestContext>();

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const FEATURE_RE = /^[a-z][a-z0-9_]{0,31}$/;
const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ZERO_TRACE = /^00-0{32}-/;
const ZERO_SPAN = /-0{16}-[0-9a-f]{2}$/;
export const MAX_TRACEPARENT_LENGTH = 55;
export const MAX_TRACESTATE_LENGTH = 512;

export function generateRequestId(): string {
  return randomBytes(12).toString('hex');
}

/** Accept a client-supplied request id only when it is a short opaque token; otherwise mint one. */
export function parseInboundRequestId(header: unknown): string {
  const v = Array.isArray(header) ? header[0] : header;
  return typeof v === 'string' && REQUEST_ID_RE.test(v) ? v : generateRequestId();
}

/** Returns the header when it is a well-formed, size-bounded W3C traceparent, else undefined. */
export function parseInboundTraceparent(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.length > MAX_TRACEPARENT_LENGTH) return undefined;
  if (!TRACEPARENT_RE.test(header) || ZERO_TRACE.test(header) || ZERO_SPAN.test(header)) return undefined;
  return header;
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): (RequestContext & { traceId?: string; spanId?: string }) | undefined {
  const ctx = storage.getStore();
  if (!ctx) return undefined;
  const sc = trace.getActiveSpan()?.spanContext();
  return { ...ctx, traceId: sc?.traceId, spanId: sc?.spanId };
}

/** Set a bounded feature label (e.g. 'resume_parsing') for the current request. Invalid labels are ignored. */
export function setRequestFeature(feature: string): void {
  const ctx = storage.getStore();
  if (ctx && FEATURE_RE.test(feature)) ctx.feature = feature;
}

/** Fields for structured logs (B's logger). Safe to spread into any log record. */
export function getTraceCorrelation(): { trace_id?: string; span_id?: string; request_id?: string } {
  const ctx = storage.getStore();
  const sc = trace.getActiveSpan()?.spanContext();
  const valid = sc && trace.isSpanContextValid(sc);
  return {
    ...(valid ? { trace_id: sc.traceId, span_id: sc.spanId } : {}),
    ...(ctx ? { request_id: ctx.requestId } : {}),
  };
}

/** Preserve application validation failure when a route catches it and returns HTTP 200. */
export function markRequestValidationFailure(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.applicationOutcome = 'validation_error';
}
