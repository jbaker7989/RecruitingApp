# OBS-P3-S03: Assign operational ownership and escalation

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Decision | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Engineering leadership (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** Before production pages or public incident publishing
**Decision coverage:** D10 on-call and communications ownership

## User story and operational question

As the engineering leadership, I need evidence that answers: **Who responds when an alert fires, and who owns customer communications?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

No operations owner or paging channel has been supplied. Define a staffed model before claiming operational readiness.

## Acceptance criteria

- [ ] **OBS-P3-S03-AC1:** Assign named primary/backup owners, coverage hours/timezones, escalation destinations, acknowledgement/escalation intervals, and incident commander roles.
- [ ] **OBS-P3-S03-AC2:** Approve page-versus-ticket rules, maintenance/silence permissions, customer communications approver, and access to backend/runbooks/status publishing.
- [ ] **OBS-P3-S03-AC3:** Define action when support is unstaffed, telemetry is down, or provider outage affects several features; record an approved alternative if 24/7 paging is not funded.
- [ ] **OBS-P3-S03-AC4:** Run a controlled delivery/acknowledgement test with agreed participants; unresolved ownership blocks production paging and public status launch, not local instrumentation.

## Verification and completion evidence

Attach contact-role matrix, delivery/acknowledgement evidence and approved coverage model; do not store private credentials.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S01: Choose and prove a telemetry destination](story-obs-p1-s01-backend-decision.md)

## Likely touchpoints

proposed operations ownership and incident policy. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
