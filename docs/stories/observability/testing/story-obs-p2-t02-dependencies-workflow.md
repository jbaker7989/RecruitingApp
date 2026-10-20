# OBS-P2-T02: Dependency timing and workflow outcomes

**Priority:** P0 | **Status:** Test design; execution pending
**Parent:** [P2 feature](../../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Coverage:** S07-AC1–AC4, S08-AC1–AC4, S09-AC1–AC4; feature AC3 and AC6.

## Fixtures and assertions

Use actual Pinecone vector-store methods with a fake official-client boundary for query, fetch, upsert, delete, batch and readiness. Exercise empty/not-found, timeout, rate limit, auth failure and handled semantic fallback. Use an isolated temporary JSON store for read, write and audit append, including absent file, corrupt JSON, permission-like I/O failure, controlled delay and concurrent calls. Inspect parent/child structure and inclusive duration. Drive actual scheduling transitions, cancellation, invalid transition and completion with synthetic state; verify simulated calendar/email labels and no active span across human waiting. Trigger a partial rebuild and check that a successful HTTP result does not erase the degraded outcome.

## Pass conditions and limits

Metrics count each wrapper once and contain bounded operation/store/index/feature labels. No vector, record, filter, filename, applicant detail or raw exception escapes exported telemetry. Instrumentation preserves returned values and thrown object identity, does not trigger recursive audit writes, and does not add paid work on vector reuse. Durable continuation and NFR-034 are dependencies, not local test passes. Record command, revision, observed signal and reviewer in the [coverage ledger](../../../features/observability/p2-test-coverage.md).

## Independent Codex tester result — 2026-10-20

Local fake Pinecone, temporary JSON store and scheduling tests pass in the 43/43 focused suite. Tests assert `empty`/`not_found`/timeout outcomes, safe top-k/count/size/I/O buckets, audit append parentage, simulated workflow name/version/mode, cancellation, terminal replay state and privacy. Current real backend service `rec-app-p2-p2-verify-4a7ae971` exported 5 Pinecone, 12 store and 1 scheduling execution metric observations, with 14 traces/30 spans. Invalid replay now emits an ended OTel ERROR `scheduling.transition` span while preserving the exact exception and caller state; Docker P2 verifier is 27/27. Earlier round 1 failed 26/27 before the source fix. Permission/concurrency/no-recursive-audit tests, durable continuation and NFR-034 production acceptance remain open.
