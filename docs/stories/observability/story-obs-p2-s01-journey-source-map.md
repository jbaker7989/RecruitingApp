# OBS-P2-S01: Journey Source Map — Instrumentation Decisions and Semantics

**Document type:** Decision evidence and path inventory
**Story:** [OBS-P2-S01](story-obs-p2-s01-journey-instrumentation-contract.md)
**Status:** Proposed — product/engineering approval pending (feature AC1)
**Created:** 2026-10-19
**Author:** Dev1 (implementation sub-agent)

---

## 1. Path Inventory (OBS-P2-S01-AC1)

### 1a. Resume Parsing Journey

```
POST /agents/resume-parse
  → src/routes/agents/*.ts  (HTTP span via undici auto-instrumentation + telemetryMiddleware)
  → src/chains/resumeParsing.ts :: parseResume(resumeText)
      → traceAIInvocation({ feature:'resume_parsing', task:'resume_parsing', provider:'openai', model:'gpt-4o' })  [outer span: ai.chat]
          → InstrumentedChatOpenAI.invoke(prompt)        [inner span: ai.chat, child]
              → ChatOpenAI.prototype.invoke()            [network: undici auto-instrumentation]
          → JSON.parse / ParsedResumeSchema.parse(zod)   [parse step; failure → ctx.markParseOutcome]
  → parseResumeFromBuffer(buffer, mimeType)
      → extractTextFromPDF / extractTextFromDOCX        [no AI call; I/O only]
      → parseResume(text)                               [as above]
```

No Pinecone call. No store write (route layer handles persistence independently).

### 1b. Job Description Generation Journey

```
POST /agents/jd-generator
  → src/routes/agents/jdGenerator.ts
  → src/chains/jobDescription.ts :: generateJobDescription(input, companyCtx)
      → traceAIInvocation({ feature:'job_description', task:'job_description', provider:'openai', model:'gpt-4o' })
          → InstrumentedChatOpenAI.invoke(formattedPrompt)
          → parseJsonResponse / JDGOutputSchema.parse    [parse step]
  → generateJobDescriptionVariants(baseOutput, tones, input)
      → N × generateJobDescription(variantInput)        [each is a separate traceAIInvocation]
```

Scheduling is a simulated state machine (no model call; see S09). No embedding in this journey.

### 1c. Candidate Communication Journey

```
POST /agents/candidate-communication
  → src/routes/agents/candidateCommunication.ts
  → src/chains/candidateCommunication.ts :: generateCandidateMessage(input)
      → traceAIInvocation({ feature:'candidate_communication', task:'communication', provider:'anthropic', model:'claude-3-5-sonnet' })
          → InstrumentedChatAnthropic.invoke(formattedPrompt)
          → parseJsonResponse / CCOutputSchema.parse     [parse step]
  → generateMessageVariants(baseInput, tones)
      → N × generateCandidateMessage(variantInput)      [each is a separate traceAIInvocation]
```

### 1d. Matching / Embedding Journey

```
GET /applications/match or POST /applicants/:id/match
  → src/chains/matching.ts :: matchApplicantToJobs
  → src/services/vectorStore/index.ts :: indexJob / indexApplicant
      → InstrumentedEmbeddings.embedQuery(text)         [span: ai.chat.attempt (attempt) + ai.embed]
      → PineconeVectorStore.addEntry(...)                [Pinecone span: dev2 scope]
  → findSimilarJobsForApplicant / findSimilarApplicantsForJob
      → store.getEntry(applicant_<id>)                  [Pinecone FETCH: dev2 scope]
      → store.similaritySearch(embedding, ...)           [Pinecone QUERY: dev2 scope]
      (no embeddings API call; stored embedding reused — no ai.embed span on this path)
  → calculateSemanticSimilarity
      → cosineSimilarity (local math; no AI call; no span)
```

**Key finding (OBS-P2-S01-AC4, corrected):** `findSimilarJobsForApplicant` calls two distinct Pinecone operations:
1. `store.getEntry(applicant_<id>)` — a Pinecone **fetch** that retrieves the applicant's stored vector
2. `store.similaritySearch(embedding, ...)` — a Pinecone **query** using that stored vector

The applicant's embedding is reused from the index; no re-embedding call is made. Only `indexJob` and `indexApplicant` trigger `embedQuery`. Counters will NOT double-count reused vectors. A prior version of the flow map incorrectly listed only "fetch" for `findSimilarJobsForApplicant`; the source confirms it is **fetch + query**.

### 1e. Login / OAuth Journey

Covered by P1 providerOps.ts (`oauth.login.callback`, `oauth.token_exchange`, `oauth.userinfo`). No new AI spans in this journey.

---

## 2. Semantic Definitions (OBS-P2-S01-AC2)

### Logical operation vs. attempt

| Concept | Span | Metrics | Duration measures |
|---|---|---|---|
| Logical operation | `ai.chat` (outer, from `traceAIInvocation`) | `app.ai.invocation.count/duration` | Model call + output parse |
| Provider attempt | `ai.chat.attempt` (inner, from `InstrumentedChatOpenAI/Anthropic.invoke`) | `app.ai.attempt.count/duration` | HTTP round-trip to model API |
| Embedding attempt | `ai.embed` (from `InstrumentedEmbeddings`) | `app.ai.invocation.count/duration` | HTTP round-trip to embeddings API |

The outer `ai.chat` span is the application-level outcome including parse; its metrics count logical invocations. The inner `ai.chat.attempt` span is the provider-call attempt; its metrics count actual provider calls. These spans are distinguishable by name to avoid confusion when both appear in the same trace. `app.ai.invocation.duration` is recorded once (outer) and `app.ai.attempt.duration` once (inner) per chain call — no double-recording.

### Active execution vs. waiting

- **Active:** All spans are active execution. No span represents queue wait time.
- **Waiting:** Scheduling state-machine waits (human decisions, calendar slots) are NOT spans. The scheduling agent uses simulated state transitions without model calls; no spans open across human-wait intervals. (OBS-P2-S09 scope)

### Timeout and cancellation

- Provider-level timeout: `error.type: timeout`, `app.outcome: timeout` on the inner `ai.chat` span and outer span inherits via `classifyError`.
- Abort: `error.type: aborted`, `app.outcome: aborted`.
- Parse after provider success: `ai.parse_outcome: json_failure` or `schema_failure`; `error.type: parse` or `validation`.

### Partial success

- `generateJobDescriptionVariants` / `generateMessageVariants`: failures of individual tone variants are caught and logged but do NOT fail the outer operation. Each variant's failure is recorded in its own `traceAIInvocation` span.
- VectorStore rebuild partial: dev2 scope (S09).

### Outcome vocabulary (bounded)

`app.outcome` values used: `success`, `timeout`, `aborted`, `rate_limited`, `server_error`, `client_error`, `validation_error`, `other`.
`ai.parse_outcome` values: `success`, `json_failure`, `schema_failure`.
`ai.operation` values: `chat`, `embed_query`, `embed_batch`, `embed_document`, `other`.

---

## 3. Ownership and Deduplication (OBS-P2-S01-AC3)

| Span | Metric | Origin | Note |
|---|---|---|---|
| `ai.chat` | `app.ai.invocation.count/duration` | `traceAIInvocation` in chains | Logical operation, parse context; outer wrapper |
| `ai.chat.attempt` | `app.ai.attempt.count/duration` | `InstrumentedChatOpenAI/Anthropic.invoke` | Provider-call duration, token usage; inner per-call |
| `ai.embed` | `app.ai.invocation.count/duration` | `InstrumentedEmbeddings.embedQuery/embedDocuments` | Embedding duration; usage unknown (SDK limitation) |
| `oauth.token_exchange` / `oauth.userinfo` | — | `providerOps.ts` (P1) | Not duplicated in P2 |
| HTTP outbound | — | `@opentelemetry/instrumentation-undici` | Network spans for model API calls |

**Deduplication rules:**
- Token metrics (`app.ai.tokens`) are recorded once per inner `ai.chat.attempt` span in `wrapInvokeWithTelemetry`.
- Chains do NOT call `ctx.recordUsage()` when using the instrumented factory client, to avoid double-counting. `ctx.recordUsage` also has a guard preventing it from firing twice.
- `app.ai.invocation.count` is recorded once per `traceAIInvocation` call (outer `ai.chat` only).
- `app.ai.attempt.count` is recorded once per inner `ai.chat.attempt` call.
- For direct `getLLMClient().invoke()` calls without `traceAIInvocation`, attempt count IS recorded but invocation count is NOT. Monitoring can use attempt counts for those direct calls.

**SDK internal retry deduplication:** LangChain does not expose retry attempt hooks. Each observable `invoke()` call corresponds to one `ai.chat.attempt` span. If the underlying SDK retries internally (not exposed), those retries are unobservable and documented here rather than fabricated. (OBS-P2-S02-AC2)

---

## 4. Real Flow Coverage (OBS-P2-S01-AC4)

| Operation | Calls LLM | Calls Embeddings | Calls Pinecone | Calls Store |
|---|---|---|---|---|
| `parseResume` | ✓ gpt-4o | — | — | — |
| `generateJobDescription` | ✓ gpt-4o | — | — | — |
| `generateCandidateMessage` | ✓ claude-3-5-sonnet | — | — | — |
| `indexJob` / `indexApplicant` | — | ✓ text-embedding-3-small | ✓ upsert | — |
| `findSimilarJobsForApplicant` | — | — (reuse) | ✓ **fetch + query** | — |
| `findSimilarApplicantsForJob` | — | — (reuse) | ✓ **fetch + query** | — |
| `calculateSemanticSimilarity` | — | — (local math) | — | — |
| `scheduling agent` | — (simulated) | — | — | ✓ read + write + audit |

No single flow touches all three (LLM + Embeddings + Pinecone). Separate fixtures are needed to cover them. The plan confirms: "create separate acceptance fixtures if no single flow touches all three" — this confirms the fixture split is correct.

---

## 5. Open Decisions

- **Feature AC1 (product/engineering approval):** The operation definitions, outcome vocabulary, and feature/task boundaries above are a PROPOSED engineering default. They are NOT yet approved by the product owner + backend lead named in OBS-P2-S01.
- **VALID_FEATURES list:** Currently `{'resume_parsing', 'job_description', 'candidate_communication', 'matching', 'scheduling', 'vectorstore', 'application_submission', 'login', 'unknown'}`. Adding new features requires updating this set in `src/telemetry/ai.ts` via a code-review gate (static literals only).
- **Streaming paths:** Not covered. LangChain streaming (`streamEvents`, `stream`) does not go through `invoke()`. Tracked in OBS-P3-S12.
