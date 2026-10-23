# Observability delivery backlog — OBS-001

**Status:** P1 local implementation is available for review; production acceptance remains open. P2/P3 remain proposed. See [delivery evidence](p1-delivery-evidence.md).
**Reviewed:** 2026-10-18
**Start here:** [Detailed review](review-opentelemetry-proposal.md) · [Original proposal, corrected](feature-opentelemetry-integration.md) · [All stories](../../stories/observability/README.md)

## Confirmed scope

The user confirmed login/OAuth, application submission, resume parsing/matching and agent workflows as the initial critical journeys. External visibility includes **outbound dependencies, independent uptime/browser monitoring, and customer-facing status reporting**. Platform, budget, retention/residency, numerical objectives and named operational owners remain unknown and are represented by gated decision stories. Future-development decisions are explicitly tracked. Every story has a priority.

## Features

| Feature | Outcome | Prerequisite |
|---|---|---|
| [OBS-001-P1: Baseline tracing](feature-observability-p1-baseline-tracing.md) | Safe traces, request metrics, logs, runtime health and proven export | Backend/data decisions before hosted export |
| [OBS-001-P2: AI and custom telemetry](feature-observability-p2-ai-custom-telemetry.md) | Duration attribution, business outcomes, tokens and estimated cost | Accepted P1 signal foundation |
| [OBS-001-P3: Operational readiness](feature-observability-p3-operational-readiness.md) | Audit correlation, SLOs, governance, external checks and customer status | P2 evidence plus operational decisions |

[Docker CI/CD follow-up](feature-docker-cicd-integration.md): seven prioritized stories for isolated backend tests, fault/security checks, delivery gates and conditional application-image publication. Proposed; existing hosted acceptance gates remain open.

## Priority policy

- **P0 — blocking:** safe collection, reliable delivery or accountable production operation cannot ship without it. P0 does not imply immediate customer outage.
- **P1 — required:** necessary to deliver the agreed phase outcome. A phase does not close with an unfulfilled required P1 story.
- **P2 — planned/conditional:** roadmap decisions or conditional enhancements. The decision must close; conditional implementation follows the recorded disposition. P2 does not silently remove any confirmed scope.

Order by dependencies, then priority. P3 on-call ownership is P0 and can be resolved early; it need not wait for P2 coding. A named owner is not invented: role assignments here identify who must be assigned, and decision stories require the actual assignee. All estimates remain uncommitted pending spikes and provisioning.

## Operational question coverage

| Area | Question to answer | Stories |
|---|---|---|
| Duration | How long did the request take, and where was the time spent? | [OBS-P1-S05](../../stories/observability/story-obs-p1-s05-http-red-metrics.md), [OBS-P2-S10](../../stories/observability/story-obs-p2-s10-duration-investigation.md) |
| Operational health | Is the app alive/ready, saturated, or missing telemetry? | [OBS-P1-S07](../../stories/observability/story-obs-p1-s07-export-reliability.md), [OBS-P1-S09](../../stories/observability/story-obs-p1-s09-health-runtime.md) |
| Traces | What call chain produced this failure, including retries? | [OBS-P1-S03](../../stories/observability/story-obs-p1-s03-runtime-bootstrap.md), [OBS-P2-S02](../../stories/observability/story-obs-p2-s02-llm-spans.md) |
| External providers | Is OAuth/Redis/Pinecone/model dependency degrading? | [OBS-P1-S06](../../stories/observability/story-obs-p1-s06-outbound-oauth-redis.md), [OBS-P2-S07](../../stories/observability/story-obs-p2-s07-pinecone-spans.md) |
| AI consumption | How many known tokens and estimated dollars per feature? | [OBS-P2-S04](../../stories/observability/story-obs-p2-s04-token-accounting.md), [OBS-P2-S06](../../stories/observability/story-obs-p2-s06-cost-dashboard.md) |
| Business outcome | Did HTTP 200 hide a degraded result or partial workflow? | [OBS-P2-S01](../../stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md), [OBS-P2-S09](../../stories/observability/story-obs-p2-s09-agent-workflow-spans.md) |
| Audit correlation | Which trace/logs relate to this audit event? | [OBS-P1-S08](../../stories/observability/story-obs-p1-s08-operational-logs.md), [OBS-P3-S01](../../stories/observability/story-obs-p3-s01-audit-correlation.md) |
| Release safety | Did the release worsen duration, failures, or cost? | [OBS-P2-S10](../../stories/observability/story-obs-p2-s10-duration-investigation.md), [OBS-P3-S11](../../stories/observability/story-obs-p3-s11-release-regressions.md) |
| Service levels | Are we meeting objectives, and who responds? | [OBS-P3-S02](../../stories/observability/story-obs-p3-s02-slo-decision.md), [OBS-P3-S06](../../stories/observability/story-obs-p3-s06-slo-alerts.md) |
| Outside-in experience | Can a real browser complete critical user journeys? | [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md), [OBS-P3-S08](../../stories/observability/story-obs-p3-s08-outside-in-monitoring.md) |
| Customer visibility | What can customers see during an outage? | [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md), [OBS-P3-S10](../../stories/observability/story-obs-p3-s10-customer-status.md) |
| Browser experience | Are client-side failures invisible to backend timing? | [OBS-P3-S08](../../stories/observability/story-obs-p3-s08-outside-in-monitoring.md), [OBS-P3-S09](../../stories/observability/story-obs-p3-s09-browser-experience.md) |
| Safety and cost | Are data access, retention, sampling and volume controlled? | [OBS-P1-S04](../../stories/observability/story-obs-p1-s04-safe-telemetry-schema.md), [OBS-P3-S05](../../stories/observability/story-obs-p3-s05-sampling-governance.md) |
| Future development | What must be added when queues/streams/storage change? | [OBS-P2-S01](../../stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md), [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md) |
| Readiness | Can operators detect, explain, communicate and recover? | [OBS-P3-S03](../../stories/observability/story-obs-p3-s03-oncall-decision.md), [OBS-P3-S13](../../stories/observability/story-obs-p3-s13-operational-game-day.md) |

## Decision register and release gates

No unresolved question below is considered answered by this plan. Decisions must include rationale, approver, date, concrete operating values, and downstream acceptance updates. If not answerable today, leave the decision Open and keep its specific gate closed.

| Decision | Unknown to resolve | Owner role | Story | Blocks |
|---|---|---|---|---|
| D01 | Backend, supported signals, plan and transport | Platform | [OBS-P1-S01](../../stories/observability/story-obs-p1-s01-backend-decision.md) | Hosted export |
| D02 | Telemetry budget, named service/funding owner | Leadership/finance | [OBS-P1-S01](../../stories/observability/story-obs-p1-s01-backend-decision.md) | Hosted export |
| D03 | Allowed data and per-signal retention/deletion | Security/privacy | [OBS-P1-S02](../../stories/observability/story-obs-p1-s02-data-governance-decision.md) | Real-data export |
| D04 | Residency, RBAC, identifier access | Security/platform | [OBS-P1-S02](../../stories/observability/story-obs-p1-s02-data-governance-decision.md) | Real-data export |
| D05 | Node ESM/Express/Vercel compatibility and bootstrap | Platform | [OBS-P1-S03](../../stories/observability/story-obs-p1-s03-runtime-bootstrap.md) | P1 preview acceptance |
| D06 | Numerical overhead, buffer, delivery/loss budgets | Platform | [OBS-P1-S07](../../stories/observability/story-obs-p1-s07-export-reliability.md) | P1 hosted release |
| D07 | Journey boundaries, outcomes and actual integration coverage | Product/backend | [OBS-P2-S01](../../stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md) | P2 wrappers |
| D08 | AI pricing, allocation, budgets and reconciliation tolerance | Product/finance | [OBS-P2-S05](../../stories/observability/story-obs-p2-s05-cost-policy-decision.md) | Reliable cost reporting |
| D09 | Targets, windows, error budgets and low-traffic rules | Product/operations | [OBS-P3-S02](../../stories/observability/story-obs-p3-s02-slo-decision.md) | SLO activation |
| D10 | Named on-call, coverage and communications ownership | Leadership | [OBS-P3-S03](../../stories/observability/story-obs-p3-s03-oncall-decision.md) | Production paging/public incident publishing |
| D11 | Sampling, capacity and retained-error/slow-trace promises | Platform/finance | [OBS-P3-S04](../../stories/observability/story-obs-p3-s04-sampling-decision.md) | Steady-state sampling policy |
| D12 | Probe regions/cadence/accounts and thresholds | Operations/QA | [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md) | External probe rollout |
| D13 | Real-user browser collection and consent | Product/security | [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md) | RUM rollout; synthetic checks still required |
| D14 | Status components, publishing rules and update targets | Product/communications | [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md) | Customer status launch |
| D15 | Future capabilities, adoption triggers and review dates | Product/platform | [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md) | Only the adopted future capability; roadmap decision at P3 exit |

## Shared acceptance contract

1. Each story's AC IDs are the completion checklist; each phase links its criteria to those stories. Evidence records expected/observed result, environment, release, traffic population, sanitized queries/artifacts and reviewer. Untested criteria stay unchecked.
2. Metrics use full eligible event populations and bounded dimensions, even when traces are sampled. Use histogram percentiles with documented units, buckets and aggregation, never averages presented as percentiles. Distinguish zero traffic from lost data.
3. Measure request elapsed time, provider attempt time, logical operation time, workflow active time and user waiting separately. Parallel/inclusive spans cannot be summed to infer total elapsed time. Critical-path explanations must follow actual execution.
4. Preserve outcomes: provider success can still yield application validation failure; handled fallback/partial success remains observable; expected user rejection is not automatically a service outage. Decision D07/D09 defines denominators.
5. Trace retention is conditional on sampling, successful export and retention policy. Audit/request IDs support diagnosis when traces are unavailable. Client-side spans reveal our dependency calls, not a third party's internal processing.
6. Privacy applies before any export, including automatic instrumentation, exceptions, SDK logs, exporter diagnostics and screenshots. Allow-list fields; never export resumes, prompts/completions, cookies/tokens, OAuth codes/state or raw audit records. Keep secrets outside source/docs.
7. Telemetry outage must not create an unbounded application failure. Validate rollback/disable, bounded queue/retry behavior, delivery loss and overhead against approved numerical budgets. Independent probes must detect internal telemetry blindness.
8. Decision completion requires an actual decision, not a list of options. No numerical objective, retention, vendor price or owner is assumed approved. Defaults may support isolated synthetic development only.
9. Test mandatory success, failure, timeout, cancellation, concurrency, missing context/usage and degraded paths appropriate to each story. Application code uses the repository build/typecheck/test commands; hosted acceptance additionally proves real export/query behavior.
10. Audit persistence is separate: [NFR-034](../../../BUGS.md) blocks production mutation traffic and durable audit acceptance. Synthetic preview work proceeds with the limitation explicit. A trace is not proof that an application or audit write is durable.

## Implementation checkpoints

- **Before operational export:** D01–D04 approved for shared/production collection, P1 safe schema verified, supported runtime bootstrap selected. Only isolated synthetic evaluation may precede these hosted/real-data gates.
- **P1 exit:** trace, metric, log, runtime and delivery evidence accepted; no privacy or export-reliability blocker open.
- **P2 exit:** actual critical journeys diagnosable, usage/cost completeness visible and custom spans validated.
- **P3 exit:** approved SLOs/alerts, safe audit correlation, governance, independent browser/uptime, customer status and operational drill all accepted; RUM and future-roadmap decisions explicitly closed.
- **Production mutation readiness:** NFR-034 resolved and validated separately. Passing observability acceptance does not override the product's production blockers.

## Backlog maintenance

The detailed stories live in `docs/stories/observability/`. [Implementation plan](../../../tasks/plan.md) and [ordered checklist](../../../tasks/todo.md) link to them; they do not duplicate acceptance criteria. Add discovered questions to the decision register with a story, role, and gate. Future adoption decisions must spawn specific implementation stories before a new capability ships. No external tracker items have been created by this documentation change.
