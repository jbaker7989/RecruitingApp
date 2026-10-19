# OBS-P1-S09: Observe health and runtime resource pressure

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 operational dashboard
**Decision coverage:** None

## User story and operational question

As the platform engineer, I need evidence that answers: **Is the service alive, ready, saturated, or losing telemetry?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Preserve /health compatibility; specify readiness separately and use available platform signals for failures that application code cannot emit.

## Acceptance criteria

- [ ] **OBS-P1-S09-AC1:** Liveness remains cheap and does not call paid external services; readiness semantics identify required versus optional dependencies with bounded, cached checks and no sensitive public detail.
- [ ] **OBS-P1-S09-AC2:** Expose available process/platform memory, event-loop delay, concurrency, timeouts, cold-start/startup failures, and exporter freshness; unsupported platform metrics are explicitly marked unavailable.
- [ ] **OBS-P1-S09-AC3:** A runtime dashboard filters environment/release and distinguishes application failure, dependency degradation, and telemetry outage; no-data never renders as healthy zero.
- [ ] **OBS-P1-S09-AC4:** Failure fixtures exercise not-ready, optional dependency degradation, and stale telemetry; readiness does not claim the JSON audit store is durable.

## Verification and completion evidence

Probe liveness/readiness contracts and inspect dashboard under injected dependency failure and telemetry interruption.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S05: Measure request rate, errors, and duration](story-obs-p1-s05-http-red-metrics.md)
- [OBS-P1-S07: Prove serverless export and fail-open behavior](story-obs-p1-s07-export-reliability.md)

## Likely touchpoints

src/index.ts; platform metrics configuration; proposed dashboards; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
