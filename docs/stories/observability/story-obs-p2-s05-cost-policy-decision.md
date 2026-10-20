# OBS-P2-S05: Approve estimated-cost attribution and budgets

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Decision | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Product/finance owner + AI lead (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** Before cost dashboard is represented as reliable
**Decision coverage:** D08 cost policy and AI budgets

## User story and operational question

As the product/finance owner + ai lead, I need evidence that answers: **What does an AI cost figure include, and who maintains its prices?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Cost is an estimate derived from known usage and dated prices, not an invoice or a promise of exact billing.

## Acceptance criteria

- [ ] **OBS-P2-S05-AC1:** Decide currency, timezone/reporting day, provider/model price source, effective dates/versioning, cache/batch discounts, taxes/credits exclusions, and who refreshes prices.
- [ ] **OBS-P2-S05-AC2:** Approve feature-level allocation rules and numerical daily/monthly spend-warning budgets plus reconciliation tolerance and cadence; distinguish AI cost from observability-platform spend.
- [ ] **OBS-P2-S05-AC3:** Define unknown model/usage behavior, known-cost coverage, treatment of retries/failures/embeddings, and provider-billing reconciliation evidence.
- [ ] **OBS-P2-S05-AC4:** Any spend enforcement or automatic model switching is a separate product decision; this story authorizes visibility and alerts only.

## Verification and completion evidence

Finance/product approves examples for a known model, missing model price, and a price change; record all numerical thresholds.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S04: Measure token usage without false precision](story-obs-p2-s04-token-accounting.md)
- [OBS-P1-S01: Choose and prove a telemetry destination](story-obs-p1-s01-backend-decision.md)

## Likely touchpoints

proposed cost-rate configuration and ADR. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.

## Local synthetic delivery status (2026-10-20)

Implementation and evidence are tracked in [P2 coverage](../../features/observability/p2-test-coverage.md) and [execution plan](../../../tasks/observability-p2-plan.md). Local implementation does not close decision approval or live-provider/hosted gates.

See [cost policy options](story-obs-p2-s05-cost-policy-options.md); prices, currency/day, budgets, tolerance, ownership and reconciliation approval remain pending.
