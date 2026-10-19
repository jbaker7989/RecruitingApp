# OBS-P3-S02: Approve journey SLIs, SLOs, and error budgets

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Decision | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Product owner + operations owner (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** Before SLO/alert activation
**Decision coverage:** D09 service objectives and low-traffic policy

## User story and operational question

As the product owner + operations owner, I need evidence that answers: **What does acceptable availability, latency, and completion mean for each critical journey?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Choose at least three measurable SLOs covering the agreed journeys; numerical objectives are unknown until baseline and product review.

## Acceptance criteria

- [ ] **OBS-P3-S02-AC1:** For login/OAuth, application submission, resume parsing/matching, and agent workflows record success/eligible-event definitions, exclusions, measurement point, owner and candidate availability/completion/latency SLIs.
- [ ] **OBS-P3-S02-AC2:** Approve at least three SLOs with numerical targets, evaluation window, latency bounds where relevant, error-budget calculation and action policy; explicitly cover or defer each remaining journey with owner/date.
- [ ] **OBS-P3-S02-AC3:** Define timeouts, cancellations, valid rejection versus service failure, partial/degraded success, human wait, synthetic traffic, low volume, no traffic, and missing telemetry treatment.
- [ ] **OBS-P3-S02-AC4:** Approve alert windows/burn rates, minimum event volume, recovery rules and review cadence using baseline data; no illustrative proposal threshold becomes a commitment by accident.

## Verification and completion evidence

Calculate sample good/bad-event ratios and budgets from known datasets; obtain product and operations approval.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S10: Accept the baseline with reproducible evidence](story-obs-p1-s10-baseline-acceptance.md)
- [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](story-obs-p2-s10-duration-investigation.md)

## Likely touchpoints

proposed SLO specification and ADR. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
