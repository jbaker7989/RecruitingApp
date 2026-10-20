# OBS-P2-S08: Expose store and audit-write latency

**Status:** Implementation complete (dev2) — awaiting tester verification
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 storage coverage
**Decision coverage:** None

## User story and operational question

As the backend engineer, I need evidence that answers: **Is JSON reading/writing or audit logging responsible for latency or failure?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Observe readStore/writeStore/readObservability/writeObservability without changing persistence semantics or claiming to solve NFR-034.

## Acceptance criteria

- [ ] **OBS-P2-S08-AC1:** Store/audit operations expose duration, logical operation, bounded store category, outcome, and safe size/count measurements; no records or file contents are exported.
- [ ] **OBS-P2-S08-AC2:** Parent/child structure distinguishes total audit append from its read/write children so analysts do not sum inclusive durations as elapsed time.
- [ ] **OBS-P2-S08-AC3:** Permission failure, parse corruption, missing file, and concurrent activity are diagnosable without recursive audit writes triggered by telemetry failure.
- [ ] **OBS-P2-S08-AC4:** NFR-034 remains an explicit production mutation/durable audit dependency; evidence uses synthetic data and labels ephemeral-store limitations; future durable-store instrumentation is tracked.

## Implementation notes (dev2)

- `src/models/store.ts`: `readStore`, `writeStore`, `readObservability`, `writeObservability`, `addObservabilityEntry` all wrapped with `withStoreSpan`.
- `addObservabilityEntry` creates a parent `store.audit.append` span containing child `store.audit.read` and `store.audit.write` spans — parent/child structure avoids double-counting inclusive duration (AC2).
- Telemetry errors in `withStoreSpan` are fail-open, preventing recursive audit writes triggered by telemetry failure (AC3).
- NFR-034 remains open: JSON file store is ephemeral; no production mutation traffic or durable audit acceptance until resolved (AC4).

## Verification and completion evidence

Inject read/write/parse failures and controlled delays; demonstrate correct durations and no recursion or payload leaks.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md)

## Likely touchpoints

src/models/store.ts; proposed storage telemetry wrapper; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
