# OBS-P2-S05: Cost Policy Options and Reproducible Examples

**Document type:** Decision options (no approvals granted here)
**Story:** OBS-P2-S05
**Status:** Options proposed — all policy decisions PENDING approval
**Pending owners:** Product owner + Finance + Backend lead
**Created:** 2026-10-19
**Author:** Dev1 (implementation sub-agent)

---

## Acceptance criteria reference

This document supports [OBS-P2-S05](story-obs-p2-s05-cost-policy-decision.md) which defines **AC1 through AC4 only** (no S05-AC5 exists). Content here is analysis for the decision owners; no acceptance gate is claimed. Feature-level AC5 (OBS-001-P2-AC5) is a separate criterion requiring both S05 and S06 evidence plus D08 approval.

## 1. What this document covers

This document proposes cost policy OPTIONS and shows reproducible calculation examples for each. It does NOT:

- Set any price (currency/rate/budget values are placeholders marked `<RATE>`)
- Approve any policy
- Enable enforcement, alerting, or model switching
- Contain real applicant or billing data

All numeric examples use the same synthetic fixture rates used in `scripts/observability-p2-fixtures.mjs`. Rates in production MUST be injected from an approved external source (environment variable, config file, or a versioned rate table with an effective-date). See Section 5 for injection contract.

---

## 2. Decision points requiring approval

| # | Decision | Options | Owner |
|---|---|---|---|
| D1 | Which currency | USD only / multi-currency with FX at-report / multi-currency with FX at-collection | Finance |
| D2 | Rate source and versioning | Env vars / versioned rate config file / external pricing API | Backend lead |
| D3 | Rounding policy | Truncate to 4 decimal places / Round half-up at report / Exact rational arithmetic | Finance |
| D4 | Budget granularity | Per-day total / Per-feature per-day / Per-model per-day / Per-operation per-call | Product + Finance |
| D5 | Budget enforcement | Log-only / Emit metric + alert / Hard circuit-break at chain level | Product + Engineering |
| D6 | Allocation model | Flat per-token / Tiered by feature priority / Per-request amortized | Finance |
| D7 | Reconciliation period | Daily / Weekly / Monthly | Finance |
| D8 | Cache discount treatment | Count cache reads at full price / Zero price / Partial fraction | Finance |

---

## 3. Token categories and cost formula options

The telemetry layer records these token categories per call (see `app.ai.tokens` metric, `ai.token_category` attribute):

- `input` — net non-cached input tokens
- `output` — net non-reasoning output tokens
- `cache_read` — tokens served from prompt cache (read side)
- `cache_write` — tokens written to prompt cache (creation overhead)
- `reasoning` — chain-of-thought tokens (OpenAI o-series; billed but not in output)
- `unknown` — embedding usage (SDK does not expose token count)

### Option A: Flat per-token pricing

```
cost = (input × <INPUT_RATE>)
     + (output × <OUTPUT_RATE>)
     + (cache_read × <CACHE_READ_RATE>)
     + (cache_write × <CACHE_WRITE_RATE>)
     + (reasoning × <REASONING_RATE>)
```

**Reproducible example** (synthetic, non-policy rates marked `[SYN]`):
```
Synthetic: input=1000, output=300, cache_read=200, cache_write=50, reasoning=0
Rates[SYN]: input=0.000005, output=0.000015, cache_read=0.0000025, cache_write=0.000005
Result[SYN]: 0.005 + 0.0045 + 0.0005 + 0.00025 = 0.01025
```
Decision gate: D2 (rate source), D3 (rounding), D8 (cache discount).

### Option B: Cache reads at zero price

Same as Option A except `cache_read × 0`. Motivation: cache reads save cost vs. re-sending tokens; counting them at full price inflates reported spend. Requires D8 approval.

**Reproducible example** (same synthetic values):
```
Result[SYN]: 0.005 + 0.0045 + 0 + 0.00025 = 0.00975
```

### Option C: No cache write cost

Some use cases (short contexts) rarely benefit from cache_write. Set `cache_write × 0`.

**Reproducible example**:
```
Result[SYN]: 0.005 + 0.0045 + 0.0005 + 0 = 0.01000
```

### Option D: Reasoning tokens treated as output

If pricing source does not distinguish reasoning from output:
```
combined_output = output + reasoning
cost = (input × <INPUT_RATE>) + (combined_output × <OUTPUT_RATE>) + …
```

---

## 4. Budget granularity options

### Option 1: Per-day total budget

Single `<DAILY_BUDGET_USD>` threshold across all features. Simplest to implement.

**Alarm query (Prometheus PromQL example, rates non-policy)**:
```promql
sum(increase(app_ai_tokens_total{ai_token_category=~"input|output"}[1d]))
  * on() group_left() (scalar(<INPUT_RATE>) + scalar(<OUTPUT_RATE>))
> <DAILY_BUDGET_USD>
```

### Option 2: Per-feature per-day budget

Separate `<FEATURE_DAILY_BUDGET>` per `app.feature` label. Requires D4 and D6 approval.

**Alarm query**:
```promql
sum by (app_feature) (
  increase(app_ai_tokens_total{ai_token_category=~"input|output"}[1d])
) * <RATE_PLACEHOLDER>
> <FEATURE_BUDGET_PLACEHOLDER>
```

### Option 3: Per-model per-day budget

Group by `ai.model`. Useful if different models have very different costs.

### Option 4: Hard circuit-break (Option D5 = circuit-break)

Not implemented. If approved, add a `checkBudget()` gate before `traceAIInvocation`. This is a SEPARATE story; no code changes in this document.

---

## 5. Rate injection contract (implementation-ready, values pending)

The cost module (`src/telemetry/cost.ts`, dev2 scope) should accept a `RateTable` object. Dev1's traceAIInvocation and usage modules emit the raw token counts; the cost module is a post-processing consumer.

Proposed interface (NOT a dev1 file; provided for coordination with dev2):

```typescript
// Proposed — not yet implemented — values MUST come from an approved external source
export interface TokenRate {
  input: number;       // USD per token
  output: number;      // USD per token
  cacheRead: number;   // USD per token (0 if Option B chosen)
  cacheWrite: number;  // USD per token
  reasoning: number;   // USD per token
}

export interface RateTable {
  effectiveDate: string;  // ISO date — REQUIRED for reproducibility
  version: string;        // e.g. "2025-Q4" — matches versioned rate config
  models: Record<string, TokenRate>;  // keyed by AIModel value
}
```

**Effective-date versioning rule:** Rate tables MUST carry an `effectiveDate`. Cost reports MUST join on the rate table whose `effectiveDate <= observationDate` (latest effective before the call). This enables retroactive re-computation if prices change. Rate tables are NEVER derived from telemetry; they are an independent input.

---

## 6. Reconciliation options (D7)

| Period | Pros | Cons |
|---|---|---|
| Daily | Catches runaway spend within 24h | Higher noise for low-volume features |
| Weekly | Smooths daily variance | Slow to detect sustained overrun |
| Monthly | Matches billing cycle | Cannot prevent budget overrun within month |

Recommendation: daily for alerting, monthly for billing reconciliation. Requires Finance approval.

---

## 7. Unknown embedding usage (OBS-P2-S03 limitation)

Embedding calls (`ai.embed` spans, `app.ai.usage.unknown_count` metric) do NOT expose token counts via the LangChain SDK. Cost attribution for embeddings is BLOCKED until one of:

- (a) LangChain OpenAIEmbeddings exposes usage in a future SDK version, OR
- (b) Embeddings calls are switched to raw OpenAI HTTP API with response body parsing, OR
- (c) Cost is estimated from character/token count approximation (requires separate approval).

Until unblocked, the cost report MUST record embedding calls as `cost: null` (not zero, not estimated). Fabricating a cost estimate would misrepresent actual spend.

---

## 8. Open decisions (complete list)

All decisions from Section 2 are unresolved:
- D1 currency: not decided
- D2 rate source/versioning: not decided
- D3 rounding policy: not decided
- D4 budget granularity: not decided
- D5 enforcement: not decided (no enforcement implemented until decided)
- D6 allocation: not decided
- D7 reconciliation period: not decided
- D8 cache discount: not decided

No cost enforcement, alerting, or model-switching logic is implemented on the dev1 side. The `app.ai.tokens` metric and raw token counts are emitted and ready for a cost module to consume once policy is approved.
