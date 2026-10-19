# OBS-P1-T04: Dependency outcomes, safe logs and health

**Priority:** P1 | **Status:** Local checks pass; preview pending
**Parent:** [P1 baseline](../../../features/observability/feature-observability-p1-baseline-tracing.md)
**Verification owner:** Independent test engineer; root integrates and runs hosted acceptance.

## Acceptance coverage

S06-AC1–AC5; S08-AC1–AC4; S09-AC1–AC4. Full per-AC mapping and current evidence are in [P1 test coverage](../../../features/observability/p1-test-coverage.md).

## Reproducible fixtures

Exercise token exchange and userinfo independently against local protocol fixtures: success, cancellation, invalid config/state, timeout, DNS/connect/TLS errors, 429, 5xx and recovered retry. Assert logical-login and attempt counts separately; separate redirect/callback traces. Exercise optional Redis degradation/fallback and missing/expired state without changing security semantics. Capture logger output with/without spans and concurrency. Probe cheap liveness and readiness with required/optional dependency failures and stale exporter state; inspect runtime sample and unknown platform metrics.

## Pass conditions

Correct bounded taxonomy, safe duration/outcome, separate attempt/login counts, no raw state/key/token. Readiness fails only for required dependencies, never calls paid services and never asserts durable audit storage. Authorized backend search/dashboard and real provider/Redis preview proof remain pending.

## Automation / evidence

tests/observability-operations.test.ts. Use repository Node test/tsx tooling and official OpenTelemetry SDKs. Assertions inspect observable results; no source-text assertions or mocks implementing the expected telemetry behavior. Local protocol exporters/servers are controlled dependency boundaries, not replacements for the SDK.

Record command, outcome, fixture counts, revision/environment, sanitized artifacts and reviewer. A test story is not complete until its required evidence exists. Never skip failures to claim a pass. Root owns full regression/build/CI and Vercel deployment.

## Current verification (2026-10-19)

Local provider taxonomy, attempt versus login counters, opt-in and default-off callback links, readiness, runtime gauges and safe logs pass. Configured Redis/provider and hosted search/dashboard proof remain open. See the [44-AC ledger](../../../features/observability/p1-test-coverage.md) for criterion status and command results.
