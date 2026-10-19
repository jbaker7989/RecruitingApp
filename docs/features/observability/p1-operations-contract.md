# P1 operations modules contract (S06–S10)

Owner: operations agent. Consumers: root (wiring), Agent A (foundation), test agent (`tests/observability*.test.ts`).
All modules use only the official `@opentelemetry/api` (`trace`, `metrics`, `context`) resolved **at call time**, so any provider registered later (including tests registering `InMemorySpanExporter` / `InMemoryMetricReader` from the official SDK) is picked up. With no SDK registered they are no-ops.

## `src/telemetry/logger.ts` (S08)
- `logEvent(level, event, fields?)`, `logger.{debug,info,warn,error}(event, fields?)`. Never throws.
- Record shape (`LogRecord`): `timestamp, level, event, environment, release, entry_point, request_id?, run_id?, trace_id?, span_id?, outcome?, category?, message?, attrs?`.
- `event` must match `/^[a-z][a-z0-9_.]{0,63}$/` (else `log.invalid_event`). `fields = { outcome?, category?, message?, error?, attrs? }`; `error` is reduced to a bounded category + sanitized/truncated message (never stack, URL, token, email, JWT, hex/base64 blob). `attrs`: max 12 primitive keys, keys `/^[a-z][a-z0-9_.]{0,39}$/`, strings sanitized ≤120 chars.
- Level threshold `LOG_LEVEL` (default `info`). Volume bound: ≤ `LOG_EVENT_BURST` (default 50) per event name per 10 s; overflow is counted and emitted as one `log.suppressed` summary.
- **Test hook:** `setLogSink((record) => void | null)` captures records (no stdout); `null` restores default (JSON line to stdout/stderr for warn+error). `resetLoggerForTests()`.
- Request IDs: when A's `telemetryMiddleware` already established a request context (`context.ts`), the logger reuses that ID (single source); `logContextMiddleware` only mints/validates (A's `parseInboundRequestId`) when none exists. Mount it after `telemetryMiddleware`.
- Context (survives without spans/traces): `runWithLogContext({ requestId?, runId?, entryPoint }, fn)`, `getLogContext()`, `logContextMiddleware()` (Express; validates inbound `x-request-id` against `/^[A-Za-z0-9._-]{8,64}$/`, else generates UUID; echoes `x-request-id`; stamps `entry_point: "http"`; emits `http.request.failed` at warn/error for status ≥ 500 on finish). `runWithEntryPoint('cli'|'scheduled'|'replay'|'startup', fn)`. trace/span IDs come from `trace.getActiveSpan()` and are omitted when absent/invalid.
- Identity: `environment` = `VERCEL_ENV ?? NODE_ENV ?? "development"`, `release` = `VERCEL_GIT_COMMIT_SHA ?? RELEASE_ID ?? "unknown"` (first 12 chars).

## `src/telemetry/runtime.ts` (S09 runtime)
- `getRuntimeSnapshot()` → `{ memory:{rss,heap_used,heap_total,external}, event_loop_delay_ms:{p50,p99,max}, concurrency:{in_flight,peak_in_flight,total_requests}, uptime_s, cold_start:boolean, startup_failures:number, unavailable:[{signal,reason}] }`. Metrics that the platform cannot supply (CPU throttling, platform memory limit when `process.constrainedMemory()` is 0, per-instance concurrency limits) are listed in `unavailable`, never as 0.
- `concurrencyMiddleware()` (Express): tracks in-flight; counts each request once (finish or close).
- `registerRuntimeMetrics()` registers official observable gauges (`app.runtime.memory.rss|heap_used`, `app.runtime.event_loop.delay.p99`, `app.runtime.requests.in_flight`, `app.runtime.cold_start`). Idempotent. `recordStartupFailure(category)`; `resetRuntimeForTests()`.

## `src/telemetry/dependencies.ts` (S09 readiness)
- `registerDependency({ name, required, check, timeoutMs=1000, ttlMs=5000 })`; check returns `'up'|'degraded'|'down'`; results cached for `ttlMs`, concurrent callers share one in-flight probe, timeout → `down`. `registerDefaultDependencies()`: `store` (required; filesystem readability only — **never** claims durability), `oauth_state_store` (optional; redis / memory fallback = degraded), `telemetry_export` (optional; from lifecycle freshness).
- `getReadiness()` → public-safe `{ status:'ready'|'degraded'|'not_ready', checked_at, dependencies:[{name,required,status}] }`. `not_ready` iff a required dependency is `down`; `degraded` iff only optional ones are not `up`.
- Express handlers: `readinessHandler` (200 for ready/degraded, 503 for not_ready; **no** messages/hosts/errors) and `diagnosticsHandler` (internal detail: runtime snapshot + export health + dependency detail; responds **404 unless** `TELEMETRY_DIAGNOSTICS_TOKEN` is set and `Authorization: Bearer <token>` matches, timing-safe). `/health` is untouched and remains the cheap liveness probe.
- Test hooks: `resetDependenciesForTests()`; custom dependencies via `registerDependency`.

## `src/telemetry/lifecycle.ts` (S07 + export health)
- `instrumentExporter(signal: 'traces'|'metrics'|'logs', exporter, opts?)` wraps any OTel exporter (`{export(items, cb), shutdown(), forceFlush?}` — structural, official classes drop in). Wrapper: hard deadline `exportTimeoutMs` (default 3000); circuit breaker (opens after `breakerThreshold` default 3 consecutive failures, cooldown `breakerCooldownMs` default 30000, dropped items counted and reported as FAILED to the SDK, **no retry loops**); never throws; `opts.isolate?: (fn)=>T` lets foundation run the real export inside `suppressTracing` (from `@opentelemetry/core`) so exporter HTTP is not self-instrumented. Records health only in-process (independent of OTLP).
- `getExportHealth()` → per signal `{ state:'never'|'fresh'|'stale'|'disabled', last_success_at?, last_failure_at?, consecutive_failures, failures_by_category, dropped_items, timeouts, breaker_open, queue_saturation: 'unmeasured' }` (SDK batch-queue drops occur before the exporter callback fires and cannot be observed by the wrapper, so `queue_saturation` remains `'unmeasured'`, never 0). **Separately**, `createSafeDiagLogger` (privacy.ts, A) parses the SDK's fixed warning "Dropped N spans because maxQueueSize reached" and accumulates a total in `counters.queueDroppedSpans`, exposed via `getTelemetryStatus().dropped.queueDroppedSpans` (can lag one batch); `TELEMETRY_STALE_AFTER_MS` default 120000; `OTEL_SDK_DISABLED=true` ⇒ `disabled`.
- `flushTelemetry(flushables, timeoutMs=2000)` → `{ok, timed_out}` never rejects. `registerLifecycleHooks(flushables)` flushes on `beforeExit` and SIGTERM/SIGINT (removes own listener, then re-raises so default termination is preserved); idempotent.
- `EXPORT_BUDGET_PROPOSAL` is a **proposed, unapproved** set of numbers (S07-AC1 still needs an approver).
- Test hooks: `recordExportResult(...)`, `resetLifecycleForTests()`.

## `src/telemetry/providerOps.ts` (S06 helpers, used by `oauthService.ts`)
- Taxonomy `ProviderOutcome`: `success, timeout, dns_failure, connect_failure, tls_failure, rate_limited, server_error, client_error, invalid_configuration, user_cancelled, invalid_state, validation_error, unknown`. `classifyFailure(err, httpStatus?)`.
- `tracedClientOperation({provider, operation:'token_exchange'|'userinfo', attempt?}, fn)` — CLIENT span `oauth.<operation>`; attrs `oauth.provider`, `oauth.operation`, `oauth.attempt`, `oauth.outcome` only (no URL/headers/body; no `recordException`). Metrics: `app.oauth.client.attempts` {provider, operation, outcome, attempt_bucket}, `app.oauth.client.duration` (s).
- `observeLogin(provider, fn)` — logical outcome counter `app.oauth.login.outcomes` {provider, outcome, recovered}; one per callback regardless of attempts; INTERNAL span `oauth.login.callback` with an optional span link to the initiating redirect span.
- `tracedRedisOperation(op, fn)` — op ∈ allow-list (`setex,getdel,get,set,del,connect`), CLIENT span `redis.<op>`, `db.system.name=redis`, `db.operation.name`; metrics `app.redis.operation.count|duration`. No keys/args/values.
- `recordStateOutcome(outcome)` → `app.oauth.state.outcomes` {outcome: `stored|consumed|missing_or_expired|redis_unavailable_fallback|memory_fallback`}.
- `recordOAuthUserDenied(provider)`, `recordOAuthValidationFailure(provider)` for the route layer.
- Opaque correlation (AC5): the initiating span's `traceId-spanId` (never state/tokens) is stored beside the CSRF state and turned into a span *link* on the callback span. **Default OFF**; opt in with `OBS_OAUTH_SPAN_LINKS=true` for local/synthetic evidence only. Approval of the correlation policy is S04/S02-dependent → **pending**.

## Root wiring needed (not done by this agent)
`src/index.ts`, after `cookieParser()` and before routes:
```ts
import { logContextMiddleware, logger } from './telemetry/logger.js';
import { concurrencyMiddleware, registerRuntimeMetrics, recordStartupFailure } from './telemetry/runtime.js';
import { readinessHandler, diagnosticsHandler, registerDefaultDependencies } from './telemetry/dependencies.js';
import { registerLifecycleHooks } from './telemetry/lifecycle.js';
app.use(logContextMiddleware()); app.use(concurrencyMiddleware());
app.get('/ready', readinessHandler);                    // before authenticate, next to /health
app.get('/api/internal/telemetry-diagnostics', diagnosticsHandler); // before authenticate; self-authenticates by token
registerDefaultDependencies(); registerRuntimeMetrics();
// start(): replace console.log/error with logger.info('server.started')/logger.error('server.start_failed',{error:err}); call recordStartupFailure('startup') on failure
// registerLifecycleHooks([foundation shutdown/forceFlush handle]); wrap exporters with instrumentExporter(...)
```
`src/routes/applicants.ts` OAuth callbacks (3 providers): in the `if (error)` branch call `recordOAuthUserDenied('<provider>')`; in the missing code/state branch call `recordOAuthValidationFailure('<provider>')`. Responses are unchanged.

## Attribute keys B emits (A's privacy allow-list must include them, otherwise they are dropped at export)
`oauth.provider, oauth.operation, oauth.outcome, oauth.attempt_bucket, oauth.recovered, oauth.state_outcome, db.system.name, db.operation.name, app.outcome`.
Runtime counter `app.runtime.startup.failures` uses attribute `category` (bounded: startup|store_init|telemetry_init|listen|other) — rename to an allow-listed key if A prefers.
