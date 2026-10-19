# OBS-P1-S08: Create structured operational logs with context

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 diagnosability
**Decision coverage:** None

## User story and operational question

As the backend engineer, I need evidence that answers: **What happened in a particular failed request when a trace is unavailable?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Introduce structured operational events alongside existing business audit records; do not stream the audit payload wholesale into telemetry.

## Acceptance criteria

- [ ] **OBS-P1-S08-AC1:** Critical request/error/startup paths emit stable event name, level, timestamp, environment, release, safe outcome/category, request/run ID, and active trace/span IDs where available.
- [ ] **OBS-P1-S08-AC2:** Entry point is stamped at origin (HTTP, CLI, scheduled, replay where implemented) and propagated rather than inferred; background/startup logs work without active spans.
- [ ] **OBS-P1-S08-AC3:** A failed request can be found by support/request ID in authorized log search; logs explicitly tolerate missing or unsampled traces.
- [ ] **OBS-P1-S08-AC4:** Levels and retention follow policy; stack/message sanitization and volume bounds apply to migrated console logging, exporter failures, and third-party exceptions.

## Verification and completion evidence

Concurrent success/failure requests retain correct IDs; inspect searchable sanitized logs with tracing both on and off.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S03: Initialize telemetry in every supported runtime](story-obs-p1-s03-runtime-bootstrap.md)
- [OBS-P1-S04: Enforce safe attributes and propagation boundaries](story-obs-p1-s04-safe-telemetry-schema.md)

## Likely touchpoints

src/index.ts; src/middleware/auth.ts; proposed logger; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
