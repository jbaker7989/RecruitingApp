# OBS-CICD-S04: Exercise collector failure and recovery in CI

**Status:** Proposed — not implemented
**Priority:** P1 | **Type:** Implementation / verification
**Accountable role:** QA + platform engineer (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Required before Docker-backed delivery is accepted.

## User story

As an operator, I need repeatable container-backed failure evidence showing telemetry failures do not break normal application requests.

## Acceptance criteria

- [ ] **OBS-CICD-S04-AC1:** Run deterministic scenarios for collector unavailable, slow or failed export, backend unavailable and recovery. Assert normal request status/body contracts are preserved, export diagnostics show positive failure evidence, and shutdown/flush obey the configured deadline. A never-exported or stale status is inconclusive, not proof of failure handling.
- [ ] **OBS-CICD-S04-AC2:** Assert recovery using fresh persisted telemetry after restoring service. Distinguish attempted/received exports from persisted records and queue drops from exporter failures. Exercise bounded queue saturation with explicit loss evidence; report delivery gaps rather than treating recovery as lossless delivery.
- [ ] **OBS-CICD-S04-AC3:** Record request count/concurrency, duration percentiles, memory, queue/drop diagnostics and flush duration per scenario. Enforce only approved budgets from the decision record; keep the existing unresolved 1.74x healthy-export overhead finding visible. Do not lower limits, retry until green or mark unapproved performance thresholds accepted.

## Dependencies

- [OBS-CICD-S03](story-obs-cicd-s03-docker-telemetry-ci.md)

## Verification

Repeat the deterministic failure suite on clean runs; inject a failure in the fail-open assertion and confirm the job fails. Record artifact evidence and configured bounds.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

Fault-scenario script; CI workflow; sanitized fault report. Split implementation further if discovery crosses independently testable boundaries.
