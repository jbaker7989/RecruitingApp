# OBS-P1-T02: Request population, cardinality and context isolation

**Priority:** P0 | **Status:** Local checks pass; preview pending
**Parent:** [P1 baseline](../../../features/observability/feature-observability-p1-baseline-tracing.md)
**Verification owner:** Independent test engineer; root integrates and runs hosted acceptance.

## Acceptance coverage

S03-AC1–AC3; S05-AC1–AC4; S08-AC1–AC3. Full per-AC mapping and current evidence are in [P1 test coverage](../../../features/observability/p1-test-coverage.md).

## Reproducible fixtures

Run a real localhost Express fixture through the production middleware. Manifest: 200, 401, 422, handled 503, thrown 500, disconnect, unknown paths and varied route identifiers. Assert one duration/count per eligible terminal request, including finish+close, and no raw ID/path labels. Repeat with trace sampling zero; inspect SDK histogram count/sum/bounds and bounded outcome series. Interleave asynchronous concurrent requests and dependency calls; match each child/log to its own server/request context. Import bootstrap twice and check one pipeline; separately exercise compiled entrypoint.

## Pass conditions

Exact population/error totals; duration seconds with plausible monotonic values; bounded series under 100 distinct raw paths; unique traces for concurrent public requests; no listener merely on app import. Dev/compiled checks supplement, never replace Vercel evidence.

## Automation / evidence

tests/observability-http.test.ts. Use repository Node test/tsx tooling and official OpenTelemetry SDKs. Assertions inspect observable results; no source-text assertions or mocks implementing the expected telemetry behavior. Local protocol exporters/servers are controlled dependency boundaries, not replacements for the SDK.

Record command, outcome, fixture counts, revision/environment, sanitized artifacts and reviewer. A test story is not complete until its required evidence exists. Never skip failures to claim a pass. Root owns full regression/build/CI and Vercel deployment.

## Current verification (2026-10-19)

Local mixed HTTP manifest, zero-sampling population, 100-path cardinality, concurrent child context, and disconnect checks pass. Compiled/Vercel cold-warm and backend percentile/rate proof remain open. See the [44-AC ledger](../../../features/observability/p1-test-coverage.md) for criterion status and command results.
