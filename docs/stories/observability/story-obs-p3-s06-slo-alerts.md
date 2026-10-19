# OBS-P3-S06: Implement SLO dashboards and actionable alerts

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 actionable SLOs
**Decision coverage:** None

## User story and operational question

As the platform engineer, I need evidence that answers: **Are users experiencing a sustained reliability problem, and will someone act?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Implement at least three approved SLOs with tested alerts rather than raw CPU pages or unreviewed percentage examples.

## Acceptance criteria

- [ ] **OBS-P3-S06-AC1:** Dashboards calculate approved SLIs/error budgets from full-population metrics with documented numerator, denominator, evaluation window and filters; show no-data separately.
- [ ] **OBS-P3-S06-AC2:** Every accepted SLO has a tested alert with approved threshold/window or burn-rate rule, minimum volume, severity, routing, deduplication, recovery and runbook link.
- [ ] **OBS-P3-S06-AC3:** Synthetic incidents trigger the expected page/ticket once, recover correctly, and honor maintenance/silences; missing telemetry produces a separate diagnostic instead of a false healthy SLO.
- [ ] **OBS-P3-S06-AC4:** Each runbook identifies meaning, first query, likely causes, safe mitigation/rollback, escalation owner and dashboard link; operational owner acknowledges test delivery.

## Verification and completion evidence

Replay known success/failure datasets and alert transitions, test notification delivery in an approved channel, and retain evidence per SLO.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S02: Approve journey SLIs, SLOs, and error budgets](story-obs-p3-s02-slo-decision.md)
- [OBS-P3-S03: Assign operational ownership and escalation](story-obs-p3-s03-oncall-decision.md)

## Likely touchpoints

dashboard/alert configuration; docs/runbooks; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
