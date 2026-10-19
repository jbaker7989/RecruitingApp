# OBS-P3-S10: Publish an independent customer-facing status service

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform engineer + communications owner (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 customer visibility
**Decision coverage:** None

## User story and operational question

As the platform engineer + communications owner, I need evidence that answers: **Can customers understand current service disruption without seeing internal telemetry?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Provide an independently hosted public status page/service so it remains available when this app is unavailable. Actual vendor, hosting and component policy come from decision stories.

## Acceptance criteria

- [ ] **OBS-P3-S10-AC1:** Publish approved components for critical journeys with clear operational/degraded/outage/maintenance/unknown states, last update, current incidents and approved history window.
- [ ] **OBS-P3-S10-AC2:** Only authorized publishers can open, update, resolve or schedule maintenance; changes have an audit trail and customer-safe descriptions without identifiers, provider credentials, internal URLs or trace details.
- [ ] **OBS-P3-S10-AC3:** Signal-to-status mapping and automation/human-approval rules follow policy; telemetry silence is shown as unknown/stale or escalated for review rather than falsely green.
- [ ] **OBS-P3-S10-AC4:** Page is readable on mobile and keyboard/screen-reader accessible; independent hosting and a tested access path survive an application/exporter outage.
- [ ] **OBS-P3-S10-AC5:** A simulated incident is published in a private/test status environment, updated and resolved with timestamps and history; public launch requires assigned communications ownership and validated data freshness.

## Verification and completion evidence

Test public read versus publisher authorization, stale-data behavior, outage independence, accessibility, and complete incident lifecycle without publishing a false live incident.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S07: Specify browser, uptime, and customer-status monitoring](story-obs-p3-s07-external-monitoring-decision.md)
- [OBS-P3-S08: Run independent uptime and browser journey probes](story-obs-p3-s08-outside-in-monitoring.md)
- [OBS-P3-S06: Implement SLO dashboards and actionable alerts](story-obs-p3-s06-slo-alerts.md)

## Likely touchpoints

proposed status-service configuration; publisher integration; docs/runbooks. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
