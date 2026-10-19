# OBS-P1-S07: Prove serverless export and fail-open behavior

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation / verification | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 hosted release
**Decision coverage:** D06 performance and delivery budgets

## User story and operational question

As the platform engineer, I need evidence that answers: **Can we trust telemetry delivery without making the application less reliable?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Validate trace and metric delivery under the actual runtime. Choosing @vercel/otel is not itself proof that no data is lost.

## Acceptance criteria

- [ ] **OBS-P1-S07-AC1:** Define numerical export latency, queue/buffer bounds, timeout, retry, and permitted loss/overhead budgets before testing; record approver and baseline workload.
- [ ] **OBS-P1-S07-AC2:** Cold/warm short-lived invocations, handled errors, and normal shutdown deliver expected telemetry within those bounds; document forced termination limits and observed loss.
- [ ] **OBS-P1-S07-AC3:** Backend timeout, bad credentials, throttling, and network outage cannot block user requests beyond the approved overhead budget or create unbounded memory/retry loops.
- [ ] **OBS-P1-S07-AC4:** Exporter errors, dropped records, queue saturation, and last successful export are observable via a bounded independent diagnostic path, avoiding recursive self-instrumentation.
- [ ] **OBS-P1-S07-AC5:** Demonstrate rollback/disable configuration and recovery; compare enabled/disabled p95 latency, throughput, memory, and delivery completeness under the same load.

## Verification and completion evidence

Attach repeatable preview fault-injection and load report, numerical budgets/results, and disable/restore evidence.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S03: Initialize telemetry in every supported runtime](story-obs-p1-s03-runtime-bootstrap.md)
- [OBS-P1-S05: Measure request rate, errors, and duration](story-obs-p1-s05-http-red-metrics.md)

## Likely touchpoints

proposed telemetry exporters/lifecycle; deployment configuration; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
