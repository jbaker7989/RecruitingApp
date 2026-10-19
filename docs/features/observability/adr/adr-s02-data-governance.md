# ADR OBS-P1-S02: Telemetry data policy — PROPOSED DEFAULTS, NOT APPROVED

**Status:** Proposed. **No approver, retention period, region or role assignment exists.** Only isolated synthetic development data is allowed; production/applicant data must not enter telemetry. This is an engineering proposal, not a statement of legal compliance.
**Accountable roles (assignee pending):** security/privacy owner + platform lead.

## Proposed field allow-list (enforced in code; `src/telemetry/privacy.ts`)

Enforcement is at the exporter boundary for every signal (spans, links, events, scope, resource, metrics), including auto-instrumentation output. Anything not listed is dropped; listed keys additionally have value validators (bounded enum / charset / integer range).

| Class | Allowed (examples) | Signals |
|---|---|---|
| Service identity | `service.name`, `service.version` (release), `deployment.environment.name`, `telemetry.sdk.*` | resource |
| HTTP | method (enum), `http.route` **template only**, status code, status class, `url.scheme`, `server.address`/port (outbound host only) | span (+ method/route/class on metrics) |
| Outcome | `app.outcome`, `error.type` (controlled categories), `app.feature`, `app.traffic`, `app.environment` | span + metric |
| Request id | `app.request.id` (opaque, `^[A-Za-z0-9_-]{8,64}$`) | **span only — never a metric label** |
| Dependencies | `db.system.name`/`db.operation.name` (Redis op name only), `oauth.provider/operation/outcome/attempt_bucket/recovered/state_outcome` | span + metric |

Names are exact-match too: span names (`METHOD route-template`, `oauth.*`, `redis.<op>`), event names (none allowed by default — all events dropped), instrumentation scope names, and metric names. `tracestate`, baggage and scope versions other than numeric semver are dropped.

## Proposed prohibited content (tested with canaries)

Resumes and applicant fields; prompts/completions/model output; emails; credentials, cookies, bearer/JWT/API keys; OAuth `code`/`state`; query strings and raw URLs/paths with ids; Redis keys/values; exception messages and stack traces (exceptions are recorded as a category only; `span.recordException` is never used by our code and exception events are stripped on export); span status messages; user-agent; headers.

## Identifiers and propagation (proposal)

- `x-request-id`: accepted only if opaque `^[A-Za-z0-9_-]{8,64}$`, else minted (96-bit hex); returned in the response header.
- Trace ids: inbound `traceparent` ignored unless `TELEMETRY_TRUST_INBOUND_TRACE=true`; then it must be well-formed, ≤ 55 chars; a trusted parent cannot raise sampling above the configured ratio. `tracestate` and baggage are never read or forwarded.
- Outbound: `traceparent` only to `TELEMETRY_PROPAGATION_ALLOWLIST` destinations; no baggage propagator is registered; client spans exist for every destination regardless.
- No applicant identifier or pseudonym is permitted in metric labels. No pseudonymous lookup is proposed for P1.

## Values that REQUIRE a human decision (all open)

| Item (AC2) | Status |
|---|---|
| Retention & deletion period per signal (traces / metrics / logs) | _open — no default proposed as numbers_ |
| Export region, backup/subprocessor boundary | _open_ (depends on S01) |
| Permitted environments for real data | proposal: none; synthetic only (`TELEMETRY_ENVIRONMENT` ∈ local/preview) |
| RBAC read/admin roles, named approver, access auditing | _open_ |
| Incident/deletion handling | _open_ |

## Verification checklist (AC4) — what exists now

| Check | Status |
|---|---|
| PII canary test across spans/metrics/links/scope/resource/events/exporter diagnostics | automated (`tests/observability-privacy.test.ts`, `tests/telemetry-foundation.test.ts`) |
| Metric-label identifier prohibition | automated |
| Access denial test | pending backend selection |
| Retention-expiry test | pending retention decision |
| Production export block | enforced by default-off + loopback-only unless `TELEMETRY_ALLOW_REMOTE_EXPORT=true` |
