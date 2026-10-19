# OBS-P3-S07: Specify browser, uptime, and customer-status monitoring

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Decision | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Product + operations + security owners (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** Before external checks or browser collection launch
**Decision coverage:** D12 external monitor policy, D13 browser RUM, D14 customer status policy

## User story and operational question

As the product + operations + security owners, I need evidence that answers: **What does the outside world experience, and what can customers be told?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

User confirmed all three visibility types are required: provider calls, outside-in monitoring, and customer-facing status. Select implementations and thresholds without reopening that scope.

## Acceptance criteria

- [ ] **OBS-P3-S07-AC1:** Approve probe regions, cadence, timeouts, browser/device coverage, freshness bounds and alert policy for public uptime plus authenticated critical-journey synthetic checks.
- [ ] **OBS-P3-S07-AC2:** Define safe synthetic accounts/data lifecycle, quota/billing budget, preview-protection handling, production mutation restrictions, and failure classification for DNS/TLS/CDN versus application failure.
- [ ] **OBS-P3-S07-AC3:** Decide browser real-user monitoring scope, consent/privacy/residency and sampling, frontend-error capture and release correlation; synthetic browser testing is required regardless of the RUM decision.
- [ ] **OBS-P3-S07-AC4:** Approve public status components, state mapping, incident/update cadence, historical reporting window, accessibility, publishing/approval rights and communication targets; customer data and internal traces remain private.

## Verification and completion evidence

Attach approved external monitoring/status design with numerical operating parameters and explicit RUM decision.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S02: Approve journey SLIs, SLOs, and error budgets](story-obs-p3-s02-slo-decision.md)
- [OBS-P3-S03: Assign operational ownership and escalation](story-obs-p3-s03-oncall-decision.md)

## Likely touchpoints

proposed external-monitoring and status ADR. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
