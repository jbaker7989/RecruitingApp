# OBS-P2-T03: Synthetic cost reports and independent diagnosis

**Priority:** P1 | **Status:** Test design; execution pending
**Parent:** [P2 feature](../../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Coverage:** S06-AC1–AC4, S10-AC1–AC4; feature AC5 and AC7.

## Fixtures and assertions

Feed explicit synthetic usage records to the report API. Cross an effective-date price change and model alias, include one retry, a failed billed attempt, unknown usage and an unknown price. Filter environment, feature, provider/model and release; verify daily totals, completed-logical-operation denominator and visible coverage. Check calculation independently using integer token counts and exact decimal examples documented with the fixture. A discrepancy may be reported, but no unapproved reconciliation tolerance or ticket is fabricated.

Inject a slow model, slow store, Pinecone timeout, malformed model output and caught fallback. An independent reviewer should use saved telemetry queries or local equivalents to locate each cause and distinguish overlapping child spans from request elapsed time. Capture p50/p95/p99 only from histograms with stated units/buckets. Missing or sampled traces and sparse data are visible. Record exact revision, dataset, sanitized query, expected/observed diagnosis and reviewer in the [coverage ledger](../../../features/observability/p2-test-coverage.md).

## Independent Codex tester result — 2026-10-20

`npm run telemetry:p2:cost-report` passes with 11 synthetic records and 75µ$ estimated across two fixture price versions; unknown price/usage and partial cache-write coverage remain explicit. No approved price, budget or reconciliation tolerance is inferred. In current Jaeger run `p2-verify-4a7ae971` (service `rec-app-p2-p2-verify-4a7ae971`, 14 traces/30 spans), the controlled model attempt took 51.6ms, real store read 80.8ms, Pinecone timeout 5.8ms, and caught semantic timeout 0.6ms. Malformed model output has provider attempt success and logical JSON failure; invalid replay has OTel ERROR transition spans. The private canary was absent. The single-run sample is sparse, so p50/p95/p99 are query demonstrations, not stable SLO evidence. Child durations overlap parent wall time. The printed fixture inventory now correctly expects semantic fallback `timeout`. S10 remains partial pending product review of the route map and diagnosis.
