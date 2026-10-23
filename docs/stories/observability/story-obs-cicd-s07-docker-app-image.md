# OBS-CICD-S07: Build and publish an application image if approved

**Status:** Proposed — not implemented
**Priority:** P2 | **Type:** Conditional implementation
**Accountable role:** Platform engineer (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Conditional on S01 adoption; never an implicit hosting migration.

## User story

As a platform engineer, I need a tested immutable application image only if the delivery decision adopts that artifact.

## Acceptance criteria

- [ ] **OBS-CICD-S07-AC1:** If S01 rejects an application image, record the approved disposition and close this conditional story as not adopted with no implementation claim. If adopted, add a multi-stage build using the lockfile and supported Node runtime, a restrictive .dockerignore, a non-root runtime and only necessary runtime assets including EJS views. Exclude secrets and real data from all layers/build context.
- [ ] **OBS-CICD-S07-AC2:** Test the built image, rather than only the host checkout: health, writable synthetic store, login view, synthetic session, unauthorized routes, telemetry export and termination behavior. Supply secrets at runtime through the approved secure mechanism. Document ephemeral storage limitations; do not claim a volume alone resolves NFR-034 durability.
- [ ] **OBS-CICD-S07-AC3:** Publish only from trusted events after tests/security gates pass, to the approved registry using least privilege. Record immutable digest, source SHA, SBOM and provenance; verify the digest consumed by any approved deployment. No mutable latest-only promotion. Container-host deployment requires an approved target and rollback procedure; do not assume the Vercel source deployment consumes this image.

## Dependencies

- [OBS-CICD-S01](story-obs-cicd-s01-docker-delivery-decision.md)
- [OBS-CICD-S05](story-obs-cicd-s05-docker-image-security.md)

## Verification

If adopted, build from a clean context, inspect layers with synthetic canaries, run image behavioral tests and verify registry/deployment digest provenance. Otherwise retain signed-off disposition.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

Dockerfile and .dockerignore; container smoke fixture; trusted image publication workflow. Split implementation further if discovery crosses independently testable boundaries.
