# Review: OBS-001 OpenTelemetry integration proposal

**Reviewed:** 2026-10-18
**Disposition:** Sound direction; original scope and acceptance were insufficient for operational readiness. Expanded into [three features](README.md) and 33 prioritized stories. No implementation, vendor approval or production-readiness claim is made.

## Evidence and confirmed requirements

The user confirmed login/OAuth, application submission, resume parsing/matching and agent workflows as initial critical journeys; all three external-visibility categories are required: provider calls, independent uptime/browser monitoring, and customer status. Unknown budgets/platform/data policy/owners and numerical targets become gated decision stories. Priorities are required on all stories.

Repository evidence inspected:

- [package.json](../../../package.json): Node 24, ESM, Express 5, LangChain providers, Pinecone and ioredis; no declared OTel dependency. Build is TypeScript; test runner is `tsx --test`.
- [src/index.ts](../../../src/index.ts): exported Express app, direct-execution startup guard, public `/health`, route mounts and module imports before application startup. A Next.js-style discovery assumption would be unsafe.
- [src/models/store.ts](../../../src/models/store.ts): audit records are read from `{ logs: [...] }`, appended and rewritten; this is not a transactional durable audit backend. The original document described the physical shape too loosely as an array.
- [src/services/oauthService.ts](../../../src/services/oauthService.ts): fetch token/userinfo operations, Redis initialization and in-memory fallback. Redirect/callback and fallback paths need explicit journey semantics.
- [src/chains/resumeParsing.ts](../../../src/chains/resumeParsing.ts): model invocation followed by parsing/schema validation; a parsing error embeds raw model content. Exception telemetry needs explicit sanitization.
- [src/chains/matching.ts](../../../src/chains/matching.ts): semantic similarity failure is caught and falls back to zero while overall work can continue; HTTP success alone misses degradation.
- [src/services/llm/index.ts](../../../src/services/llm/index.ts): chat task routing and a separate actual embedding model; usage/model attribution must follow real calls rather than assume task configuration is sufficient.
- [src/services/vectorStore/pinecone.ts](../../../src/services/vectorStore/pinecone.ts): query/fetch/upsert and embedding-related paths; safe operation metadata is needed without vectors or candidate records.
- [src/agents/scheduling/agent.ts](../../../src/agents/scheduling/agent.ts): a custom state machine, with simulated calendar/invite behavior. LangGraph is installed but this file is not a LangGraph graph.
- [BUGS.md](../../../BUGS.md): NFR-034 remains a production mutation persistence blocker. The referenced `docs/features/security/feature-oauth-security-hardening.md` is absent in this checkout.

## Findings and required remediation

| ID / severity | Finding and consequence | Resolution / stories |
|---|---|---|
| R01 / Critical | Privacy only appeared in P3; auto spans and raw exceptions could export applicant data during P1. Parsing exceptions already contain model output. | Move policy and filtering to P1 before export; retain P3 governance verification. OBS-P1-S02/S04; OBS-P3-S05. |
| R02 / High | P1 promised p95/error-rate without an explicit metrics pipeline or denominator. Sampled trace-derived counts can misrepresent failures. | Full-population request metrics with route normalization, histogram units, outcome policy and no-data behavior. OBS-P1-S05. |
| R03 / High | SDK selection and a minimal filename were presented as sufficient for runtime initialization/flush. Express ESM loading and serverless delivery need proof. | Compatibility spike plus cold/warm/concurrency/export-failure/overhead evidence. OBS-P1-S03/S07/S10. |
| R04 / High | Automatic coverage for every dependency and every request was overstated; sampling further limits retained traces. | Coverage inventory and actual call fixtures; propagate only across approved boundaries; report missing coverage. OBS-P1-S03/S06/S10; OBS-P2-S01. |
| R05 / High | Every audit ID was expected to open a trace, even when unsampled, dropped or expired. | Conditional retained-trace lookup with authorized fallback; sampling decision states retention limits. OBS-P3-S01/S04. |
| R06 / High | Token usage was conflated with cost; missing usage became zero, and the snippet failed to end spans on exceptions. | Remove unsafe snippets; normalize reported usage, unknown coverage and dated pricing; prove finally-equivalent span completion. OBS-P2-S02–S06. |
| R07 / High | SLOs lacked approved values, eligible-event rules, windows, routing and responsible humans. | Separate objective and ownership decisions; tested alerts/runbooks and no-data rules. OBS-P3-S02/S03/S06. |
| R08 / High | External visibility only covered outbound calls. That cannot establish real browser reachability or inform customers. | Required independent probes/browser journeys and independent customer status; RUM remains conditional on policy. OBS-P3-S07–S10. |
| R09 / High | JSON audit storage was drawn as durable while NFR-034 remained open. | Separate storage timing from durability; keep production mutation and durable-audit gates explicit. OBS-P2-S08; OBS-P3-S01/S08/S13. |
| R10 / Medium | Installed LangGraph was mistaken for actual scheduling implementation; illustrative trace mixed unverified calls. | Map actual state-machine and chain paths; label simulations and forbid invented spans. OBS-P2-S01/S09/S10. |
| R11 / Medium | No structured operational log story, runtime resource/freshness signals or monitoring of export failure. | Add logs, runtime/readiness and independent telemetry-failure detection. OBS-P1-S07–S09; OBS-P3-S08. |
| R12 / Medium | Caught fallbacks, retries, partial batches and waiting time could look successful or inflate durations. | Logical-operation/attempt contract, degraded outcomes and non-overlapping duration interpretation. OBS-P2-S01/S07–S10. |
| R13 / Medium | Backend portability was described as configuration-only and plan capabilities assumed. | Evaluate signal support, querying, alerts, entitlements and migration cost using a proof. OBS-P1-S01. |
| R14 / Medium | No cost, retention, residency, named ownership or future-capability decision closure. | D01–D15 have owner roles and affected gates; actual names/values required to close. OBS-P1-S01/S02; OBS-P2-S05; OBS-P3-S02–S04/S07/S12. |
| R15 / Medium | “2–3 engineering days” did not account for decisions, custom instrumentation, external probes, customer status or drills. | Withdraw commitment and size stories after spikes; distinguish engineering effort from external lead time. All three features. |
| R16 / Medium | No proof that a release regression is diagnosable or incident process works end to end. | Release comparison with low-data handling and a controlled incident game day. OBS-P3-S11/S13. |

## Technical references checked

These references inform the review; they do not prove compatibility in this deployed application or approve a vendor:

- [Vercel instrumentation documentation](https://vercel.com/docs/tracing/instrumentation): configuration and propagation require deliberate integration; validate the actual entrypoint instead of treating the illustrative snippet as sufficient.
- [OpenTelemetry Node.js guidance](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/): initialize instrumentation appropriately for the runtime and configure the signal pipelines needed by the acceptance criteria.
- [OpenTelemetry sampling concepts](https://opentelemetry.io/docs/concepts/sampling/): head/tail policies have different tradeoffs; a downstream policy cannot reconstruct spans discarded upstream.

No current vendor price, entitlement or numerical SLO is asserted. Those remain decision-story outputs.

## Acceptance coverage and residual questions

The [backlog index](README.md#operational-question-coverage) maps operational questions to stories. Each feature maps original and expanded acceptance criteria to story IDs; each story defines independently identifiable ACs, dependencies, priority, release gate and verification evidence.

D01–D15 are **Open**. This review cannot establish a budget, legal/data policy, named on-call ownership, runtime behavior or production thresholds without further evidence and decisions. Synthetic development proceeds where independent; gated deployment does not. Future-capability decisions explicitly cover queues/jobs/replays/webhooks, durable storage, live notifications/calendars, AI streaming/quality, profiling, tenant costs, subscriptions, disaster recovery and security anomalies. Adoption creates concrete follow-on stories before shipment.
