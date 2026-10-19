# P1 operations runbook (local, synthetic)

**Status:** Local operational guide for OBS-P1-S06–S09. No hosted backend, owner, retention, or budget is approved; nothing here is production policy.

## Signals at a glance

| Question | Where to look | Notes |
|---|---|---|
| Is the process alive? | `GET /health` | Unchanged, cheap, no dependency calls. |
| Is it ready? | `GET /ready` (200 `ready`/`degraded`, 503 `not_ready`) | Public summary: dependency name, `required`, `up|degraded|down` only. Required = `store` (data dir readable; **not** a durability claim, NFR-034 open). Optional = `oauth_state_store` (memory fallback ⇒ degraded), `telemetry_export` (stale/breaker ⇒ degraded). |
| Resource pressure / exporter health? | `GET /api/internal/telemetry-diagnostics` | 404 unless `TELEMETRY_DIAGNOSTICS_TOKEN` is set and sent as `Authorization: Bearer`. Runtime memory, event-loop delay, concurrency, cold start, per-signal export state, `unavailable[]` list. |
| Why did request X fail? | Structured logs, search `request_id` (= `x-request-id` response header) | `event`, `level`, `outcome`, `category`, `entry_point`, `environment`, `release`, optional `trace_id/span_id` (absent when tracing off/unsampled). |
| Is login failing in our code, token exchange, userinfo, or state storage? | `app.oauth.login.outcomes`, `app.oauth.client.attempts{oauth.operation,oauth.outcome}`, `app.oauth.state.outcomes`, spans `oauth.token_exchange` / `oauth.userinfo` / `redis.*` | One logical outcome per callback; every outbound attempt counted separately; `oauth.recovered=true` = success after a failed attempt. |

## Distinguishing failures

- **Application failure:** `app.http.server` 5xx rate up, `/ready` ready, export `fresh`.
- **Dependency degradation:** `/ready` = `degraded` (e.g. `oauth_state_store` memory fallback), request error rate may be normal.
- **Telemetry outage:** `telemetry_export` state `stale`/`never`, `breaker_open: true`, `telemetry.export.failed` logs. App traffic is unaffected by design (fail-open). A dashboard must show *no data* distinctly from zero; per-signal `queue_saturation: 'unmeasured'` in `getExportHealth()` because the exporter wrapper cannot observe SDK batch-queue drops. Total queue drops ARE captured separately: the SDK emits a fixed warning "Dropped N spans because maxQueueSize reached" which `createSafeDiagLogger` (privacy.ts) parses and accumulates in `counters.queueDroppedSpans`; this is exposed via `getTelemetryStatus().dropped.queueDroppedSpans` (can lag up to one batch interval).
- **Disabled by operator:** `OTEL_SDK_DISABLED=true` or `TELEMETRY_ENABLED=false` ⇒ state `disabled`, never "healthy".

## Rollback / disable / restore

1. Disable: set `TELEMETRY_ENABLED=false` (and/or `OTEL_SDK_DISABLED=true`) and redeploy/restart. OTel API reverts to no-op; routes, logs, `/ready` keep working.
2. Restore: set `TELEMETRY_ENABLED=true` with a valid endpoint; confirm `telemetry_export` becomes `fresh` within `TELEMETRY_STALE_AFTER_MS` (default 120000 ms) of the first export.
3. Logging-only: `LOG_LEVEL=warn|error`; burst bound `LOG_EVENT_BURST` (default 50 per event per 10 s).
4. OAuth trace links: opt-in `OBS_OAUTH_SPAN_LINKS=true` (default off pending policy approval).

## Reproducing the local evidence

```bash
npm test -- --test-name-pattern "S0[6-9]|telemetry"      # focused behaviour tests
node scripts/obs-p1-evidence.mjs --requests 600 --concurrency 20 --out tasks/obs-p1-evidence-local.json
```
The script runs seven short-lived loopback scenarios (disabled baseline, enabled + OK sink, sink 500 / hang / connection drop, unreachable backend, restore) and reports p50/p95/p99, throughput, RSS, shutdown time, status parity versus the disabled baseline and sink receipt counts. Budgets inside are **proposed and unapproved**. Re-run on the Vercel preview by pointing a load tool at the preview URL and comparing against a `TELEMETRY_ENABLED=false` preview; that hosted comparison is **pending** (needs root deployment).

## Known limits

- Express layers and ioredis are not natively auto-instrumented; Redis spans are manual (`redis.setex|getdel|connect`). Only the OAuth CSRF state store uses Redis.
- Outbound `fetch` client spans come from `instrumentation-undici` (A); OAuth operations add semantic child spans.
- The OAuth current code has no retries; recovered-attempt visibility is proven with fixtures that simulate a retry, not with production behaviour.
- Platform metrics (CPU throttling, platform concurrency limit, memory limit without cgroup data) are listed as `unavailable`.
- In-memory OAuth state entries are only expired by a 60 s sweep, so a state slightly older than 10 minutes can still validate (pre-existing behaviour, deliberately not changed here).
