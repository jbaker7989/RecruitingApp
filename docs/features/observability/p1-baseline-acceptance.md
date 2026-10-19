# OBS-P1-S10 baseline acceptance packet

**Latest integration evidence:** [P1 delivery evidence](p1-delivery-evidence.md). Local automated gates pass; policy, performance and preview gates remain open.

**Status: NOT ACCEPTED — Proposed/Blocked.** Local synthetic implementation exists for S03–S09; hosted-preview proof, approvals (S01/S02, S07-AC1 budgets), independent reviewer and dashboard are all outstanding. This packet never marks P1 Complete while a mandatory gate is open (S10-AC4).

Revision/environment for any row below is recorded when it is run; local rows are loopback + synthetic only. Reviewer column is empty until an engineer who did not implement the slice repeats it.

## 1. Instrumentation inventory (S10-AC1)

### HTTP entrypoints (src/index.ts mount order)

| Entrypoint | Actual coverage | Unsupported / limitation | Remediation |
|---|---|---|---|
| `/health` | Excluded from traces and RED histogram by default (counted in `app.http.server.excluded_requests`); liveness unchanged | Not a latency signal | none needed |
| `/ready`, `/api/internal/telemetry-diagnostics` | New; bounded, cached, no sensitive public detail | Requires root wiring in `src/index.ts` | root wiring (see operations contract) |
| `/dashboard/*` (10 handlers, EJS, cookie auth) | Server span + RED metrics via A's middleware (**when wired**) | No per-handler child spans; no browser timing | P3-S09 |
| `/api/applicants/*` (19 handlers incl. OAuth redirect/callback) | Server span + RED; OAuth outcomes/client spans (this slice) | Redirect and callback are separate traces; link opt-in only | OBS-P1-S06 AC5 policy approval |
| `/api/auth/*` (6), `/api/mcp/*` (5) | Server span + RED | none beyond generic | — |
| `/api/jobs`, `/api/applications`, `/api/companies` (18 handlers) | Server span + RED | Store (JSON file) operations have no spans | OBS-P2-S08 |
| `/api/agents/*` (resume, matching, scheduling, JD, communication; ~24 handlers) | Server span + RED | No LLM / embedding / Pinecone / agent workflow spans | OBS-P2-S02/S03/S07/S09 |
| Unmatched paths | Bounded label `unmatched`/`other` | authenticate answers 401 before 404 | n/a |

### Outbound clients

| Client | Coverage | Limitation / remediation |
|---|---|---|
| OAuth `fetch` (Google/LinkedIn/Facebook token + userinfo) | undici client span (A) + `oauth.token_exchange` / `oauth.userinfo` semantic spans + metrics | Provider internals invisible; propagation only to allow-listed hosts (none by default) |
| ioredis (OAuth CSRF state only) | **Manual** `redis.*` spans/metrics; no keys/args/values | Native auto-instrumentation NOT enabled (needs ESM loader hook). Real Redis proof pending |
| `fetch` to Python service (`routes/agents/index.ts`, 3 call sites) | undici client span (A) | Not exercised by P1 fixtures; destination not allow-listed |
| LangChain OpenAI/Anthropic, OpenAI embeddings, Pinecone | **Not instrumented** | P2-S02/S03/S07 |
| Console logging | `oauthService.ts` migrated to structured logger; 42 `console.*` calls remain in 11 other files (`index.ts`, `middleware/auth.ts`, chains, routes, `revocationService`, vectorStore) | Migration of the rest is unscheduled follow-up; logger volume/sanitization applies only to migrated paths |

## 2. Feature AC → story → evidence (S10-AC4)

| Feature AC | Story | Local evidence | Missing for acceptance |
|---|---|---|---|
| P1-AC1 trace parenting, isolation | S03, S06 | `tests/observability-*.test.ts` (test agent), `tests/telemetry-operations.test.ts` | Real preview trace, cold/warm; Redis proof |
| P1-AC2 RED metrics | S05 | A/test agent | Backend p50/p95/p99 queries |
| P1-AC3 approvals, canaries | S01, S02, S04 | privacy tests | **Approvals not granted**; hosted payload scan |
| P1-AC4 bounded exporter failure | S07 | `scripts/obs-p1-evidence.mjs`, wrapper tests | **Budgets unapproved**; hosted overhead; Vercel forced-termination loss |
| P1-AC5 logs + health | S08, S09 | logger/readiness/runtime tests | Dashboard; authorized log search |
| P1-AC6 evidence packet | S10 | this file | independent reviewer, hosted evidence |

## 3. Story AC coverage (S06–S10)

Legend: **Local** = implemented and tested with synthetic data; **Partial**; **Pending** = needs hosted/approval/independent review. Story checkboxes stay unchecked.

| AC | State | Evidence / gap |
|---|---|---|
| S06-AC1 | Local + Pending | Semantic client spans and Redis metrics tested with stubs; real preview provider exchange and configured Redis not run |
| S06-AC2 | Local | Taxonomy: timeout, DNS, connect, TLS, 429, 5xx, invalid config, user cancel (route wiring by root), invalid state, validation |
| S06-AC3 | Local (fixture) | Attempt counter vs one logical outcome; current code has no retries so recovery is simulated |
| S06-AC4 | Local + Pending | Fallback/missing-state outcomes; real Redis outage not run |
| S06-AC5 | Partial | Opaque span-link mechanism, **default off**; policy approval pending |
| S07-AC1 | **Pending approval** | `EXPORT_BUDGET_PROPOSAL` is a proposal (`approved:false`) |
| S07-AC2 | Partial | Local flush/shutdown measured (`shutdown_ms`); Vercel cold/warm and forced termination loss not measured |
| S07-AC3 | Local | Timeout, breaker, no retry loop; fault scenarios in evidence script (requires foundation wired in `index.ts` to be meaningful — check `telemetry_wired_detected`) |
| S07-AC4 | Partial | In-process health + diagnostics; per-signal `queue_saturation: 'unmeasured'` (exporter wrapper cannot observe queue events); total queue drops ARE measured via SDK diagnostic parsing → `getTelemetryStatus().dropped.queueDroppedSpans` (can lag one batch) |
| S07-AC5 | Local + Pending | Disable/restore scenarios scripted; hosted same-load comparison pending |
| S08-AC1 | Local | Schema tested; `index.ts` startup/error paths need root wiring |
| S08-AC2 | Partial | HTTP + `runWithEntryPoint` for CLI/scheduled/replay; no CLI/scheduled/replay entrypoints exist in repo today, so none are claimed |
| S08-AC3 | Local + Pending | Request-ID in logs with tracing on/off; authorized backend search pending |
| S08-AC4 | Partial | Error text never exported, attr allow-list, burst bound; retention policy approval pending; other console logs unmigrated |
| S09-AC1 | Local | Liveness untouched; readiness cached/bounded |
| S09-AC2 | Local + Pending | Memory, event-loop, concurrency, cold start, exporter freshness; unsupported marked `unavailable`; platform metrics pending |
| S09-AC3 | Pending | Dashboard does not exist; no backend approved |
| S09-AC4 | Local | Not-ready / degraded / stale fixtures; no durability claim |
| S10-AC1 | Local | Section 1 |
| S10-AC2 | Pending | Needs hosted backend |
| S10-AC3 | Partial | Local checks only; no preview revision/traffic/reviewer |
| S10-AC4 | Local | Section 2; phase remains Proposed/Blocked |
