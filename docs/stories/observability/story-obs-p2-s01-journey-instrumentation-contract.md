# OBS-P2-S01: Map critical journeys and duration semantics

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Decision / spike | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Product owner + backend lead (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** Before P2 wrappers are accepted
**Decision coverage:** D07 journey semantics and instrumentation coverage

## User story and operational question

As the product owner + backend lead, I need evidence that answers: **What exactly starts and ends each operation, and what does success mean?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

User-confirmed critical journeys: login/OAuth, application submission, resume parsing/matching, and agent workflows. Map actual execution rather than the illustrative proposal tree.

## Acceptance criteria

- [ ] **OBS-P2-S01-AC1:** Produce a path inventory from routes through chains/services/store for every critical journey, including fallback, retries, parsing/validation, imports/batches, and simulated integrations.
- [ ] **OBS-P2-S01-AC2:** Define logical operation versus attempt, active execution versus waiting time, timeout/cancellation, partial success, and bounded feature/operation/outcome vocabulary.
- [ ] **OBS-P2-S01-AC3:** Document ownership of each span/metric and deduplication between auto-instrumentation, LangChain hooks, and manual wrappers; model/provider attribution comes from actual invocations.
- [ ] **OBS-P2-S01-AC4:** Confirm which real flows call LLM, embeddings, Pinecone, and store; create separate acceptance fixtures if no single flow touches all three rather than inventing calls to satisfy a diagram.

## Verification and completion evidence

Review path matrix against route/service source and named fixtures; product and engineering approve outcome definitions.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S10: Accept the baseline with reproducible evidence](story-obs-p1-s10-baseline-acceptance.md)

## Likely touchpoints

src/routes/agents; src/chains; src/services; src/models/store.ts. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
