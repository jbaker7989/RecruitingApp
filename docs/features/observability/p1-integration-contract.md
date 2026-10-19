# OBS-001-P1 integration contract (S01–S05 foundation)

**Status:** Published for parallel implementation (agent A = telemetry foundation; agent B = logs/runtime/dependencies/lifecycle; test agent = `tests/observability*.test.ts`).
**Scope:** local, synthetic-data only. Export is **default off**. No hosted backend, vendor, retention, or owner is approved (D01–D04 open). Nothing here is production policy.

Everything is built on official OpenTelemetry JS packages (`@opentelemetry/api`, `sdk-trace-node`, `sdk-trace-base`, `sdk-metrics`, `resources`, `semantic-conventions`, `context-async-hooks`, `core`, `exporter-*-otlp-http`, `instrumentation-undici`). There is no homegrown telemetry client: modules in `src/telemetry/` only configure, gate and sanitize the official SDK. Other code uses `@opentelemetry/api` directly (`trace`, `metrics`, `context`, `SpanKind`, …).

## File ownership

| File (`src/telemetry/`) | Owner | Purpose |
|---|---|---|
| `config.ts`, `bootstrap.ts`, `privacy.ts`, `context.ts`, `http.ts`, `testing.ts`, `init.ts`, `index.ts` | A | foundation (this contract) |
| `logger.ts`, `runtime.ts`, `dependencies.ts`, `lifecycle.ts` | B | structured logs, health/runtime gauges, outbound/OAuth/Redis helpers, shutdown/flush wiring |
| `tests/observability*.test.ts` | test agent | acceptance tests |
| `tests/telemetry-foundation*.test.ts` | A | focused unit tests |

B and the test agent import **only** from `src/telemetry/index.ts` (the barrel). Do not deep-import A's files.

## Configuration (environment; all validated and bounded in `config.ts`)

| Variable | Default | Bounds / rule |
|---|---|---|
| `TELEMETRY_ENABLED` | `false` | `true`/`1` enables SDK. Off ⇒ OTel API stays no-op, no exporter, no listeners. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | base URL (`/v1/traces`, `/v1/metrics` appended). Per-signal `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `…_METRICS_ENDPOINT` honoured. http(s) only. Missing/invalid ⇒ export disabled with a sanitized diagnostic. |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | read by the official exporter; **secret, never logged/printed by us** |
| `TELEMETRY_ALLOW_REMOTE_EXPORT` | `false` | non-loopback hosts are rejected unless `true` (approval-gated; keep false until S01/S02 approved) |
| `OTEL_SERVICE_NAME` | `rec-app` | `[A-Za-z0-9._-]{1,64}` |
| `TELEMETRY_ENVIRONMENT` | `VERCEL_ENV` → `NODE_ENV` → `development` | `[a-z0-9_-]{1,32}` |
| `TELEMETRY_RELEASE` | `VERCEL_GIT_COMMIT_SHA[0..12]` → `unknown` | `[A-Za-z0-9._-]{1,40}` |
| `TELEMETRY_TRACE_SAMPLE_RATIO` | `1` | 0–1. Applies to traces only; **metrics always count the full population** |
| `TELEMETRY_EXPORT_TIMEOUT_MS` | 5000 | 500–30000 |
| `TELEMETRY_MAX_QUEUE_SIZE` / `TELEMETRY_MAX_EXPORT_BATCH` | 512 / 128 | 16–8192 / ≤ queue |
| `TELEMETRY_SCHEDULE_DELAY_MS` | 2000 | 100–60000 |
| `TELEMETRY_METRIC_INTERVAL_MS` | 15000 | 1000–300000 |
| `TELEMETRY_SHUTDOWN_TIMEOUT_MS` | 2000 | 100–10000 |
| `TELEMETRY_TRUST_INBOUND_TRACE` | `false` | when false, inbound `traceparent` is ignored (new root). When true it is validated/size-bounded and continues the trace **but cannot raise sampling above the configured ratio** |
| `TELEMETRY_PROPAGATION_ALLOWLIST` | empty | comma list of `host` or `host:port` that receive `traceparent`. Empty ⇒ no outbound propagation. Baggage is never propagated. |
| `TELEMETRY_MAX_ROUTES` | 200 | 10–1000 distinct route labels; overflow ⇒ `other` |
| `TELEMETRY_EXCLUDE_ROUTES` | `/health` | comma list of exact paths excluded from traces **and** RED histogram (counted in `app.http.server.excluded_requests`) |

Out-of-range numbers are clamped to the default with a diagnostic; they never throw. Diagnostics contain variable *names* and fixed codes only, never values.

## Public API (`import … from '../telemetry/index.js'`)

```ts
// lifecycle (bootstrap.ts)
initTelemetry(options?: {
  env?: NodeJS.ProcessEnv;                 // default process.env
  overrides?: Partial<TelemetryConfig>;    // applied after env parsing, then re-validated
  testing?: {                              // injection hooks for tests
    spanExporter?: SpanExporter;           // official SpanExporter (e.g. InMemorySpanExporter)
    metricExporter?: PushMetricExporter;   // official (e.g. InMemoryMetricExporter)
    spanProcessor?: 'simple' | 'batch';    // default 'simple' when spanExporter injected
    forceEnabled?: boolean;                // default true when any exporter injected
  };
}): TelemetryRuntime                       // idempotent: second call while active returns same runtime
getTelemetryRuntime(): TelemetryRuntime | undefined
isTelemetryEnabled(): boolean
getTelemetryStatus(): { enabled; exporting; reason?; serviceName; environment; release; sampleRatio; diagnostics: string[]; dropped: { exportFailures: number; queueDroppedSpans: number } }  // queueDroppedSpans from the SDK's fixed warning 'Dropped N spans because maxQueueSize reached' (reported on the next export; can lag one batch)
forceFlushTelemetry(timeoutMs?): Promise<boolean>   // never rejects; false on timeout OR any export failure during the flush
shutdownTelemetry(timeoutMs?): Promise<void>        // never rejects; flushes, unregisters globals (API disabled again) so init can be re-run in tests
// runtime.flushable = { forceFlush, shutdown } -> pass to B's registerLifecycleHooks([...]) (signals/beforeExit)

// config.ts
loadTelemetryConfig(env?): { config: TelemetryConfig; diagnostics: string[] }

// tracer/meter access (official API, pre-scoped)
getTracer(name?: string): Tracer            // trace.getTracer('rec-app' | name)
getMeter(name?: string): Meter              // metrics.getMeter(...)

// safe schema (privacy.ts)
sanitizeAttributes(attrs, signal: 'resource'|'span'|'metric' = 'span'): Attributes  // per-signal key allow-list + per-key value validators
registerSafeNames({ spans?, events?, metrics?, scopes? }): void  // exact names, static literals only; unregistered span names -> 'span', events dropped, metrics dropped
ALLOWED_SPAN_KEYS / ALLOWED_METRIC_KEYS / ALLOWED_RESOURCE_KEYS
sanitizeString(v, max?): string
ALLOWED_ATTRIBUTE_KEYS: ReadonlySet<string>
ERROR_CATEGORIES: readonly ['timeout','network','validation','auth','not_found','rate_limit','upstream','parse','aborted','internal']
classifyError(err: unknown): ErrorCategory  // never inspects/returns message text
recordSafeError(span: Span, err: unknown): ErrorCategory // sets status ERROR (no message), error.type; NEVER calls recordException
isPropagationAllowed(url|host, config?): boolean
SanitizingSpanExporter / SanitizingMetricExporter   // wrappers applied around EVERY exporter incl. injected ones
sanitizeSpan(span: ReadableSpan): ReadableSpan      // exported for direct unit tests

// request context (context.ts) – AsyncLocalStorage, independent of whether telemetry is enabled
getRequestContext(): { requestId: string; traceId?: string; spanId?: string; feature?: string } | undefined
runWithRequestContext(ctx, fn)
setRequestFeature(feature: string)          // bounded label, e.g. 'resume_parsing'
getTraceCorrelation(): { trace_id?: string; span_id?: string; request_id?: string }  // for B's logger
generateRequestId(): string
parseInboundRequestId(header: unknown): string   // ^[A-Za-z0-9_-]{8,64}$ else generated
parseInboundTraceparent(header: unknown): string | undefined // validated, ≤ 55 chars

// HTTP (http.ts)
telemetryMiddleware(options?): express.RequestHandler  // mount FIRST in src/index.ts
telemetryErrorMiddleware(): express.ErrorRequestHandler // optional, before the app errorHandler; marks safe error category, calls next(err)
normalizeRoute(path: string): string
HTTP_DURATION_BUCKETS_SECONDS: number[]

// tests (testing.ts; safe to import from tests only)
createTestTelemetry(opts?): TestTelemetry      // synchronous
startOtlpSink(opts?): Promise<OtlpSink>       // real loopback OTLP/HTTP JSON receiver
```

### Test-injection quick start

```ts
import { createTestTelemetry } from '../src/telemetry/index.js';
const t = createTestTelemetry({ overrides: { traceSampleRatio: 0 } });  // sync
// …make real HTTP requests to app.listen(0)…
await t.flush();
t.spans();                     // ReadableSpan[] AFTER sanitizer (== what would be exported)
t.metrics();                   // ResourceMetrics[] AFTER sanitizer
t.histogram('http.server.request.duration') // -> [{ attributes, count, sum, buckets, boundaries }]
t.count('http.server.request.duration', {'app.outcome':'server_error'})
t.payloadJson();               // JSON.stringify of everything exported → canary scans
t.reset(); await t.shutdown(); // shutdown unregisters OTel globals
```
`startOtlpSink({ mode: 'ok' | 'http500' | 'hang' | 'drop' })` returns `{ url, requests: [{path, json}], close() }` for exporter-failure / wire-payload tests (`initTelemetry({ overrides: { enabled: true, tracesEndpoint: `${sink.url}/v1/traces`, metricsEndpoint: `${sink.url}/v1/metrics` } })`).

## Metrics and spans emitted by `telemetryMiddleware`

- Server span, `SpanKind.SERVER`, name `"{METHOD} {route}"`, attributes (allow-listed): `http.request.method`, `http.route`, `http.response.status_code`, `url.scheme`, `app.request.id`, `app.feature`, `app.outcome`, `error.type` (category only). Resource: `service.name`, `service.version`(release), `deployment.environment.name`.
- Histogram `http.server.request.duration` (unit `s`, monotonic `process.hrtime`, explicit buckets `HTTP_DURATION_BUCKETS_SECONDS`). Attributes: `http.request.method`, `http.route` (template or `unmatched`/`other`), `app.status_class` (`2xx|3xx|4xx|5xx|aborted`), `app.outcome` (`success|client_error|server_error|aborted`), `app.feature`, `app.environment`, `app.traffic` (`real|synthetic`). **One observation per eligible request** (finish/close guarded). Request count = histogram count; error-rate numerator = `app.outcome=server_error` (+ `aborted` reported separately). 4xx auth/validation are included and labelled `client_error` (not service errors).
- Counter `app.http.server.excluded_requests{reason=health|static}` counts excluded traffic so nothing disappears silently.
- Synthetic marker: header `x-telemetry-synthetic: 1` only relabels `app.traffic=synthetic` (client-forgeable, so it never removes a request from the population).
- Metrics are recorded regardless of trace sampling (`TELEMETRY_TRACE_SAMPLE_RATIO=0` still produces full histograms).
- Response header `x-request-id` is set from a validated inbound `x-request-id` or a generated id.

## Bootstrap/wiring facts (S03)

- `src/index.ts` starts with `import './telemetry/init.js'` (first import ⇒ evaluated before Express and other modules); `init.ts` calls `initTelemetry()` once (idempotent). Importing `app` in a test starts no listener; with default env it registers nothing.
- `telemetryMiddleware()` is mounted before `cors()`/`json()`; B's request-logging middleware (if any) mounts after it so it can use `getTraceCorrelation()`.
- Outbound `fetch`/undici is auto-instrumented via `@opentelemetry/instrumentation-undici` (diagnostics_channel, no ESM loader hook needed). Express-layer and ioredis auto-instrumentation need the ESM loader hook (`--import`) and are **not** enabled in this slice: S06 owns Redis; B should create manual client spans via `getTracer()` (`SpanKind.CLIENT`, attributes `db.system.name='redis'`, `db.operation.name`) which join the active request context. Honest limitation recorded in the S03 ADR.
- Outbound propagation: only `traceparent`, only to `TELEMETRY_PROPAGATION_ALLOWLIST` destinations; no baggage propagator is ever registered. Client spans are still created for denied destinations.

## Rules for B and later agents

1. Use `getTracer()/getMeter()`. Attributes must be in the per-signal allow-list with a valid value (bounded enums such as `oauth.outcome`, `db.operation.name`); `app.request.id` is span-only (never a metric label). Anything else is dropped at export, as are unregistered span/metric/event/scope names — add keys in `privacy.ts` or call `registerSafeNames` with literals (ask A). Existing B keys/names (oauth.*, redis, app.runtime.*) are already allowed.
2. For errors use `recordSafeError(span, err)`; never `span.recordException`, never put message text in span status.
3. Never use raw paths, ids, emails, Redis keys, query strings or model text as span names / metric labels.
4. Logs: include `getTraceCorrelation()` fields; do not log request bodies. Log redaction uses `sanitizeString`.
5. Anything exporting must go through `SanitizingSpanExporter`/`SanitizingMetricExporter` (bootstrap does this for you).
6. If you need an env var or config field, ask A; do not read telemetry env directly.

## Error taxonomies and request-id ownership

- `error.type` (A, spans/HTTP metric): `ERROR_CATEGORIES`. B's `oauth.outcome` / `ProviderOutcome` and `app.outcome` provider values are separate bounded enums (allow-listed). Do not reuse one for the other.
- Request id: `telemetryMiddleware` is the single owner. It validates/mints the id, sets `req.headers['x-request-id']` and the response header; B's `logContextMiddleware` (mounted after it) adopts the same value. Mount order: `telemetryMiddleware` → `logContextMiddleware` → `concurrencyMiddleware`.

## Local stack

`observability/local/` (Collector, Jaeger, Prometheus, Loki, Grafana); `npm run telemetry:stack:up`, `npm run telemetry:verify`. See `observability/local/README.md`.

## Evidence/approval state

S01/S02 deliver *proposed options* (ADRs) only; no approver/budget/retention is invented. Hosted export and applicant/production data stay blocked. See `adr/`.
