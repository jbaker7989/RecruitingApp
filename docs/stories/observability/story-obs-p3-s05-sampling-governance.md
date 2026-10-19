# OBS-P3-S05: Enforce sampling, access, retention, and cost controls

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform engineer + security reviewer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 governance acceptance
**Decision coverage:** None

## User story and operational question

As the platform engineer + security reviewer, I need evidence that answers: **Are safety and spending controls actually enforced?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Implement the approved policies and operational evidence, extending the P1 privacy baseline.

## Acceptance criteria

- [ ] **OBS-P3-S05-AC1:** Configure sampling and cardinality limits; validate retained/dropped populations against policy and verify aggregate metrics are unaffected.
- [ ] **OBS-P3-S05-AC2:** Enforce environment/role separation, read/admin permissions, retention/deletion behavior, and exporter secret rotation; unauthorized access tests fail closed.
- [ ] **OBS-P3-S05-AC3:** Dashboards expose ingestion volume, dropped signals, usage freshness, storage/cost estimate and approved budget thresholds; test the warning path.
- [ ] **OBS-P3-S05-AC4:** Inject sensitive canaries into errors and integrations and verify all emitted signals remain sanitized; record retention expiry/deletion evidence without claiming telemetry changes audit-store policy.

## Verification and completion evidence

Attach policy-to-config mapping, denied-access and expiry evidence, volume/cost test, and canary payload inspection.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S04: Approve sampling, capacity, and signal budgets](story-obs-p3-s04-sampling-decision.md)
- [OBS-P1-S02: Approve privacy, access, retention, and residency](story-obs-p1-s02-data-governance-decision.md)

## Likely touchpoints

backend policies; telemetry configuration; proposed governance tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
