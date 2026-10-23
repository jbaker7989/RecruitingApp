# OBS-CICD-S01: Define Docker CI and delivery boundaries

**Status:** Proposed — not implemented
**Priority:** P0 | **Type:** Decision
**Accountable role:** Platform lead + security + release owner (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Decision before publication or hosting changes; provisional CI work may proceed.

## User story

As a release owner, I need an explicit Docker execution and delivery contract so that integration checks do not silently change the hosting architecture.

## Acceptance criteria

- [ ] **OBS-CICD-S01-AC1:** Record approved runner type, supported Docker/Compose versions and architecture, named maintainer, job timeout, resource/concurrency limits, CI-minute budget, evidence retention and required-check names. Each unresolved value has an owner role, decision deadline or trigger, and a specific blocked gate; no invented approvals.
- [ ] **OBS-CICD-S01-AC2:** Adopt a proposed default of ephemeral CI containers for the existing synthetic observability stack, with Vercel retained for application delivery. Decide separately whether an application image is test-only, published to a registry, or deployed to a container host; document rationale, registry/access/retention and deployment target if selected. Unknown publication/hosting choices block only those actions, not local-stack CI development.
- [ ] **OBS-CICD-S01-AC3:** Document PR/fork, trusted branch, merge and manual-release event behavior, existing Vercel auto-deploy behavior, and how required checks prevent promotion. Distinguish an automatically built Preview from an accepted release; record how the selected strategy is enforced rather than assuming a green check gates Vercel.

## Dependencies

None; inspect the existing workflow and local stack.

## Verification

Review the decision record against repository workflow and Vercel configuration metadata; capture approver, date, concrete values and linked downstream updates.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

Decision record; .github/workflows/ci.yml inventory; Vercel deployment settings metadata. Split implementation further if discovery crosses independently testable boundaries.
