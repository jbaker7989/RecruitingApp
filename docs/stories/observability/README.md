# Observability stories

**Status:** Proposed. Priorities and gate definitions: [backlog contract](../../features/observability/README.md). Each linked file contains scope, explicit AC IDs, verification, dependencies and a responsible role.

## Phase 1

| Story | Priority | Type |
|---|---|---|
| [OBS-P1-S01: Choose and prove a telemetry destination](story-obs-p1-s01-backend-decision.md) | P0 | Decision / spike |
| [OBS-P1-S02: Approve privacy, access, retention, and residency](story-obs-p1-s02-data-governance-decision.md) | P0 | Decision |
| [OBS-P1-S03: Initialize telemetry in every supported runtime](story-obs-p1-s03-runtime-bootstrap.md) | P0 | Implementation |
| [OBS-P1-S04: Enforce safe attributes and propagation boundaries](story-obs-p1-s04-safe-telemetry-schema.md) | P0 | Implementation |
| [OBS-P1-S05: Measure request rate, errors, and duration](story-obs-p1-s05-http-red-metrics.md) | P0 | Implementation |
| [OBS-P1-S06: Trace outbound HTTP, OAuth, and Redis](story-obs-p1-s06-outbound-oauth-redis.md) | P1 | Implementation |
| [OBS-P1-S07: Prove serverless export and fail-open behavior](story-obs-p1-s07-export-reliability.md) | P0 | Implementation / verification |
| [OBS-P1-S08: Create structured operational logs with context](story-obs-p1-s08-operational-logs.md) | P1 | Implementation |
| [OBS-P1-S09: Observe health and runtime resource pressure](story-obs-p1-s09-health-runtime.md) | P1 | Implementation |
| [OBS-P1-S10: Accept the baseline with reproducible evidence](story-obs-p1-s10-baseline-acceptance.md) | P1 | Verification |

| [OBS-P1-S11: Configure and verify the Vercel Preview runtime](story-obs-p1-s11-vercel-preview-configuration.md) | P0 — Critical | Configuration / verification |

## Phase 2

| Story | Priority | Type |
|---|---|---|
| [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md) | P1 | Decision / spike |
| [OBS-P2-S02: Trace chat/model invocations and failures](story-obs-p2-s02-llm-spans.md) | P1 | Implementation |
| [OBS-P2-S03: Observe embedding operations](story-obs-p2-s03-embedding-usage.md) | P1 | Implementation |
| [OBS-P2-S04: Measure token usage without false precision](story-obs-p2-s04-token-accounting.md) | P1 | Implementation |
| [OBS-P2-S05: Approve estimated-cost attribution and budgets](story-obs-p2-s05-cost-policy-decision.md) | P1 | Decision |
| [OBS-P2-S06: Publish feature usage and estimated-cost reports](story-obs-p2-s06-cost-dashboard.md) | P1 | Implementation |
| [OBS-P2-S07: Measure vector-store operations](story-obs-p2-s07-pinecone-spans.md) | P1 | Implementation |
| [OBS-P2-S08: Expose store and audit-write latency](story-obs-p2-s08-store-spans.md) | P1 | Implementation |
| [OBS-P2-S09: Observe agent steps and business outcomes](story-obs-p2-s09-agent-workflow-spans.md) | P1 | Implementation |
| [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](story-obs-p2-s10-duration-investigation.md) | P1 | Verification / dashboard |

## Phase 3

| Story | Priority | Type |
|---|---|---|
| [OBS-P3-S01: Link audit events to retained traces safely](story-obs-p3-s01-audit-correlation.md) | P1 | Implementation |
| [OBS-P3-S02: Approve journey SLIs, SLOs, and error budgets](story-obs-p3-s02-slo-decision.md) | P1 | Decision |
| [OBS-P3-S03: Assign operational ownership and escalation](story-obs-p3-s03-oncall-decision.md) | P0 | Decision |
| [OBS-P3-S04: Approve sampling, capacity, and signal budgets](story-obs-p3-s04-sampling-decision.md) | P1 | Decision |
| [OBS-P3-S05: Enforce sampling, access, retention, and cost controls](story-obs-p3-s05-sampling-governance.md) | P1 | Implementation |
| [OBS-P3-S06: Implement SLO dashboards and actionable alerts](story-obs-p3-s06-slo-alerts.md) | P1 | Implementation |
| [OBS-P3-S07: Specify browser, uptime, and customer-status monitoring](story-obs-p3-s07-external-monitoring-decision.md) | P1 | Decision |
| [OBS-P3-S08: Run independent uptime and browser journey probes](story-obs-p3-s08-outside-in-monitoring.md) | P1 | Implementation |
| [OBS-P3-S09: Deliver approved browser experience and error visibility](story-obs-p3-s09-browser-experience.md) | P2 | Implementation / conditional |
| [OBS-P3-S10: Publish an independent customer-facing status service](story-obs-p3-s10-customer-status.md) | P1 | Implementation |
| [OBS-P3-S11: Compare releases and guide rollback decisions](story-obs-p3-s11-release-regressions.md) | P1 | Implementation |
| [OBS-P3-S12: Track future observability capabilities and adoption triggers](story-obs-p3-s12-future-capabilities-decision.md) | P2 | Decision / backlog governance |
| [OBS-P3-S13: Prove incident response and close acceptance](story-obs-p3-s13-operational-game-day.md) | P1 | Verification |
