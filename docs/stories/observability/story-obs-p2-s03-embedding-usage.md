# OBS-P2-S03: Observe embedding operations

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** AI engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 embedding coverage
**Decision coverage:** None

## User story and operational question

As the ai engineer, I need evidence that answers: **How much time and usage do embeddings add to matching and indexing?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Cover embedding calls separately from chat so the actual embedding model is reported instead of the factory’s task configuration.

## Acceptance criteria

- [ ] **OBS-P2-S03-AC1:** Embedding query/document/batch operations record actual model, feature, duration, bounded batch size and outcome, with correlated provider-client spans.
- [ ] **OBS-P2-S03-AC2:** Provider-reported usage is recorded when available; unsupported/missing usage is explicitly unknown, never fabricated as zero or assumed from chat configuration.
- [ ] **OBS-P2-S03-AC3:** Batch partial failures/retries and cache/reuse paths are distinguishable; counters do not double count reused vectors as fresh paid calls.
- [ ] **OBS-P2-S03-AC4:** Raw text, vector contents, applicant identifiers, and query filters are absent from telemetry.

## Verification and completion evidence

Exercise single and batch embedding, retry/failure, missing usage, and existing-vector reuse; verify model and counts.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md)

## Likely touchpoints

src/services/llm/index.ts; src/services/vectorStore/index.ts; src/services/vectorStore/pinecone.ts; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
