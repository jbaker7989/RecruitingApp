/**
 * Express request telemetry (OBS-P1-S03/S05): one server span + one duration observation per eligible
 * request. Metrics are recorded for the FULL request population independent of trace sampling.
 *
 * Inclusion rules (documented in docs/features/observability/adr/adr-s05-http-red-metrics.md):
 *  - included: every request except paths in TELEMETRY_EXCLUDE_ROUTES (default /health) and static assets
 *  - excluded requests are still counted in app.http.server.excluded_requests{app.reason}
 *  - 4xx (auth/validation) are included, labelled outcome=client_error, NOT counted as service errors
 *  - header x-telemetry-synthetic: 1 only relabels app.traffic=synthetic; it never removes a request
 */
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import { getTelemetryRuntime, HTTP_TRACER_NAME, parentContextFromTraceparent, HTTP_DURATION_BUCKETS_SECONDS } from './bootstrap.js';
import { parseInboundRequestId, parseInboundTraceparent, runWithRequestContext } from './context.js';
import type { RequestContext } from './context.js';
import { recordSafeError } from './privacy.js';

export { HTTP_DURATION_BUCKETS_SECONDS };

const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']);
const STATIC_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|txt)$/i;
const ID_SEGMENT = /^(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i;
const errorTypes = new WeakMap<Response, string>();

/** Collapse id-like segments, bound length/depth; never returns raw paths with identifiers. */
export function normalizeRoute(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/')) return 'unmatched';
  const segs = path.split('/').slice(1, 13).map((s) => {
    if (s.startsWith(':') || s === '*') return s.slice(0, 40);
    return ID_SEGMENT.test(s) ? ':id' : s.slice(0, 40);
  });
  const out = '/' + segs.join('/');
  return /^(\/[A-Za-z0-9_:.*-]{0,64}){0,12}$/.test(out) ? out.replace(/\/+$/, '') || '/' : 'other';
}

function routeTemplate(req: Request, seen: Set<string>, max: number): string {
  const rp = req.route?.path as unknown;
  let route: string;
  if (typeof rp !== 'string') route = req.route ? 'other' : 'unmatched';
  else route = normalizeRoute(`${req.baseUrl || ''}${rp === '/' && req.baseUrl ? '' : rp}` || '/');
  if (route === 'unmatched' || route === 'other') return route;
  if (!seen.has(route)) {
    if (seen.size >= max) return 'other';
    seen.add(route);
  }
  return route;
}

function featureFor(route: string): string {
  if (route === 'unmatched' || route === 'other') return 'unknown';
  const seg = route.split('/').filter(Boolean);
  const name = seg[0] === 'api' ? seg[1] : seg[0];
  return name && /^[a-z][a-z0-9_]{0,31}$/.test(name) ? name : 'root';
}

const statusClass = (code: number): string => `${Math.floor(code / 100)}xx`;

export interface TelemetryMiddlewareOptions { now?: () => bigint }

export function telemetryMiddleware(options: TelemetryMiddlewareOptions = {}): RequestHandler {
  const now = options.now ?? (() => process.hrtime.bigint());
  return (req, res, next) => {
    // Request id is minted/validated here (single owner) and echoed so downstream log middleware adopts it.
    const requestId = parseInboundRequestId(req.headers['x-request-id']);
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);
    const rctx: RequestContext = { requestId };

    const rt = getTelemetryRuntime();
    if (!rt?.enabled || !rt.http) {
      runWithRequestContext(rctx, next);
      return;
    }
    const { config, http } = rt;

    const path = req.path;
    const reason = config.excludeRoutes.includes(path) ? 'health'
      : (req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/') && STATIC_EXT.test(path) ? 'static'
        : undefined;
    if (reason) {
      http.excluded.add(1, { 'app.reason': reason });
      runWithRequestContext(rctx, next);
      return;
    }

    const method = KNOWN_METHODS.has(req.method) ? req.method : '_OTHER';
    const synthetic = req.headers['x-telemetry-synthetic'] === '1';
    const startedAt = now();

    // Inbound trace context: ignored unless explicitly trusted; always validated and size-bounded.
    // tracestate and baggage are never read.
    let parent = context.active();
    if (config.trustInboundTrace) {
      const tp = parseInboundTraceparent(req.headers.traceparent);
      if (tp) parent = parentContextFromTraceparent(tp);
    }

    const tracer = trace.getTracer(HTTP_TRACER_NAME);
    const span = tracer.startSpan(method, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': method,
        'url.scheme': req.protocol === 'https' ? 'https' : 'http',
        'app.request.id': requestId,
      },
    }, parent);

    let done = false;
    const finalize = (aborted: boolean) => {
      if (done) return;
      done = true;
      try {
        const seconds = Number(now() - startedAt) / 1e9;
        const code = res.statusCode;
        const route = routeTemplate(req, http.seenRoutes, config.maxRoutes);
        const feature = rctx.feature ?? featureFor(route);
        const outcome = aborted ? 'aborted' : code >= 500 ? 'server_error' : code >= 400 ? 'client_error' : 'success';
        const attrs: Attributes = {
          'http.request.method': method,
          'http.route': route,
          'app.status_class': aborted ? 'aborted' : statusClass(code),
          'app.outcome': outcome,
          'app.feature': feature,
          'app.environment': config.environment,
          'app.traffic': synthetic ? 'synthetic' : 'real',
        };
        http.duration.record(seconds, attrs);

        span.updateName(`${method} ${route}`);
        span.setAttributes({ 'http.route': route, 'app.feature': feature, 'app.outcome': outcome });
        if (!aborted) span.setAttribute('http.response.status_code', code);
        if (aborted || code >= 500) {
          span.setAttribute('error.type', errorTypes.get(res) ?? (aborted ? 'aborted' : 'internal'));
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
      } catch {
        try { span.end(); } catch { /* never affect the response */ }
      }
    };
    res.once('finish', () => finalize(false));
    res.once('close', () => finalize(!res.writableFinished));

    const ctx = trace.setSpan(parent, span);
    context.with(ctx, () => runWithRequestContext(rctx, next));
  };
}

/** Optional: place before the app error handler. Marks a controlled error category; never records message text. */
export function telemetryErrorMiddleware(): ErrorRequestHandler {
  return (err, _req, res, next) => {
    try {
      const span = trace.getActiveSpan();
      if (span) errorTypes.set(res, recordSafeError(span, err));
    } catch { /* ignore */ }
    next(err);
  };
}
