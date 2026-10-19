# Observability P1 test coverage

**Status:** Verification in progress; no production or hosted acceptance is implied.
**Scope:** Synthetic localhost fixtures only, no paid services. Root owns integrated checks, CI, deployment and final acceptance.
**Latest integrated result (2026-10-19):** 295 tests pass, 0 fail/skip; typecheck, lint, build and built-artifact smoke pass. Both forbidden metric keys and invalid values are sanitized BEFORE SDK aggregation. Historical RED evidence below is retained as regression provenance, not current failure status. Local Jaeger/Prometheus/Loki queries passed for a unique synthetic run. See [integration evidence](p1-delivery-evidence.md) for remaining gates.

**Traceability:** All 44 acceptance criteria from the original ten P1 stories appear below. A row states required verification, not an assertion that it passed.

## Prioritized verification stories

[T01 privacy](../../stories/observability/testing/story-obs-p1-t01-privacy-boundaries.md) (P0), [T02 HTTP/context/metrics](../../stories/observability/testing/story-obs-p1-t02-request-metrics-context.md) (P0), [T03 exporter reliability](../../stories/observability/testing/story-obs-p1-t03-export-reliability.md) (P0), [T04 operations/dependencies](../../stories/observability/testing/story-obs-p1-t04-dependencies-runtime-logs.md) (P1), [T05 decisions/hosted acceptance](../../stories/observability/testing/story-obs-p1-t05-hosted-decisions-acceptance.md) (P0).

## Per-criterion verification ledger

| Acceptance criterion | Verification type | Required check/evidence | Current state |
|---|---|---|---|
| OBS-P1-S01-AC1 | Decision | ADR plan/region/signals/transport/RBAC/quotas and named ownership | Approval/hosted gate pending |
| OBS-P1-S01-AC2 | Manual local backend | Synthetic trace, histogram and structured-log queries in the proposed destination; reproduce independently. Local backend proof is valid evidence independently of production approval. | Root reports local Jaeger/Prometheus/Loki query proof; independent query artifact/reviewer pending |
| OBS-P1-S01-AC3 | Decision | Expected/10x volume and all cost components, approved cap/warnings | Approval/hosted gate pending |
| OBS-P1-S01-AC4 | Decision | Destination/funding/provisioning/fallback/review-date approval; export blocked meanwhile | Approval/hosted gate pending |
| OBS-P1-S02-AC1 | Decision + automated | Approve allow-list; T01 adversarial payload tests validate proposed implementation | Approval/hosted gate pending |
| OBS-P1-S02-AC2 | Decision + manual hosted | Approve retention/deletion/region/RBAC; verify configured expiry and denied access | Approval/hosted gate pending |
| OBS-P1-S02-AC3 | Decision + automated | Approve identifier/header policy; T01 context/metric-cardinality tests | Policy pending; metric-cardinality regression fails (100 duplicate points) |
| OBS-P1-S02-AC4 | Decision + automated + manual hosted | Checklist, canary tests and hosted access/retention checks; real-data gate remains closed | Approval/hosted gate pending |
| OBS-P1-S03-AC1 | Automated + manual hosted | T02 import/init and compiled startup; actual preview entrypoint and package inventory | Local SDK/bootstrap checks pass; compiled and preview entrypoint proof pending |
| OBS-P1-S03-AC2 | Automated + manual hosted | T02 emitted server span/resource/template and real child context; preview trace | Local server/resource/child span checks pass; preview trace pending |
| OBS-P1-S03-AC3 | Automated + manual hosted | T02 interleaved requests/import lifecycle; cold/warm Vercel isolation | Local concurrency/init checks pass; cold/warm preview pending |
| OBS-P1-S03-AC4 | Automated | T03 invalid/missing config, bounded diagnostics and shutdown/flush | Local invalid-config/flush tests pass |
| OBS-P1-S04-AC1 | Automated + decision | T01 span/log/metric filtering, lengths and controlled categories; schema approval pending | Local filter tests pass, but metric-cardinality regression fails; schema approval pending |
| OBS-P1-S04-AC2 | Automated + manual hosted | T01 canary success/failure captured payloads/diagnostics; hosted payload query | Local canary payload tests pass; hosted scan pending |
| OBS-P1-S04-AC3 | Automated + decision | T01 malformed context/request ID/size and sampling/cardinality attacks; trust approval | Context/sampling tests pass; metric-cardinality regression fails; trust approval pending |
| OBS-P1-S04-AC4 | Automated + decision | T01 actual outgoing headers at allowed/denied destinations; boundary policy approval | Local allow/deny header capture passes; policy approval pending |
| OBS-P1-S04-AC5 | Automated | T01 raw exception message/stack/model-output canary in SDK exception event | Local exception payload tests pass |
| OBS-P1-S05-AC1 | Automated | T02 real HTTP success/rejection/error/disconnect; exact-once duration/count | Local mixed-request and disconnect counts pass |
| OBS-P1-S05-AC2 | Automated | T02 100 distinct IDs/unknown paths; bounded method/route/outcome/env/feature | Local 100-ID HTTP route fixture passes; direct metric cardinality gap tracked under S04 |
| OBS-P1-S05-AC3 | Automated + manual hosted | T02 exact count/error/histogram manifest; backend p50/p95/p99/rate queries | Local exact totals pass; backend percentile/rate query evidence pending |
| OBS-P1-S05-AC4 | Automated + manual review | T02 zero trace sampling; documented health/static/synthetic/auth/validation eligibility | Local zero-sampling and exclusion fixtures pass |
| OBS-P1-S05-AC5 | Manual hosted | Dashboard duration label; distinguish genuine empty traffic from missing pipeline | Approval/hosted gate pending |
| OBS-P1-S06-AC1 | Automated + manual hosted | T04 token/userinfo safe child spans; real configured Redis duration/outcome | Local child spans pass; configured Redis/provider preview pending |
| OBS-P1-S06-AC2 | Automated | T04 timeout/DNS/connect/TLS/429/5xx/config/cancel/state/validation taxonomy | Local taxonomy and actual callback denial tests pass |
| OBS-P1-S06-AC3 | Automated | T04 attempt counts versus logical login outcome; recovered failure fixture | Local attempt/login counters pass; retry recovery is a fixture |
| OBS-P1-S06-AC4 | Automated + manual hosted | T04 Redis unavailable/fallback and state expired/missing; configured Redis proof | Local missing-state/fallback evidence partial; real Redis outage pending |
| OBS-P1-S06-AC5 | Automated + decision | T04 separate redirect/callback traces; approved opaque links only, no state/token | Local opt-in and default-off emitted-link fixtures pass; policy approval pending |
| OBS-P1-S07-AC1 | Decision + measurement | Approve numerical latency/queue/timeout/retry/loss/overhead budgets and workload | Approval/hosted gate pending |
| OBS-P1-S07-AC2 | Automated + manual hosted | T03 flush/shutdown/error; actual Vercel cold/warm short invocation and forced loss | Local flush/shutdown tests pass; short-lived Vercel/loss measurement pending |
| OBS-P1-S07-AC3 | Automated + manual hosted | T03 failure/timeout/auth/throttle/network fault injection; approved hosted overhead | Local OTLP 401/429/503/hang and breaker tests pass; approved overhead pending |
| OBS-P1-S07-AC4 | Automated + manual hosted | T03 bounded failure/drop/saturation/freshness diagnostics independent of failing exporter | Local SDK queue-drop count and exporter-failure separation pass; hosted diagnostic proof pending |
| OBS-P1-S07-AC5 | Automated + manual hosted | T03 disable/recover; same-load hosted p95/throughput/memory/completeness comparison | Local recovery passes; same-load hosted comparison pending |
| OBS-P1-S08-AC1 | Automated + manual hosted | T04 stable event schema/context on request/error/startup; backend retrieval | Local schema/startup/request tests pass; hosted retrieval pending |
| OBS-P1-S08-AC2 | Automated | T04 origin propagation, startup without span; only implemented entrypoints claimed | Local startup and HTTP origin tests pass; no other runtime entrypoints claimed |
| OBS-P1-S08-AC3 | Automated + manual hosted | T04 logs with unsampled/no trace; authorized request-ID search | Local no-trace request-ID log tests pass; authorized search pending |
| OBS-P1-S08-AC4 | Automated + decision + manual review | T01/T04 safe exception/volume/levels; approved retention, migrated console inventory | Local sanitization/burst tests pass; retention and full console inventory pending |
| OBS-P1-S09-AC1 | Automated | T04 liveness no paid/network calls; readiness required/optional cached checks | Local liveness/readiness tests pass |
| OBS-P1-S09-AC2 | Automated + manual hosted | T04 process sample/concurrency/freshness; supported platform metrics versus unavailable | Local gauges/unavailable/freshness tests pass; platform proof pending |
| OBS-P1-S09-AC3 | Manual hosted | Environment/release dashboard; app/dependency/export failure and no-data states | Approval/hosted gate pending |
| OBS-P1-S09-AC4 | Automated + manual hosted | T04 required failure/optional degradation/stale exporter; no durability claim | Local failure/degradation/stale fixtures pass; hosted proof pending |
| OBS-P1-S10-AC1 | Manual review | Enumerate every route/outbound client, actual integration and remediation links | Inventory documented; independent review pending |
| OBS-P1-S10-AC2 | Manual hosted | Backend request/provider/Redis, histogram/error queries, logs, health and release filter | Approval/hosted gate pending |
| OBS-P1-S10-AC3 | Automated + manual hosted | T01–T04 local checks plus actual preview overhead/revision/counts/query/reviewer | Local full suite passes 295/295; preview load/reviewer pending |
| OBS-P1-S10-AC4 | Manual + decision | Feature AC links and mandatory open gates; never mark P1 Complete while blocked | Ledger maintained; mandatory gates remain open |

## Fixture and assertion contract

- Every payload value is synthetic. Sensitive marker strings exist only in test fixtures; assert they never reach exported span names/attributes/events/links/resources, metric attributes, log output or diagnostics.
- Use real official OTel providers/processors/readers/exporters. Capture the export boundary and serve protocol faults on localhost. Do not substitute a custom telemetry engine or assert source strings.
- Each suite owns its providers, listeners and injected boundary state and restores environment changes. Use dynamic imports where bootstrap order matters. No external provider requests or applicant stores.
- HTTP manifest includes success, expected 4xx, handled 5xx, thrown error, abort/disconnect, unknown route and repeated finish/close; report exact eligible counts. Sampling zero must still produce full-population metrics.
- Cardinality fixture varies at least 100 raw route IDs and unknown paths; bounded route/outcome/method labels must retain one normalized series per intended dimension.
- Concurrency fixture interleaves request/dependency/log operations and compares emitted parent/request IDs. Parent policy must not allow an arbitrary public traceparent to force sampling.
- Export fixtures inject throw, timeout, auth/throttle/network failure, overflow and recovery; numerical test timeouts do not constitute approved operational budgets.

## Evidence and open gates

Local evidence (2026-10-19; shared uncommitted `feature/observability-p1`, synthetic localhost only):

| Command / artifact | Observed result | Limit |
|---|---|---|
| `node --import tsx --test tests/observability*.test.ts` before the new cardinality assertion | **55 pass, 0 fail, 0 skip** | Exercises actual official SDK spans, metrics, OTLP/HTTP loopback failures and route callbacks; does not approve policy or prove hosted delivery |
| `node --import tsx --test tests/observability*.test.ts` after the cardinality and default-off link assertions | **56 pass, 1 fail, 0 skip** (57 tests) | Single failure is the 100-duplicate-point cardinality regression; no cases bypassed |
| `node --import tsx --test tests/observability-privacy.test.ts` after the new assertion | **5 pass, 1 fail, 0 skip** | 100 distinct forbidden `app.request.id` labels become 100 indistinguishable exported points instead of one point with value 100 |
| `node_modules/.bin/eslint tests/observability*.test.ts`; `git diff --check` | **0 lint errors/warnings; 0 whitespace errors** | Assigned test files and working-tree diff only |
| SDK batch queue / flush regression assertions | Queue drops equal `100 - delivered`; exporter failures remain 0 in that fixture; a failed export makes `forceFlushTelemetry()` return `false` | Queue diagnostic appears on the next accepted span after capacity recovers; no hosted loss measurement |
| Local Jaeger/Prometheus/Loki query proof | Reported by root; independent query artifact/reviewer not yet available to this test audit | Does not establish an approved hosted destination |

The focused runner currently has **one known failing acceptance test**. Do not report it green or bypass the assertion. Root owns the full integrated `npm test`, build/typecheck/lint, preview and workflow **Observability P1 CI**; no fresh full-suite result is claimed here. The five testing stories cover all 44 P1 story criteria, but coverage means a verification path exists, not that each criterion is accepted.

S01/S02 destination, cost, data policy, retention, residency and access decisions still require named approval. Numerical test timeouts are fixture bounds, not approved operational budgets. Actual Vercel cold/warm behavior, platform metrics, configured Redis/provider exchange, hosted overhead/loss, authorized log search, dashboards and an independent reviewer remain open. NFR-034 audit durability is outside P1 and unresolved.

## Feature acceptance links

| Feature criterion | Story evidence | Remaining gate |
|---|---|---|
| OBS-001-P1-AC1 | S03/S06; T02/T04 | Real preview parenting and cold/warm isolation |
| OBS-001-P1-AC2 | S05; T02 | Backend full-population rate/error/percentile query |
| OBS-001-P1-AC3 | S01/S02/S04; T01/T05 | Approved destination, policy and hosted canary review |
| OBS-001-P1-AC4 | S07; T03 | Approved budgets and actual preview fault/load report |
| OBS-001-P1-AC5 | S08/S09; T04 | Authorized log search and runtime dashboard |
| OBS-001-P1-AC6 | S10; T05 | Inventory, reproducible evidence and independent reviewer |

## Actionable verification gaps

- **Required production fix:** `SanitizingMetricExporter` drops forbidden metric attributes after SDK aggregation. A counter called 100 times with distinct `app.request.id` values exports 100 points with identical safe labels and value 1, violating the bounded-cardinality requirement. Filter unsafe labels before metric SDK aggregation (or safely coalesce compatible points at the export boundary) and retain the failing SDK payload assertion. The foundation owner owns `src/telemetry/privacy.ts`.
- OAuth correlation links are locally verified both default-off and synthetic opt-in. Policy approval remains required before enabling links beyond isolated fixtures.
- Real Redis outage/TTL, provider exchange, Vercel short-invocation delivery, and hosted same-load overhead require separate evidence; localhost stubs cannot close them.
- S01/S02 policy and budget rows remain unresolved until named approval. Root's local backend query proof still needs an independent artifact/reviewer to close S01-AC2.

## Critical Preview configuration follow-up

OBS-P1-S11 adds six hosted configuration criteria beyond the original 44-AC implementation ledger. All remain pending.

| Criterion | Verification | Status |
|---|---|---|
| OBS-P1-S11-AC1 | Administrator confirms distinct strong Preview secrets and branch scope without values | Blocked |
| OBS-P1-S11-AC2 | Redeploy revision, validate startup and HTTPS APP_BASE_URL | Blocked |
| OBS-P1-S11-AC3 | Hosted health, synthetic session and unauthorized-route checks | Blocked |
| OBS-P1-S11-AC4 | Hosted readiness, authorized diagnostics and unavailable-collector behavior | Blocked |
| OBS-P1-S11-AC5 | Named owner, replacement/rollback and environment isolation review | Pending |
| OBS-P1-S11-AC6 | Sanitized evidence linked; independent acceptance gates retained | Pending |
