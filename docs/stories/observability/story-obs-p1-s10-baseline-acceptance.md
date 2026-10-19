# OBS-P1-S10: Accept the baseline with reproducible evidence

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Verification | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** QA + platform lead (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 exit
**Decision coverage:** None

## User story and operational question

As the qa + platform lead, I need evidence that answers: **Can another engineer diagnose a baseline request using only the delivered telemetry?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Validate P1 in an isolated preview with synthetic accounts and record the current instrumentation inventory.

## Acceptance criteria

- [ ] **OBS-P1-S10-AC1:** Inventory every current HTTP entrypoint and outbound client with actual coverage, unsupported paths, and linked remediation stories; no unsupported coverage is described as automatic.
- [ ] **OBS-P1-S10-AC2:** Demonstrate a request-to-provider trace, a Redis operation where configured, route p95/error-rate queries, correlated logs, runtime health, and deployment filtering in the chosen backend.
- [ ] **OBS-P1-S10-AC3:** Privacy, export-failure, concurrency, and overhead checks pass; record deployment/revision, traffic counts, queries, sanitized evidence, and reviewer.
- [ ] **OBS-P1-S10-AC4:** Each P1 feature acceptance criterion links to evidence and its implementing story; unresolved mandatory gates keep phase status Proposed/Blocked, never Complete.

## Verification and completion evidence

An engineer who did not implement the slice repeats the acceptance script and identifies an injected slow or failing dependency.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S06: Trace outbound HTTP, OAuth, and Redis](story-obs-p1-s06-outbound-oauth-redis.md)
- [OBS-P1-S07: Prove serverless export and fail-open behavior](story-obs-p1-s07-export-reliability.md)
- [OBS-P1-S08: Create structured operational logs with context](story-obs-p1-s08-operational-logs.md)
- [OBS-P1-S09: Observe health and runtime resource pressure](story-obs-p1-s09-health-runtime.md)

## Likely touchpoints

docs/features/observability; proposed acceptance fixtures; preview deployment. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
