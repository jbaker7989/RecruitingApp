# OBS-P2-T01: AI attempts, usage, and exported privacy

**Priority:** P0 | **Status:** Test design; execution pending
**Parent:** [P2 feature](../../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Coverage:** S02-AC1–AC4, S03-AC1–AC4, S04-AC1–AC4; feature AC2 and AC4.

## Fixtures and assertions

Use the actual instrumented chat and embedding entry points with fake provider responses and the official in-memory OpenTelemetry SDK exporters behind the production sanitizer. Exercise OpenAI and Anthropic usage shapes; reported input, output, cache and reasoning categories; missing usage; a failed attempt with reported usage; retry, timeout and abort; provider success followed by invalid JSON/schema; query/document/batch embeddings; and reused vectors. Compare metric deltas with traces sampled and unsampled. Assert original error identity and invocation count, rather than an invented SDK retry count. Run a unique synthetic prompt, output, applicant ID, vector, token and exception-message canary through exported spans, events, links, metrics, resources and logs; no canary may survive.

## Pass conditions and limits

Attempt and logical counts remain separate. Reported usage is counted once per observed attempt regardless of sampling; unknown is explicit and never zero-filled. Embedding model attribution is the actual `text-embedding-3-small` client. Parent spans end on every outcome and exported signal has bounded labels. A fake SDK boundary proves application instrumentation, not provider-internal retries or billing. Record exact command, revision, fixture count, expected/observed values and reviewer in the [coverage ledger](../../../features/observability/p2-test-coverage.md).

## Independent Codex tester result — 2026-10-20

Local synthetic T01 passes: `npm run test:observability:p2` 43/43 and `npm test` 338/338. Exact test cases include `a direct rejected factory attempt records unknown usage exactly once`, `logical usage callback and factory response account for one paid call`, `LangChain standard details split input`, both `throwing tracer`/`throwing span` fail-open cases, and `real resume chain separates one provider attempt`. The real backend produced 3 logical AI calls, 3 attempts, 36 reported tokens, 2 known-usage calls and 1 unknown-usage call; Jaeger showed a successful provider attempt followed by `json_failure` on the logical call. The private fixture canary was absent from 14 exported traces in `p2-verify-4a7ae971`. These fakes cannot establish live provider billing, hidden SDK retries or streaming usage. The direct HTTP test `caught malformed model output marks an HTTP 200 request as validation failure` confirms the root span and histogram carry `validation_error`.
