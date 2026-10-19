# OBS-P1-T03: Exporter failures, bounds and recovery

**Priority:** P0 | **Status:** Local checks pass; budgets/preview pending
**Parent:** [P1 baseline](../../../features/observability/feature-observability-p1-baseline-tracing.md)
**Verification owner:** Independent test engineer; root integrates and runs hosted acceptance.

## Acceptance coverage

S03-AC4; S07-AC1–AC5; S09-AC2, S09-AC4. Full per-AC mapping and current evidence are in [P1 test coverage](../../../features/observability/p1-test-coverage.md).

## Reproducible fixtures

Use real SDK processors with a controlled local exporter boundary. Inject timeout, failure, 401, 429 and network error; complete business requests while export is blocked. Overflow configured queue, inspect safe independent loss/freshness counters, release exporter and verify recovery. Exercise disable, bounded flush, repeated shutdown and forced child-process termination. Record enabled/disabled latency, throughput and memory on the same workload; no external endpoint.

## Pass conditions

Request behavior preserved; queue/diagnostics bounded; no recursive spans; shutdown finishes within the configured timeout; last success changes only on success. Numerical settings are test inputs, not approved production budgets; actual short Vercel invocations, loss and overhead remain pending.

## Automation / evidence

tests/observability-exporter.test.ts. Use repository Node test/tsx tooling and official OpenTelemetry SDKs. Assertions inspect observable results; no source-text assertions or mocks implementing the expected telemetry behavior. Local protocol exporters/servers are controlled dependency boundaries, not replacements for the SDK.

Record command, outcome, fixture counts, revision/environment, sanitized artifacts and reviewer. A test story is not complete until its required evidence exists. Never skip failures to claim a pass. Root owns full regression/build/CI and Vercel deployment.

## Current verification (2026-10-19)

Official SDK batch overflow reports exact queue loss separately from exporter failures; failed export returns false from the public flush API. Local OTLP/HTTP 200/401/429/503/hang, breaker, timeout and recovery tests pass. Approved budgets and Vercel loss/overhead measurements remain open. See the [44-AC ledger](../../../features/observability/p1-test-coverage.md) for criterion status and command results.
