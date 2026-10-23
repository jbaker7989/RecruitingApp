# OBS-CICD-S06: Gate delivery on Docker evidence and retain diagnostics

**Status:** Proposed — not implemented
**Priority:** P0 | **Type:** Implementation / verification
**Accountable role:** Release engineer + QA (named assignee pending)
**Parent feature:** [Docker CI/CD integration](../../features/observability/feature-docker-cicd-integration.md)
**Release gate:** Required before Docker-backed delivery is accepted.

## User story

As a release owner, I need a failed Docker check to block the selected delivery path and enough safe evidence to diagnose it.

## Acceptance criteria

- [ ] **OBS-CICD-S06-AC1:** Configure stable required checks and the approved delivery dependency chain for the exact revision. Prove failed, cancelled or missing integration/security checks prevent merge or promotion as specified in S01. Handle documentation-only paths without permanently pending checks or silently skipping relevant changes; existing quality gates remain required.
- [ ] **OBS-CICD-S06-AC2:** Upload sanitized reports and bounded service diagnostics on failure as well as success, before teardown when possible. Record image digests, SHA, timestamps, step durations and query/failure summaries. Enforce the approved artifact retention/access policy; redaction failure blocks artifact publication and reports a safe diagnostic.
- [ ] **OBS-CICD-S06-AC3:** For Vercel delivery, verify the deployed revision matches tested evidence and run the S11 preflight/hosted checks after private configuration. Keep promotion blocked while S11 or other mandatory gates remain open. Rehearse rollback to a reviewed revision with its own configuration checks; container CI success never constitutes hosted runtime acceptance.

## Dependencies

- [OBS-CICD-S03](story-obs-cicd-s03-docker-telemetry-ci.md)
- [OBS-CICD-S04](story-obs-cicd-s04-docker-faults-ci.md)
- [OBS-CICD-S05](story-obs-cicd-s05-docker-image-security.md)

## Verification

Demonstrate one successful flow and failure/cancellation/missing-check flows in a test PR or controlled workflow. Verify artifact access, retention and revision matching; record hosted portions as blocked until prerequisites exist.

Record revision, environment, expected/actual outcome, sanitized evidence and reviewer for each AC. Preserve existing application checks. Unperformed hosted or administrative checks remain pending; a green local test does not satisfy them.

## Likely touchpoints

GitHub required checks/rules; workflow artifact and deploy dependency steps; delivery runbook. Split implementation further if discovery crosses independently testable boundaries.
