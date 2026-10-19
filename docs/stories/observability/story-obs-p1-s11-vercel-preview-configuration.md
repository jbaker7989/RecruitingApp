# OBS-P1-S11: Configure and verify the Vercel Preview runtime

**Status:** Blocked — configuration and hosted verification pending
**Phase:** P1 | **Type:** Configuration / verification | **Priority:** P0 — Critical
**Priority rationale:** The preview currently fails at runtime, blocking hosted P1 acceptance.
**Accountable role:** Vercel project administrator + QA (named owners pending)
**Created:** 2026-10-19
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** Mandatory before preview acceptance or P1 completion; draft PR may proceed.

## User story

As a reviewer, I need a securely configured synthetic-data Preview so that I can verify the deployed application and observability behavior without production credentials or applicant data.

## Problem and scope

The rec-app-build preview builds but returns HTTP 500 FUNCTION_INVOCATION_FAILED. JWT_SECRET and APPLICANT_JWT_SECRET are absent from its Preview environment; production-mode token initialization requires both. Configure the Preview environment through Vercel's secure configuration UI or approved secret-management tooling. This prerequisite is confirmed; other runtime failures may become visible after it is resolved.

## Acceptance criteria

- [ ] **OBS-P1-S11-AC1:** A named project administrator configures separate, strong, independently generated JWT_SECRET and APPLICANT_JWT_SECRET values, each at least 32 characters, scoped to Preview and available to the PR branch. No values appear in chat, source, CI output, screenshots, or evidence; production secrets are not reused.
- [ ] **OBS-P1-S11-AC2:** Redeploy the PR revision after configuration; record revision, preview URL, configuration scope, timestamp, and verifier without secret values. Build and runtime startup succeed with existing secret validation intact.
- [ ] **OBS-P1-S11-AC3:** Verify deployed /health returns its expected successful response; test a synthetic authentication/session flow and protected-route rejection. Record expected/actual statuses and sanitized evidence, and investigate remaining runtime errors rather than assuming secrets were the sole cause.
- [ ] **OBS-P1-S11-AC4:** Verify readiness and authorized telemetry diagnostics in the deployed runtime, including denial without authorization. With the collector unavailable, normal requests still succeed and bounded export/flush diagnostics reflect failure. No live provider credentials or real applicant data are required.
- [ ] **OBS-P1-S11-AC5:** Assign a named owner and document Preview secret replacement/redeployment and rollback procedures without values. Review deployment protection and Preview environment isolation; do not weaken authentication or disable secret validation to pass acceptance.
- [ ] **OBS-P1-S11-AC6:** Attach sanitized hosted results to the P1 acceptance ledger. Keep remote telemetry persistence, approved destination/governance, and performance gates open until their separate evidence passes; successful configuration alone does not complete P1.

## Dependencies and verification

Depends on a Vercel project administrator and [S03 runtime bootstrap](story-obs-p1-s03-runtime-bootstrap.md). Unblocks hosted checks in [S07 export reliability](story-obs-p1-s07-export-reliability.md) and [S10 acceptance](story-obs-p1-s10-baseline-acceptance.md). QA repeats the checks against the deployed revision; local tests cannot satisfy these hosted ACs. See [delivery evidence](../../features/observability/p1-delivery-evidence.md) for current limitations.
