# OBS-P2-S06: Publish feature usage and estimated-cost reports

**Status:** Implementation in progress (dev2) — independent tester verification and OBS-P2-S05 approval pending; no ACs accepted yet
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** AI/platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 cost visibility
**Decision coverage:** None

## User story and operational question

As the ai/platform engineer, I need evidence that answers: **Which feature drives AI spend, and did a release change it?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Create an authorized dashboard for tokens, estimated cost, failures, and usage completeness by feature and time.

## Acceptance criteria

- [ ] **OBS-P2-S06-AC1:** Apply versioned effective-date prices to supported usage; report estimated currency totals separately from tokens and preserve a reproducible calculation for each price version.
- [ ] **OBS-P2-S06-AC2:** Unknown usage or price remains unknown with visible coverage; model aliases and retries cannot silently inflate or erase costs.
- [ ] **OBS-P2-S06-AC3:** Dashboard filters environment, feature, provider/model and release, supports daily trends and cost per completed logical operation with a defined denominator.
- [ ] **OBS-P2-S06-AC4:** Fixture totals match calculations within approved rounding tolerance; provider reconciliation reports unexplained variance and creates a follow-up ticket when tolerance is exceeded.

## Implementation notes (dev2)

- `src/telemetry/cost.ts`: versioned price catalog (two synthetic versions), `applyCost`, `buildCostReport`.
- `observability/p2/cost-fixtures.json`: deterministic fixture records spanning v1/v2 boundary.
- `scripts/observability-p2-cost-report.mjs`: CLI report with daily breakdown, unknown coverage, retry accounting, saved query definitions, and environment/release filter support.
- `SYNTHETIC_USAGE_FIXTURES` in cost.ts includes: known full-coverage, cross-boundary, unknown model, missing SDK usage, and partial-coverage (cache-write) records.
- Reuse paths emit no UsageRecord (fix-012 removed — no billed API call for vector reuse).
- completedOps denominator uses logicalOperationId + completionOutcome to correctly count unique completed operations including successful retries.
- Partial price coverage: records with cacheWriteTokens or reasoningTokens > 0 are marked partial (no approved rates for these categories).
- OBS-P2-S05 (cost policy decision) remains open; NON-POLICY label applied throughout.
- No approved rounding tolerance; no provider reconciliation (no real invoice available).

## Verification and completion evidence

Validate known-price fixtures across price-change boundaries and missing-price cases; attach screenshot/query and a sample reconciliation report.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S05: Approve estimated-cost attribution and budgets](story-obs-p2-s05-cost-policy-decision.md)

## Likely touchpoints

proposed cost calculator; dashboard definitions; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
