# OBS-P3-S11: Compare releases and guide rollback decisions

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 deploy safety
**Decision coverage:** None

## User story and operational question

As the platform engineer, I need evidence that answers: **Did a deployment make duration, error rates, or spend worse?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Correlate deployment/release identity with metrics, logs, traces and incidents; use comparisons with adequate data.

## Acceptance criteria

- [ ] **OBS-P3-S11-AC1:** All available signals include stable environment/service/release identity; dashboard marks deployment events and distinguishes preview from production.
- [ ] **OBS-P3-S11-AC2:** Compare approved pre/post windows for route/feature latency, failures, degraded outcomes and usage/cost with sample counts and traffic-mix caveats.
- [ ] **OBS-P3-S11-AC3:** Low volume or missing telemetry prevents an unsupported regression verdict; thresholds and manual rollback authority are documented and linked to SLO policy.
- [ ] **OBS-P3-S11-AC4:** A deliberately regressed preview produces a detectable comparison and runbook-guided rollback exercise; no automatic production rollback is introduced by this story.

## Verification and completion evidence

Run matched baseline/regressed preview workloads and verify release filters and diagnosis; record manual rollback drill.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](story-obs-p2-s10-duration-investigation.md)
- [OBS-P3-S06: Implement SLO dashboards and actionable alerts](story-obs-p3-s06-slo-alerts.md)

## Likely touchpoints

deployment metadata; dashboard definitions; docs/runbooks. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
