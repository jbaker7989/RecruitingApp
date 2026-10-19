# OBS-P3-S01: Link audit events to retained traces safely

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** P3 audit correlation
**Decision coverage:** None

## User story and operational question

As the backend engineer, I need evidence that answers: **Can support move from a business event to the corresponding operational evidence?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Add details.trace_id from trusted active context while retaining existing audit call signatures and purpose.

## Acceptance criteria

- [ ] **OBS-P3-S01-AC1:** Concurrent requests enrich only their own audit events with valid active trace ID (and optional span/request ID); absent context does not fabricate an ID or throw.
- [ ] **OBS-P3-S01-AC2:** Preserve existing details and prevent a caller-provided conflicting trace_id from overriding active trusted context; document reserved-field behavior.
- [ ] **OBS-P3-S01-AC3:** Authorized viewers can resolve a retained trace using configured backend URL/query; no credentials are embedded in links and unauthorized viewers gain no access.
- [ ] **OBS-P3-S01-AC4:** Unsampled, expired, pending-export, or missing traces show an honest unavailable state with a safe request/log lookup; a sampled flag is not proof of backend retention.
- [ ] **OBS-P3-S01-AC5:** Durable audit acceptance explicitly depends on NFR-034; old records without IDs remain readable and audit retention is not changed by trace retention.

## Verification and completion evidence

Test concurrency, no-span startup events, conflicting details, legacy records, retained and expired traces, and denied backend access.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S08: Create structured operational logs with context](story-obs-p1-s08-operational-logs.md)
- [OBS-P2-S10: Deliver end-to-end duration and dependency investigation](story-obs-p2-s10-duration-investigation.md)

## Likely touchpoints

src/models/store.ts; audit viewing/query path; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
