# OBS-CICD-S02: Start an isolated Docker stack in GitHub Actions

**Status:** Proposed — not implemented
**Priority:** P0 | **Type:** Implementation
**Accountable role:** Platform engineer (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Required before Docker-backed delivery is accepted.

## User story

As a developer, I need each CI run to start a fresh synthetic stack so that integration failures are reproducible and independent of other runs.

## Acceptance criteria

- [ ] **OBS-CICD-S02-AC1:** Add a dedicated Compose integration job to Observability P1 CI while preserving typecheck, lint, build, unit tests and smoke. Validate Compose configuration and record runner/Docker/Compose versions. Use the approved versions and bounded startup/job timeouts; startup failure must fail the job.
- [ ] **OBS-CICD-S02-AC2:** Use unique project/run identifiers, fresh data and log directories, and isolated networks. Resolve fixed host-port conflicts explicitly. Wait for actual Collector/Jaeger/Prometheus/Loki readiness with bounded probes rather than a fixed sleep; document whether Grafana is needed for automated checks or excluded through a CI profile.
- [ ] **OBS-CICD-S02-AC3:** Run teardown and removal of run-owned containers, networks and volumes after success or failure; handle cancellation with best-effort cleanup and runner disposal. Demonstrate consecutive and concurrent runs do not share evidence. No production credentials, repository .env, applicant data, privileged mode or Docker socket mount is available inside application/stack containers.

## Dependencies

- [OBS-CICD-S01](story-obs-cicd-s01-docker-delivery-decision.md)

## Verification

Exercise clean startup, unavailable image, readiness timeout, failed assertion and cancellation. Retain sanitized outcomes and show cleanup affects only this run.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

CI workflow; CI Compose override/profile; bounded readiness/cleanup helper. Split implementation further if discovery crosses independently testable boundaries.
