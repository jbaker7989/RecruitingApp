# OBS-P3-S04: Approve sampling, capacity, and signal budgets

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Decision | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform lead + budget owner (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** Before steady-state production sampling is finalized
**Decision coverage:** D11 sampling/capacity and retention tradeoffs

## User story and operational question

As the platform lead + budget owner, I need evidence that answers: **Which traces can we retain, and what evidence will be lost?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Select head/tail/hybrid sampling only after assessing supported deployment/backend capabilities and actual signal volume.

## Acceptance criteria

- [ ] **OBS-P3-S04-AC1:** Record rates/rules by environment and traffic class, maximum ingest/cardinality, per-signal retention/cost caps and review triggers; preserve unsampled aggregate metrics.
- [ ] **OBS-P3-S04-AC2:** Document that head-dropped traces cannot be recovered later by tail sampling; if promising error/slow-trace retention, prove that the pipeline receives those spans and state capacity/failure limits.
- [ ] **OBS-P3-S04-AC3:** State policy for health/synthetic requests, critical journeys, late/long workflows, trusted parent context and caller-supplied sampled flags; assess collector operational cost if proposed.
- [ ] **OBS-P3-S04-AC4:** Approve numerical telemetry cost/loss thresholds and safe degradation order; require visible coverage/drop indicators and communicate audit-to-trace limitations.

## Verification and completion evidence

Model expected and burst ingestion and run representative error/slow/normal fixtures through the proposed policy.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S07: Prove serverless export and fail-open behavior](story-obs-p1-s07-export-reliability.md)
- [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](story-obs-p2-s10-duration-investigation.md)

## Likely touchpoints

proposed sampling policy and backend configuration. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
