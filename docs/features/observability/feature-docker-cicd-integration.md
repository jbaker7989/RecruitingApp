# OBS-CICD: Integrate Docker into CI/CD

**Status:** Proposed — stories only; no pipeline changes implemented
**Scope:** Follow-up to the observability baseline and OBS-P1-S11.

## Problem and outcome

The repository has a local Compose stack for Collector, Jaeger, Prometheus, Loki and Grafana, but Observability P1 CI currently runs only npm install, typecheck, lint, build, tests and smoke. The desired outcome is repeatable backend integration evidence on GitHub Actions, explicit failure/security gates, and delivery of the same tested revision.

Use ephemeral synthetic-data containers for CI as the starting proposal. Keep Vercel as the application deployment target. Application-image publication or another container host requires S01's explicit decision. Docker CI does not repair missing Vercel secrets or provide durable production storage.

## Prioritized stories and dependency order

| Story | Priority | Dependencies |
|---|---|---|
| [OBS-CICD-S01: Define Docker CI and delivery boundaries](../../stories/observability/story-obs-cicd-s01-docker-delivery-decision.md) | P0 | None |
| [OBS-CICD-S02: Start an isolated Docker stack in GitHub Actions](../../stories/observability/story-obs-cicd-s02-docker-stack-ci.md) | P0 | S01 |
| [OBS-CICD-S03: Verify persisted telemetry through Docker backends](../../stories/observability/story-obs-cicd-s03-docker-telemetry-ci.md) | P0 | S02 |
| [OBS-CICD-S04: Exercise collector failure and recovery in CI](../../stories/observability/story-obs-cicd-s04-docker-faults-ci.md) | P1 | S03 |
| [OBS-CICD-S05: Verify Docker image provenance and secret isolation](../../stories/observability/story-obs-cicd-s05-docker-image-security.md) | P0 | S01 |
| [OBS-CICD-S06: Gate delivery on Docker evidence and retain diagnostics](../../stories/observability/story-obs-cicd-s06-docker-release-gates.md) | P0 | S03, S04, S05 |
| [OBS-CICD-S07: Build and publish an application image if approved](../../stories/observability/story-obs-cicd-s07-docker-app-image.md) | P2 | S01, S05 |

Order: S01 establishes the contract; S02 and S05 can proceed independently after their inputs are known; S03 follows stack startup, S04 adds failure evidence, and S06 makes the results enforceable delivery gates. S07 is conditional and can proceed after its decision/security prerequisites. P0 means blocking safe Docker delivery; P1 is required failure/recovery coverage; P2 is conditional application-image scope.

## Feature acceptance and checkpoints

- **OBS-CICD-AC1:** Fresh isolated Docker services start and are cleaned up on supported CI events (S01, S02).
- **OBS-CICD-AC2:** Real persisted signals and deterministic failure/recovery results are verified for the current revision (S03, S04).
- **OBS-CICD-AC3:** Reviewed immutable images, security policy and secret isolation are enforced (S05).
- **OBS-CICD-AC4:** Failed or missing checks block the approved delivery path, with safe evidence and revision matching (S06).
- **OBS-CICD-AC5:** Application-container scope has an explicit disposition; an adopted artifact is tested and promoted by digest (S01, S07).

Checkpoint 1: S01/S02/S05 reviewed and a clean stack run verified. Checkpoint 2: S03/S04 positive and negative scenarios independently verified. Checkpoint 3: S06 required-check enforcement and actual hosted acceptance demonstrated; otherwise keep the affected gates open.

## Decisions still open

S01 owns runner architecture, supported versions, budgets/timeouts, named owner, retention, required-check names, registry and application-image purpose, plus the exact Vercel promotion strategy. S05 owns vulnerability policy and exception approval. Do not invent numerical budgets or claim approval. Existing S01/S02 observability governance, S11 private Preview configuration, performance acceptance and NFR-034 durability remain separate gates.

## Evidence contract

Each of the 21 story ACs must have a recorded pass, fail, pending or approved conditional disposition with a linked artifact and reviewer. Plans and mock fixtures are not hosted proof. No actual pipeline tests have been run for this documentation-only proposal.
