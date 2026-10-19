# OBS-P1-T01: Privacy and propagation boundaries

**Priority:** P0 | **Status:** Local RED — cardinality defect; policy pending
**Parent:** [P1 baseline](../../../features/observability/feature-observability-p1-baseline-tracing.md)
**Verification owner:** Independent test engineer; root integrates and runs hosted acceptance.

## Acceptance coverage

S02-AC1, S02-AC3–AC4; S04-AC1–AC5. Full per-AC mapping and current evidence are in [P1 test coverage](../../../features/observability/p1-test-coverage.md).

## Reproducible fixtures

Inject unique synthetic resume, email, OAuth code/state/token, Redis key/value, model output and exception message/stack markers into success and failure paths. Inspect actual finished SDK spans, collected metric attributes, structured logs and exporter diagnostics. None of the markers may survive. Send malformed/oversized traceparent, baggage and request IDs; verify fresh bounded context and bounded metric series. Capture outgoing headers on an allow-listed localhost dependency and a denied destination; only the approved propagation fields may cross.

## Pass conditions

Zero canary occurrences in every captured signal; bounded approved attributes; no raw exception events, links or resource fields escaping filtering. Approved privacy policy, retention and hosted ACL checks remain separate.

## Automation / evidence

tests/observability-privacy.test.ts. Use repository Node test/tsx tooling and official OpenTelemetry SDKs. Assertions inspect observable results; no source-text assertions or mocks implementing the expected telemetry behavior. Local protocol exporters/servers are controlled dependency boundaries, not replacements for the SDK.

Record command, outcome, fixture counts, revision/environment, sanitized artifacts and reviewer. A test story is not complete until its required evidence exists. Never skip failures to claim a pass. Root owns full regression/build/CI and Vercel deployment.

## Current verification (2026-10-19)

Local SDK payload canary, resource/link filtering, and allow/deny propagation checks pass. A new 100-request-ID metric fixture fails: final export contains 100 points with identical sanitized labels. Keep T01 open until the foundation fix passes and S02 approval/hosted checks are recorded. See the [44-AC ledger](../../../features/observability/p1-test-coverage.md) for criterion status and command results.
