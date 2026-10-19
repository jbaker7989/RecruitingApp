# P1 integration and delivery evidence

Date: 2026-10-19. Scope: local synthetic telemetry implementation; production decisions remain open.

## Current verification

- `npm run typecheck`: pass.
- `npm run lint`: pass (warnings do not fail the repository's lint gate).
- `npm run build`: pass.
- `npm test`: **295 passed, 0 failed, 0 skipped**.
- `npm run smoke`: `smoke-health=ok`.
- `npm run telemetry:verify`: pass against local Collector, Jaeger, Prometheus and Loki. A unique synthetic service/release produced six fresh traces, exactly six histogram observations, a finite p95 result and one searchable structured startup log. Queries cannot pass using an earlier run's service identity.
- Two pre-aggregation metric regressions pass: forbidden keys and invalid values collapse to one correct metric series without losing counts. Export sanitization remains defense in depth.
- Failed exports produce a false flush result. Exact SDK queue-drop diagnostics are separate from exporter-level losses and may lag one batch.

## Isolated local load and failure evidence

[Machine-readable report](evidence/p1-local-load.json): compiled application, seven scenarios, 600 measured requests per scenario, concurrency 12, separate warm-up. Every response matched the expected status in every scenario. The run used temporary synthetic data and blank live-provider credentials.

Disabled p95 was 2.25 ms. Enabled healthy export was 3.92 ms (1.74x); restored export was 3.67 ms (1.63x). These exceed the **proposed, unapproved** 1.5x healthy-export threshold. Fault-case p95 ratios were 1.01–1.16x; shutdown remained bounded (maximum 1,025 ms for an unresponsive sink). Memory ratios stayed within the proposed limit.

This is evidence of an open performance-acceptance issue, not a pass obtained by changing the limit. Approve realistic absolute/relative budgets and validate on representative traffic before hosted acceptance. Received span counts are not claimed as successfully persisted spans when the sink returns failure or hangs. Delivery completeness and forced-termination loss remain pending.

## Vercel preview

Preview build succeeded: https://rec-app-build-e1xnqb2uy-jbaker7989-1641s-projects.vercel.app

Authenticated `/health` returned HTTP 500 `FUNCTION_INVOCATION_FAILED`. Project Preview configuration lacks both `JWT_SECRET` and `APPLICANT_JWT_SECRET`; `src/services/tokenService.ts` requires them during production-mode startup (existing NFR-056). No weakened authentication defaults or fabricated secrets were introduced. Configure separate strong secrets privately in Vercel Preview and redeploy before acceptance. Runtime logs did not provide an additional stack trace, so the missing required configuration is a confirmed blocker, not proof that no other preview defect exists.

The preview intentionally targets an unreachable loopback OTLP endpoint to test fail-open behavior and disallows remote export. It is not hosted telemetry-delivery proof. Local logs/data/credentials are excluded from upload via `.vercelignore`.

## Acceptance and remaining work

Implementation is reviewable; **P1 is not accepted for production**. S01/S02 provide proposed options, not approvals. Named ownership, destination/budget, retention/residency/access, approved performance/delivery budgets, real preview cold/warm/export evidence, real provider/Redis verification and operational dashboard acceptance remain open as specified by the story ledger. NFR-034 continues to block production mutation/audit durability.

The restart test agent independently audited all 44 story criteria. Its recorded RED results are historical and were resolved before the integrated 220-test run. Feature acceptance must not be inferred solely from green CI.

Preview configuration is tracked as [OBS-P1-S11 (P0 — Critical)](../../stories/observability/story-obs-p1-s11-vercel-preview-configuration.md). The user authorized proceeding with a draft PR while this gate remains blocked.

Latest integration includes origin/main OAuth identity verification, provider-bound state TTL, and dashboard redirects. All 295 tests pass after merge resolution, including the signed-JWT/JWKS observability fixture and provider-mismatch regression; typecheck, lint, build and smoke also pass. Local backend/load and hosted-preview evidence above predates this merge and is not a claim of hosted verification for the final revision.
