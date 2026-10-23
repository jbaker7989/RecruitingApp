# OBS-CICD-S05: Verify Docker image provenance and secret isolation

**Status:** Proposed — not implemented
**Priority:** P0 | **Type:** Security / automation
**Accountable role:** Security engineer + platform engineer (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Required before Docker-backed delivery is accepted.

## User story

As a security owner, I need reviewed container inputs and restricted CI permissions before Docker jobs become a release gate.

## Acceptance criteria

- [ ] **OBS-CICD-S05-AC1:** Inventory all stack images and any approved application base image; pin reviewed immutable digests with readable version annotations. Pin third-party Actions to reviewed commit SHAs. Define an update process that reruns integration tests and records licensing/support considerations.
- [ ] **OBS-CICD-S05-AC2:** Generate or obtain image inventory/SBOM and vulnerability results for the images actually used. Record scanner/database versions. Apply an explicitly approved severity/exploitability policy; exceptions require rationale, named approver and expiry. Demonstrate a disallowed finding blocks the job and an expired exception fails; an unknown policy remains a release gate.
- [ ] **OBS-CICD-S05-AC3:** Keep fork PR checks free of publishing/deployment credentials and avoid executing untrusted PR code in a privileged trusted event. Grant package write or deployment permissions only to the trusted job that needs them. Verify evidence/cache/image contents exclude .env, credentials, raw sensitive telemetry and applicant records with synthetic canaries; do not cache Docker data volumes.

## Dependencies

- [OBS-CICD-S01](story-obs-cicd-s01-docker-delivery-decision.md)

## Verification

Review effective workflow permissions and event trust boundaries. Test vulnerable-fixture policy rejection, expired exception and secret-canary rejection without publishing real secrets.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

Compose image references; CI permissions/scanning job; image policy/exception record. Split implementation further if discovery crosses independently testable boundaries.
