# OBS-P2-T04: Journey and cost decision gates

**Priority:** P0 | **Status:** Decision verification pending
**Parent:** [P2 feature](../../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Coverage:** S01-AC1–AC4, S05-AC1–AC4; feature AC1 and cost-policy portion of AC5.

## Review procedure

Compare journey inventory against actual route, chain, service, store and scheduling source. Verify logical/attempt and active/wait boundaries, fallback, batch, imports and simulation labels. Review span/metric ownership and real provider attribution. Product and Engineering must approve D07 with named reviewer and date; local source inspection alone leaves that criterion pending.

Review D08 with Product/Finance for currency, reporting timezone/day, effective price sources, cache/batch treatment, allocation, numerical budgets, reconciliation tolerance/cadence and price owner. Verify unknown cost and coverage examples. The decision must explicitly keep enforcement and model switching out of scope. Synthetic calculations may pass locally while policy approval and reliable-cost acceptance remain pending. Never infer an approver, price or budget from a fixture.

## Independent Codex tester gate record — 2026-10-20

Focused 43/43; full 338/338; typecheck/build/smoke pass; lint 0 errors and 177 warnings after the final type-only import cleanup. P1 Docker regression 4/4; P2 Docker backend 27/27, including the invalid scheduling transition error span (run `p2-verify-4a7ae971`, 14 traces/30 spans). Only collector, Jaeger, Prometheus and Loki ran; `docker compose down --volumes --remove-orphans` completed. D07 Product/Engineering route and denominator approval, D08 Product/Finance policy/rates/budgets/tolerance/reconciliation, NFR-034 durable store, live/hosted provider evidence and accountable human review remain pending. This is independent Codex synthetic evidence, not human product approval or deployment acceptance.
