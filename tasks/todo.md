# Observability delivery checklist

All entries are Proposed. Use linked stories as the canonical AC and evidence source. Dependency order takes precedence over priority. Resolve P3-S03 ownership early where possible.

## Phase 1

- [ ] **P0** [OBS-P1-S01: Choose and prove a telemetry destination](../docs/stories/observability/story-obs-p1-s01-backend-decision.md)
- [ ] **P0** [OBS-P1-S02: Approve privacy, access, retention, and residency](../docs/stories/observability/story-obs-p1-s02-data-governance-decision.md)
- [ ] **P0** [OBS-P1-S03: Initialize telemetry in every supported runtime](../docs/stories/observability/story-obs-p1-s03-runtime-bootstrap.md)
- [ ] **P0** [OBS-P1-S04: Enforce safe attributes and propagation boundaries](../docs/stories/observability/story-obs-p1-s04-safe-telemetry-schema.md)
- [ ] **P0** [OBS-P1-S05: Measure request rate, errors, and duration](../docs/stories/observability/story-obs-p1-s05-http-red-metrics.md)
- [ ] **P1** [OBS-P1-S06: Trace outbound HTTP, OAuth, and Redis](../docs/stories/observability/story-obs-p1-s06-outbound-oauth-redis.md)
- [ ] **P0** [OBS-P1-S07: Prove serverless export and fail-open behavior](../docs/stories/observability/story-obs-p1-s07-export-reliability.md)
- [ ] **P1** [OBS-P1-S08: Create structured operational logs with context](../docs/stories/observability/story-obs-p1-s08-operational-logs.md)
- [ ] **P1** [OBS-P1-S09: Observe health and runtime resource pressure](../docs/stories/observability/story-obs-p1-s09-health-runtime.md)
- [ ] **P1** [OBS-P1-S10: Accept the baseline with reproducible evidence](../docs/stories/observability/story-obs-p1-s10-baseline-acceptance.md)

- [ ] Checkpoint: all [P1 feature criteria](../docs/features/observability/feature-observability-p1-baseline-tracing.md) have accepted evidence and required decisions are closed.

## Phase 2

- [ ] **P1** [OBS-P2-S01: Map critical journeys and duration semantics](../docs/stories/observability/story-obs-p2-s01-journey-instrumentation-contract.md)
- [ ] **P1** [OBS-P2-S02: Trace chat/model invocations and failures](../docs/stories/observability/story-obs-p2-s02-llm-spans.md)
- [ ] **P1** [OBS-P2-S03: Observe embedding operations](../docs/stories/observability/story-obs-p2-s03-embedding-usage.md)
- [ ] **P1** [OBS-P2-S04: Measure token usage without false precision](../docs/stories/observability/story-obs-p2-s04-token-accounting.md)
- [ ] **P1** [OBS-P2-S05: Approve estimated-cost attribution and budgets](../docs/stories/observability/story-obs-p2-s05-cost-policy-decision.md)
- [ ] **P1** [OBS-P2-S06: Publish feature usage and estimated-cost reports](../docs/stories/observability/story-obs-p2-s06-cost-dashboard.md)
- [ ] **P1** [OBS-P2-S07: Measure vector-store operations](../docs/stories/observability/story-obs-p2-s07-pinecone-spans.md)
- [ ] **P1** [OBS-P2-S08: Expose store and audit-write latency](../docs/stories/observability/story-obs-p2-s08-store-spans.md)
- [ ] **P1** [OBS-P2-S09: Observe agent steps and business outcomes](../docs/stories/observability/story-obs-p2-s09-agent-workflow-spans.md)
- [ ] **P1** [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](../docs/stories/observability/story-obs-p2-s10-duration-investigation.md)

- [ ] Checkpoint: all [P2 feature criteria](../docs/features/observability/feature-observability-p2-ai-custom-telemetry.md) have accepted evidence and required decisions are closed.

## Phase 3

- [ ] **P1** [OBS-P3-S01: Link audit events to retained traces safely](../docs/stories/observability/story-obs-p3-s01-audit-correlation.md)
- [ ] **P1** [OBS-P3-S02: Approve journey SLIs, SLOs, and error budgets](../docs/stories/observability/story-obs-p3-s02-slo-decision.md)
- [ ] **P0** [OBS-P3-S03: Assign operational ownership and escalation](../docs/stories/observability/story-obs-p3-s03-oncall-decision.md)
- [ ] **P1** [OBS-P3-S04: Approve sampling, capacity, and signal budgets](../docs/stories/observability/story-obs-p3-s04-sampling-decision.md)
- [ ] **P1** [OBS-P3-S05: Enforce sampling, access, retention, and cost controls](../docs/stories/observability/story-obs-p3-s05-sampling-governance.md)
- [ ] **P1** [OBS-P3-S06: Implement SLO dashboards and actionable alerts](../docs/stories/observability/story-obs-p3-s06-slo-alerts.md)
- [ ] **P1** [OBS-P3-S07: Specify browser, uptime, and customer-status monitoring](../docs/stories/observability/story-obs-p3-s07-external-monitoring-decision.md)
- [ ] **P1** [OBS-P3-S08: Run independent uptime and browser journey probes](../docs/stories/observability/story-obs-p3-s08-outside-in-monitoring.md)
- [ ] **P2** [OBS-P3-S09: Deliver approved browser experience and error visibility](../docs/stories/observability/story-obs-p3-s09-browser-experience.md)
- [ ] **P1** [OBS-P3-S10: Publish an independent customer-facing status service](../docs/stories/observability/story-obs-p3-s10-customer-status.md)
- [ ] **P1** [OBS-P3-S11: Compare releases and guide rollback decisions](../docs/stories/observability/story-obs-p3-s11-release-regressions.md)
- [ ] **P2** [OBS-P3-S12: Track future observability capabilities and adoption triggers](../docs/stories/observability/story-obs-p3-s12-future-capabilities-decision.md)
- [ ] **P1** [OBS-P3-S13: Prove incident response and close acceptance](../docs/stories/observability/story-obs-p3-s13-operational-game-day.md)

- [ ] Checkpoint: all [P3 feature criteria](../docs/features/observability/feature-observability-p3-operational-readiness.md) have accepted evidence and required decisions are closed.

## P2 local synthetic implementation checkpoint (2026-10-19)

- [x] Execute [P2 plan](observability-p2-plan.md), retaining every story/feature AC and open decision gate.
- [x] Independent Codex tests and full baseline quality gates; real Docker query integration passed (P1 4/4, P2 27/27).
- [ ] Review privacy/behavior/cardinality and evidence; commit, push and open linked PR without merging.
