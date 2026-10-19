# OBS-P1-S05: Measure request rate, errors, and duration

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 preview acceptance
**Decision coverage:** None

**Implementation status (2026-10-19):** implemented in `src/telemetry/http.ts`; see [adr-s05](../../features/observability/adr/adr-s05-http-red-metrics.md). Verified locally incl. sampling ratio 0 and disconnects. **AC5 (dashboard labels) and hosted queryability are PENDING** (no dashboard built).

## User story and operational question

As the backend engineer, I need evidence that answers: **Which routes are slow or failing, and how often?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Create an explicit metrics pipeline. Tracing alone does not establish accurate aggregate request metrics.

## Acceptance criteria

- [ ] **OBS-P1-S05-AC1:** Count every eligible request exactly once and record a duration histogram in seconds using a monotonic timer; cover success, handled rejection, thrown error, cancellation, and disconnect without duplicate finish/close observations.
- [ ] **OBS-P1-S05-AC2:** Publish bounded dimensions for method, normalized route, outcome/status class, environment, and feature; unknown routes use a bounded fallback, never raw paths.
- [ ] **OBS-P1-S05-AC3:** For a known test mix, totals and error numerators match expected counts; p50/p95/p99 and request rate are queryable with documented aggregation and histogram resolution.
- [ ] **OBS-P1-S05-AC4:** Metrics continue to count the full request population when traces are sampled; health, static assets, synthetic traffic, and expected auth/validation failures have explicit inclusion/exclusion rules.
- [ ] **OBS-P1-S05-AC5:** Dashboard labels explain server processing duration versus user-perceived journey duration; empty traffic and missing telemetry are displayed distinctly.

## Verification and completion evidence

Replay deterministic mixed traffic, compare metric totals to the fixture manifest, inspect histogram distributions, and repeat with trace sampling disabled.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S03: Initialize telemetry in every supported runtime](story-obs-p1-s03-runtime-bootstrap.md)

## Likely touchpoints

src/index.ts; proposed request telemetry middleware; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
