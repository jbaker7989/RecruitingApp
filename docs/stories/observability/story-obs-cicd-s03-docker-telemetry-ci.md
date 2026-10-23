# OBS-CICD-S03: Verify persisted telemetry through Docker backends

**Status:** Proposed — not implemented
**Priority:** P0 | **Type:** Implementation / verification
**Accountable role:** QA + observability engineer (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Required before Docker-backed delivery is accepted.

## User story

As a reviewer, I need CI to prove the application emits searchable traces, metrics and logs through real backends.

## Acceptance criteria

- [ ] **OBS-CICD-S03-AC1:** Adapt scripts/telemetry-local-verify.mjs for the CI stack and run the built application with synthetic-only configuration. Identify each run by unique service/release and git SHA. Assert six fresh traces, exactly six request histogram observations, a finite duration percentile and the expected correlated structured log using actual backend queries; attach sanitized query criteria and observed counts.
- [ ] **OBS-CICD-S03-AC2:** Make absent, stale, duplicate or malformed evidence fail within a bounded deadline. Prove an earlier run cannot satisfy current queries and a disconnected collector cannot produce a false pass. Keep official SDK payload/privacy tests alongside backend verification; never substitute source-text matching or mocked backends for this job.
- [ ] **OBS-CICD-S03-AC3:** Produce a machine-readable report with revision, run identity, image digests, query windows, expected/actual values and per-check status. Check synthetic privacy canaries across collected signals and sanitized artifacts. Backend success establishes CI integration only; it does not close S11 hosted, real-provider, residency, durability or performance acceptance.

## Dependencies

- [OBS-CICD-S02](story-obs-cicd-s02-docker-stack-ci.md)

## Verification

Run a healthy stack plus negative cases for stale identity and blocked export. Inspect actual Jaeger, Prometheus and Loki results and report failure exit codes.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

Telemetry verification script; CI workflow; integration fixtures/report format. Split implementation further if discovery crosses independently testable boundaries.
