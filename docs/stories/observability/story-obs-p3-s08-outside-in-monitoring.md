# OBS-P3-S08: Run independent uptime and browser journey probes

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform/QA engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 external visibility
**Decision coverage:** None

## User story and operational question

As the platform/qa engineer, I need evidence that answers: **Can users reach and use the application when internal telemetry looks healthy?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Use monitoring outside the application/export pipeline. Cover public reachability and the agreed user journeys with safe synthetic fixtures.

## Acceptance criteria

- [ ] **OBS-P3-S08-AC1:** Approved external regions check DNS/TLS/HTTP/content and freshness, distinguishing edge/network outage from application response failure; expected response body is validated, not just status 200.
- [ ] **OBS-P3-S08-AC2:** Browser checks exercise login and application submission plus representative resume/matching/agent paths using synthetic data; record step duration, final outcome and sanitized failure evidence.
- [ ] **OBS-P3-S08-AC3:** Third-party OAuth restrictions are honored with approved test identities/stubs and clearly labeled coverage limits; no production applicant credentials or raw screenshots containing PII are retained.
- [ ] **OBS-P3-S08-AC4:** Probe failures notify the operational owner, correlate time/release with internal metrics, and remain detectable during exporter/backend failure; blocked checks appear unknown, not healthy.
- [ ] **OBS-P3-S08-AC5:** Production mutation probes stay blocked by NFR-034 until durable storage is verified; preview synthetic acceptance can proceed with that limitation recorded.

## Verification and completion evidence

Simulate public route failure, incorrect response body, slow journey, and telemetry exporter outage; verify independent detection and approved cleanup.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S07: Specify browser, uptime, and customer-status monitoring](story-obs-p3-s07-external-monitoring-decision.md)
- [OBS-P3-S06: Implement SLO dashboards and actionable alerts](story-obs-p3-s06-slo-alerts.md)

## Likely touchpoints

external monitor configuration; browser fixtures; docs/runbooks. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
