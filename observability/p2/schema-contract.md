# P2 Schema Contract — Dev2 Requirements

**Purpose:** Declares the new telemetry names and attribute values introduced by dev2 (S06–S10).
Orchestrator reads this to apply serial schema integration before typecheck/review.

## Span names (to add via registerSafeNames)

Dev2 calls `registerSafeNames` at module load in `src/telemetry/p2Operations.ts`.
The names below are registered there and pass the `NAME_RE` pattern.

```
pinecone.query          pinecone.upsert         pinecone.fetch
pinecone.delete         pinecone.delete_many     pinecone.delete_all
pinecone.batch_upsert   pinecone.describe_stats  pinecone.init
vectorstore.index       vectorstore.reindex      vectorstore.similarity_search
vectorstore.semantic_similarity
store.read              store.write
store.audit.read        store.audit.write        store.audit.append
scheduling.execute      scheduling.transition    scheduling.step
matching.score          matching.rebuild
```

Scope names added:
```
rec-app.p2    rec-app.store    rec-app.vectorstore    rec-app.scheduling
```

## Metric names (to add via registerSafeNames)

```
app.pinecone.operation.count      app.pinecone.operation.duration
app.store.operation.count         app.store.operation.duration
app.scheduling.execution.count    app.scheduling.transition.count
app.scheduling.duration
app.vectorstore.operation.count   app.vectorstore.operation.duration
app.ai.cost.estimated_usd         app.ai.usage.tokens
```

## Attribute contract

| Key              | Type         | Values used by dev2 |
|------------------|--------------|---------------------|
| `app.dependency` | SM enum_token| `pinecone`, `json_store`, `vectorstore`, `scheduling` |
| `app.operation`  | SM enum_token| `query`, `upsert`, `fetch`, `delete`, `delete_many`, `delete_all`, `batch_upsert`, `describe_stats`, `init`, `read`, `write`, `audit_read`, `audit_write`, `audit_append`, `execute`, `transition`, `step`, `index`, `reindex`, `similarity_search`, `semantic_similarity` |
| `app.outcome`    | SM oneOf     | see existing OUTCOMES list + new values below |
| `app.feature`    | SM pattern   | bounded vocabulary: `resume_parsing`, `job_description`, `candidate_communication`, `interview_scheduling`, `semantic_matching`, `job_indexing`, `applicant_indexing`, `job_search`, `applicant_search`, `vectorstore`, `vectorstore_init`, `reindex`, `semantic_rebuild`, `store` |
| `app.traffic`    | SM oneOf     | `synthetic` (set only for explicit fixture/test runs; not for production with simulated calendar) |
| `app.attempt`    | S intRange   | 1–100 (retry attempt index in scheduling steps) |
| `error.type`     | SM oneOf     | standard ErrorCategory values |

## Required SCHEMA additions in privacy.ts (orchestrator integration)

### app.outcome oneOf additions required

```typescript
// Add to OUTCOMES array in privacy.ts:
'partial',     // Partial success: operation returned but some items failed (e.g. rebuild with errors)
'degraded',    // Degraded: operation completed with reduced capacity/results
'empty',       // Explicit no-results outcome: query succeeded but returned zero matches (distinct from error)
'not_found',   // Explicit not-found: fetch/lookup confirmed the record does not exist (distinct from error)
'terminal',    // Scheduling: reached a terminal state (completed/cancelled/error)
'cancelled',   // Scheduling: explicitly cancelled workflow
'error',       // Returned terminal business failure
'wait',        // Scheduling: suspended pending human input (span ends; resumes as a new span)
```

**Usage:**
- `'partial'`: set by `chains/matching.ts rebuildSemanticIndex` when errors > 0
- `'empty'`: set by `pinecone.ts PineconeVectorStore.similaritySearch` via outcomeFn when results.length === 0
- `'not_found'`: set by `pinecone.ts PineconeVectorStore.getEntry` via outcomeFn when record undefined
- `'terminal'`, `'cancelled'`, `'wait'`: set by scheduling wrapper for state machine terminal transitions

These outcomes are integrated into privacy.ts for local synthetic validation; policy approval is still pending.
Tests verifying these outcomes are marked as pending schema integration in p2-test-coverage.md.

### New span-only attribute keys required

```typescript
// Add to SCHEMA in privacy.ts (span-only):
'app.workflow.run_id':     spec(S, pattern(/^[A-Za-z0-9_-]{8,64}$/))
  // Per-execution correlation ID for scheduling workflow; never a metric label.
'app.workflow.entry_point': spec(S, pattern(/^[a-z][a-z0-9_]{0,31}$/))
  // Entry point that initiated the workflow (e.g. 'api', 'cron', 'retry').
'app.store.io_class':      spec(S, oneOf('permission_denied', 'not_found', 'parse_error', 'io_error', 'ok'))
  // Bounded I/O classification for store errors; improves on generic 'internal'.
'app.query.topk':          spec(S, intRange(1, 10000))
  // Requested top-K for Pinecone query operations; safe bounded count.
'app.count_bucket':        spec(S, oneOf('0', '1-10', '11-50', '51+'))
  // Finite bucket for result count in Pinecone query operations; safe enumerated label.
```

The declared keys are integrated into privacy.ts. Additional static workflow name/version and integration.mode plus size/count buckets are span-safe; run IDs remain span-only.

**Note:** `app.count_bucket` and `app.query.topk` are result-derived attributes; `app.count_bucket` is a finite enum bucket and will work as a bounded metric label once added to SCHEMA.

## Cost module (src/telemetry/cost.ts)

- Exports `SYNTHETIC_USAGE_FIXTURES` — explicit fixture records, not production defaults.
- Exports `PRICE_CATALOGS` — two versions with effective dates; labeled NON-POLICY.
- `buildCostReport` aggregates by feature/date/model; uses logicalOperationId + completionOutcome
  for completedOps denominator (unique successfully completed logical operations).
- No reuse records in fixtures: reuse paths emit no UsageRecord (no billed API call).
- `CostReportFilter` supports: feature, model, provider, dateFrom, dateTo, environment, release.
- Partial coverage: records with cacheWriteTokens or reasoningTokens > 0 get priceCoverage='partial'
  (no approved policy values for these categories in the NON-POLICY catalog).
- No AI module imports — cost.ts is standalone.

## Feature vocabulary (finite, source-declared)

The `FEATURE_VOCAB` set in `p2Operations.ts` maps arbitrary context labels to a safe finite set.
Unknown labels from request context map to 'unknown' (not passed through).

```
Dev1 features (AI chains):   resume_parsing, job_description, candidate_communication
Dev2 features (infra):       interview_scheduling, semantic_matching, job_indexing,
                              applicant_indexing, job_search, applicant_search,
                              vectorstore, vectorstore_init, reindex, semantic_rebuild, store
```

## Files modified (dev2 slice)

```
src/telemetry/p2Operations.ts    (new)
src/telemetry/cost.ts             (new)
src/services/vectorStore/pinecone.ts  (instrumented)
src/services/vectorStore/index.ts     (instrumented)
src/models/store.ts               (instrumented)
src/chains/matching.ts            (instrumented)
src/agents/scheduling/agent.ts    (instrumented)
observability/p2/schema-contract.md  (new, this file)
observability/p2/cost-fixtures.json  (new)
scripts/observability-p2-fixtures.mjs     (new)
scripts/observability-p2-cost-report.mjs  (new)
scripts/observability-p2-verify.mjs       (new)
```

## Open gates

- **OBS-P2-S05** (cost policy decision) remains pending approval before cost report values can be used in budgets or alerts.
- **NFR-034** still blocks production mutation traffic and durable audit acceptance.
- **Schema integration**: local synthetic schema integrated; this does not approve production data policy.
- **Span-only diagnostics**: workflow run/entrypoint, I/O class, top-K, count/size buckets and primary index alias; no record payloads or candidate IDs.
- SDK hidden retry caveat: Pinecone SDK may perform transparent retries; `app.attempt` on spans reflects application-level retry calls, not SDK-internal retries.
- No durable continuation: scheduling state cannot resume across process restart; no long-lived spans are held open across human waiting (each execution span ends immediately).
- Provider reconciliation: no real provider invoice is available; no tolerance approved (OBS-P2-S05).

## Verifier command (exact)

```sh
# Prerequisite: docker compose -f observability/local/docker-compose.yml up -d
node --import tsx scripts/observability-p2-verify.mjs
```

The verifier runs the fixture driver (all scenarios) with OTLP export, waits 4 s for ingestion,
then asserts Jaeger span presence and Prometheus counter/histogram metrics. Exits 0 on all pass.

## Integration additions (2026-10-20)

`app.workflow.name=interview_scheduling`, `app.workflow.version=1`, and `app.integration.mode=simulated|live` distinguish workflow identity from fixture traffic. `app.size_bucket` uses 0/1-1024/1025-65536/65537+ bytes and `app.count_bucket` uses 0/1-10/11-50/51+. `app.index.alias=primary` exposes no configured index name. These are technical local defaults awaiting the existing governance gate.
