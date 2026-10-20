# OBS-P2-S07: Measure vector-store operations

**Status:** Implementation complete (dev2) — awaiting tester verification
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 vector coverage
**Decision coverage:** None

## User story and operational question

As the backend engineer, I need evidence that answers: **Is vector search, fetch, or indexing the bottleneck?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Cover actual Pinecone query/fetch/upsert/delete/batch operations and index readiness where used; keep embedding time separate.

## Acceptance criteria

- [ ] **OBS-P2-S07-AC1:** Each active vector operation records duration/outcome and approved bounded index alias/operation plus safe top-k/count metadata, never vectors, records, filters, or candidate identifiers.
- [ ] **OBS-P2-S07-AC2:** Not-found/empty results are distinct from timeout, rate-limit, authentication and provider failure; degraded matching remains visible when exceptions are caught upstream.
- [ ] **OBS-P2-S07-AC3:** Operation rate/error/duration metrics are queryable by feature; batches/retries distinguish logical operation and attempts without counting the same wrapper twice.
- [ ] **OBS-P2-S07-AC4:** Traces show embedding and Pinecone time as separate spans where both execute, and show only actual work on vector reuse/cache paths.

## Implementation notes (dev2)

- `src/telemetry/p2Operations.ts`: `withPineconeSpan` wraps each Pinecone SDK call; `withVectorstoreSpan` wraps logical operations.
- `src/services/vectorStore/pinecone.ts`: all public methods instrumented (query, upsert, fetch, delete, delete_many, delete_all, batch_upsert, describe_stats, init).
- `src/services/vectorStore/index.ts`: `indexJob`, `indexApplicant`, `calculateSemanticSimilarity` wrapped; embedding and Pinecone time as distinct child spans.
- `src/chains/matching.ts`: `calculateMatchScore` wraps semantic similarity; fallback (score=0) visible in trace.
- Caveat: Pinecone SDK may perform internal retries invisible to app-level spans — documented in schema-contract.md.
- Empty results (not-found) return success outcome, not error (AC2).

## Verification and completion evidence

Exercise query, fetch, upsert, empty result, timeout, and degraded matching with safe fixtures; inspect trace and metric totals.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md)

## Likely touchpoints

src/services/vectorStore/pinecone.ts; src/chains/matching.ts; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
