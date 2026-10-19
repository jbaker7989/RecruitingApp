# OBS-001-P2: AI, custom spans, usage and duration attribution

**Status:** Proposed — detailed backlog, not implemented
**Created:** 2026-10-18 | **Parent initiative:** [OBS-001](feature-opentelemetry-integration.md)
**Accountability:** Engineering delivery; Product approves objectives; Platform/Operations owns acceptance. Named assignments are decision-story outputs.
**Priority:** Required initiative phase; individual stories carry P0/P1/P2 priority and gate rationale.

## Objective and scope

Explain where critical-journey time goes, which custom operation failed or degraded, and how much known AI usage/cost each feature produces.

Actual chat and embedding calls, Pinecone operations, JSON/audit-store timing, scheduling state-machine steps, caught fallback/partial success, token accounting and estimated-cost reporting. The user-confirmed journeys are login/OAuth, application submission, resume parsing/matching and agent workflows.

## Architecture and signal flow

```text
Critical journey → logical operation → model / embedding / vector / store / step spans
                            ↓ attempt outcomes + duration + known usage
                       normalized metrics → cost calculation → diagnostic dashboards
```

Backend/transport implementation remains a decision with proof requirements. This feature specifies behavior rather than assuming package defaults or a vendor plan.

## Feature acceptance criteria and story traceability

- [ ] **OBS-001-P2-AC1:** Accepted journey maps define operation boundaries, attempts, active versus wait time, outcomes and real paths; illustrative diagrams cannot invent dependencies.
  Evidence supplied by: [OBS-P2-S01](../../stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md).

- [ ] **OBS-001-P2-AC2:** Actual chat/embedding operations expose correct duration, parentage, provider/model and sanitized outcome, including timeout, cancellation, retry and application validation failure.
  Evidence supplied by: [OBS-P2-S02](../../stories/observability/story-obs-p2-s02-llm-spans.md), [OBS-P2-S03](../../stories/observability/story-obs-p2-s03-embedding-usage.md).

- [ ] **OBS-001-P2-AC3:** Resume parsing/matching fixtures collectively show distinct real LLM/embedding, Pinecone and store spans with durations; caught fallback and partial failure remain visible.
  Evidence supplied by: [OBS-P2-S07](../../stories/observability/story-obs-p2-s07-pinecone-spans.md), [OBS-P2-S08](../../stories/observability/story-obs-p2-s08-store-spans.md), [OBS-P2-S09](../../stories/observability/story-obs-p2-s09-agent-workflow-spans.md), [OBS-P2-S10](../../stories/observability/story-obs-p2-s10-duration-investigation.md).

- [ ] **OBS-001-P2-AC4:** Token metrics are queryable by bounded feature/route mapping, independent of trace sampling, with exact fixture accounting and explicit unknown-usage coverage.
  Evidence supplied by: [OBS-P2-S04](../../stories/observability/story-obs-p2-s04-token-accounting.md).

- [ ] **OBS-001-P2-AC5:** Estimated cost is queryable by feature/time using approved versioned prices and allocation rules; unknown price/usage, reconciliation variance and cost coverage are visible.
  Evidence supplied by: [OBS-P2-S05](../../stories/observability/story-obs-p2-s05-cost-policy-decision.md), [OBS-P2-S06](../../stories/observability/story-obs-p2-s06-cost-dashboard.md).

- [ ] **OBS-001-P2-AC6:** Workflow execution/step timing and outcomes distinguish live versus simulated work, retries, waiting and terminal outcomes without exposing candidate data.
  Evidence supplied by: [OBS-P2-S09](../../stories/observability/story-obs-p2-s09-agent-workflow-spans.md).

- [ ] **OBS-001-P2-AC7:** An independent engineer can identify injected bottlenecks/failures from saved dashboards/traces/logs, interpret overlapping spans correctly and reproduce the phase evidence.
  Evidence supplied by: [OBS-P2-S10](../../stories/observability/story-obs-p2-s10-duration-investigation.md).

## Prioritized stories

| Story | Priority | Type | Release gate |
|---|---|---|---|
| [OBS-P2-S01](../../stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md): Map critical journeys and duration semantics | P1 | Decision / spike | Before P2 wrappers are accepted |
| [OBS-P2-S02](../../stories/observability/story-obs-p2-s02-llm-spans.md): Trace chat/model invocations and failures | P1 | Implementation | P2 AI coverage |
| [OBS-P2-S03](../../stories/observability/story-obs-p2-s03-embedding-usage.md): Observe embedding operations | P1 | Implementation | P2 embedding coverage |
| [OBS-P2-S04](../../stories/observability/story-obs-p2-s04-token-accounting.md): Measure token usage without false precision | P1 | Implementation | P2 usage acceptance |
| [OBS-P2-S05](../../stories/observability/story-obs-p2-s05-cost-policy-decision.md): Approve estimated-cost attribution and budgets | P1 | Decision | Before cost dashboard is represented as reliable |
| [OBS-P2-S06](../../stories/observability/story-obs-p2-s06-cost-dashboard.md): Publish feature usage and estimated-cost reports | P1 | Implementation | P2 cost visibility |
| [OBS-P2-S07](../../stories/observability/story-obs-p2-s07-pinecone-spans.md): Measure vector-store operations | P1 | Implementation | P2 vector coverage |
| [OBS-P2-S08](../../stories/observability/story-obs-p2-s08-store-spans.md): Expose store and audit-write latency | P1 | Implementation | P2 storage coverage |
| [OBS-P2-S09](../../stories/observability/story-obs-p2-s09-agent-workflow-spans.md): Observe agent steps and business outcomes | P1 | Implementation | P2 agent coverage |
| [OBS-P2-S10](../../stories/observability/story-obs-p2-s10-duration-investigation.md): Deliver end-to-end duration and dependency investigation | P1 | Verification / dashboard | P2 exit |

## Delivery order and dependencies

After P1, S01 defines semantics; S02/S03 enable S04, then S05/S06 cost delivery. S07/S08 provide vector/store coverage; S09 completes workflow outcomes; S10 accepts the integrated result.

Priorities do not override prerequisites. Independent later-phase decision stories may be resolved early. Local/synthetic development can proceed while business approval is outstanding, but the affected release gate cannot close. NFR-034 independently blocks production mutation traffic and durable audit acceptance; no phase's telemetry evidence removes that blocker.

## API and configuration impact

Bounded operation/feature/provider/model vocabulary; supported usage categories; effective-date price catalog/currency; approved budget thresholds; safe workflow/run-context policy. No business scoring weights, model routing, retry policy or scheduling semantics are changed by instrumentation.

Existing application APIs retain their business contracts. Any added readiness/status integration must document its authentication and response contract in its implementing story; public status exposes only approved summaries. Internal telemetry query access is authorized through the selected backend.

## Verification and exit gate

Every feature AC above must map to passing story AC evidence: exact environment/revision, fixture/workload, expected and observed result, query or sanitized screenshot, and reviewer. Decision approvals must be recorded before dependent rollout. The [shared acceptance contract](README.md#shared-acceptance-contract) applies to all stories. Merging code or seeing one trace is insufficient evidence for metrics, privacy, alerts or outside-in coverage.

For application changes run `npm run typecheck`, `npm run build`, focused tests and `npm test` at the integrated phase gate. Test real preview delivery with synthetic data; no production applicant traffic is needed to validate a phase. Where a platform metric or integration is unavailable, record the limitation and remediation rather than manufacturing evidence.

## Boundaries and future work

No model-quality optimization, automatic budget enforcement, model switching or fabricated usage; no LangGraph migration; no new email/calendar provider implementation.

Future capabilities are owned by [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md); additional requirements discovered in delivery must receive a prioritized story and AC mapping before the scope is considered complete.

## Sizing

Estimate at story/task level after the blocking decisions and compatibility spike. The original 2–3 day estimate is not a commitment for this expanded scope. Separate active engineering effort, approval/provisioning lead time, baseline collection and operational validation. Split large implementation stories into focused tasks while preserving their AC IDs.
