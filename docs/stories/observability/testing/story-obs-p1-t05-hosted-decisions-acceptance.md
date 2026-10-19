# OBS-P1-T05: Decision and hosted evidence gates

**Priority:** P0 | **Status:** Blocked — approvals and hosted evidence pending
**Parent:** [P1 baseline](../../../features/observability/feature-observability-p1-baseline-tracing.md)
**Verification owner:** Independent test engineer; root integrates and runs hosted acceptance.

## Acceptance coverage

S01-AC1–AC4; S02-AC1–AC4; hosted portions of S03–S10. Full per-AC mapping and current evidence are in [P1 test coverage](../../../features/observability/p1-test-coverage.md).

## Reproducible fixtures

Review proposed backend and data-policy options with owner/approver; do not convert proposals into approvals. Local isolated synthetic backend queries may establish proposed capability without production approval. Under the existing preview authorization, root deploys synthetic preview and a second engineer repeats trace, histogram, log, dependency, health, export-failure and overhead queries. Inspect access denial/retention, dashboard empty/no-data rendering and inventory. Record every unresolved gate.

## Pass conditions

Named approver/date, actual plan/region/cap, numerical data and performance policies plus sanitized preview queries/revision/reviewer. Until present, S01/S02 and mandatory hosted P1 gates stay Proposed/Blocked. No paid account, production telemetry or applicant records are permitted by this test plan.

## Automation / evidence

Manual/decision verification; see ../../../features/observability/p1-test-coverage.md. Use repository Node test/tsx tooling and official OpenTelemetry SDKs. Assertions inspect observable results; no source-text assertions or mocks implementing the expected telemetry behavior. Local protocol exporters/servers are controlled dependency boundaries, not replacements for the SDK.

Record command, outcome, fixture counts, revision/environment, sanitized artifacts and reviewer. A test story is not complete until its required evidence exists. Never skip failures to claim a pass. Root owns full regression/build/CI and Vercel deployment.

## Current verification (2026-10-19)

S01/S02 options are proposals. Root reports local Jaeger/Prometheus/Loki query proof, but an independent artifact/reviewer is not yet recorded here. No approved destination, cost cap, retention/access policy, hosted preview acceptance or independent reviewer is claimed. See the [44-AC ledger](../../../features/observability/p1-test-coverage.md) for criterion status and command results.
