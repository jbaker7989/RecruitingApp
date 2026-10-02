# Story: Proposer/Backtester Loop & Human-Gated Promotion (RSI Phase 2)

**Status:** Open
**Priority:** Medium (real behavior change once live — tunes live matching/prompt config — so treat with more scrutiny than Phase 1)
**Created:** 2026-09-24
**Related:** `/Users/jbaker/.claude/plans/is-there-a-possibility-calm-church.md` (full RSI feasibility design). **Depends on** `story-rsi-config-versioning.md` (Phase 1) — the `ConfigVersion` model, `data/configs.json`, and `getActiveConfig()` lookup must exist first; this story only adds automation and a review UI on top of that foundation.

## Overview

Phase 1 makes matching weights and LLM prompts/model routing versioned and
manually promotable, but every `ConfigVersion` still has to be hand-authored
and hand-promoted. This story adds the actual "recursive" loop: a scheduled
process that proposes a candidate config from recent outcome data, backtests
it offline against historical labeled data, and — only if it clears a
defined improvement margin — surfaces it to a human for review. A human
approval is **required** before any proposal can go live; nothing in this
story auto-promotes. Each approved version becomes the new baseline
(`parentVersionId`) for the next cycle, which is what makes the loop
recursive rather than a one-off tuning script.

This is explicitly Phase 2 of the plan. Phase 3 (making the proposer's own
prompt-writing prompt tunable) is out of scope and not recommended per the
linked design doc.

## Current Behavior (post–Phase 1)

A human can manually create and promote a `ConfigVersion`, but nothing
in the system ever proposes one on its own, and there is no outcome-driven
signal informing what a better config would even look like.

## Desired Behavior

```
scheduled job → proposer.ts reads outcome data → drafts candidate ConfigVersion (status: 'proposed')
             → backtester.ts scores candidate vs. current live config on historical data
             → if candidate beats baseline by margin → status: 'testing', surfaced in review UI
             → human approves → status: 'live' (old live → 'archived'); OR human rejects → status: 'rejected'
             → next cycle's proposer uses the new live config as parentVersionId baseline
```

## Acceptance Criteria

### Outcome/feedback data model
1. A `deriveOutcomeSignal()` job joins `applications` → `hires` →
   relevant observability transitions to produce a genuine downstream
   outcome per application (progressed to interview/hire; for hires,
   whether `HireRecord.status` survived past probation rather than
   `'terminated'`). Recruiter override/agreement with a score is tracked
   only as a secondary diagnostic field, never as the sole signal driving
   a proposal — ground truth must come from actual outcomes, not agreement
   with the model's own prior output.
2. A proposer run refuses to generate any candidate config unless there are
   at least N applications (configurable constant, default 50) with a
   *resolved* outcome in the trailing window, checked before any other
   proposer logic runs.

### Proposer (`src/agents/rsi/proposer.ts`)
3. For `matching-weights`: computes a bounded weight delta (clamped to a
   fixed relative magnitude, e.g. ±10% per cycle) from recent outcome data
   and writes a new `ConfigVersion` (`status: 'proposed'`,
   `parentVersionId` = current live version's id).
4. For prompt subsystems (`prompt:resumeParsing`, `prompt:jobDescription`,
   `prompt:candidateCommunication`): drafts a constrained prompt revision
   (template-bounded edit, not a free rewrite) informed by recent output
   quality signals, also written as a `'proposed'` `ConfigVersion`.
5. Proposer runs are rate-limited independent of the sample-size gate — no
   more than one proposal per subsystem within a configurable window
   (default: weekly).
6. The proposer's own prompt-writing logic (the meta-prompt used to draft
   prompt revisions) is fixed and human-authored in this story — it is
   itself stored as a `ConfigVersion` for audit purposes but is never
   itself a target of automated tuning (Phase 3, explicitly deferred).

### Backtester (`src/agents/rsi/backtester.ts`)
7. For `matching-weights`: replays the candidate config offline against
   historical labeled `applications`/`hires` data (no live scoring side
   effects) and computes a correlation/AUC metric between `finalScore` and
   the derived outcome signal, compared against the current live config on
   the same historical set.
8. For prompt subsystems: scores the candidate against a small curated
   golden eval set (new `data/eval-sets/*.json`, checked into the repo) via
   a rubric-based LLM judge or structured-output validity rate, compared
   against the current live config's score on the same set.
9. A proposal only advances from `'proposed'` to `'testing'` (i.e. becomes
   visible for human review) if it beats the current live baseline by a
   defined minimum margin (e.g. +3% AUC) — not any positive delta, to avoid
   surfacing noise as improvement.
10. Every backtest result is recorded on the `ConfigVersion.backtestMetrics`
    field for display in the review UI.

### Human-gated promotion workflow
11. New route `src/routes/agents/rsi.ts`:
    - `GET /api/agents/rsi/proposals` — list `ConfigVersion`s with status
      `'testing'` (i.e. proposals awaiting review), including
      `backtestMetrics` and a diff-friendly view of `payload` vs. the
      current live config for that subsystem.
    - `POST /api/agents/rsi/proposals/:id/approve` — requires an
      authenticated role with appropriate permission (recruiter/hiring-manager
      tier or above, matching this app's existing `requireRole` pattern);
      flips the proposal to `'live'`, flips the prior live version for that
      subsystem to `'archived'`.
    - `POST /api/agents/rsi/proposals/:id/reject` — flips to `'rejected'`
      with an optional `reviewNotes` field.
    - `POST /api/agents/rsi/proposals/:id/rollback` — re-promotes any prior
      `'approved'`/`'archived'` version to `'live'` through the same
      approve code path (rollback is never a silent/unaudited revert).
12. New dashboard view `views/dashboard/rsiProposals.ejs` (same
    layout/nav convention as existing `views/dashboard/*.ejs` pages) showing
    pending proposals with a side-by-side diff of old vs. new `payload` and
    the backtest metrics, with approve/reject actions.
13. Every approve/reject/rollback action writes an `addObservabilityEntry`
    (`action: 'rsi.proposal.approved' | 'rsi.proposal.rejected' |
    'rsi.proposal.rolledback'`, `entityType: 'ConfigVersion'`,
    `userId` = the reviewing user) — full accountability trail, reusing
    existing infrastructure from Phase 1.

### Legal/compliance guardrail
14. Backtesting includes a basic adverse-impact check (selection-rate
    disparity across any available demographic-proxy fields) wherever such
    data exists, and surfaces the result as a **flag** (not a block) on the
    proposal in the review UI (`ConfigVersion.biasFlags`) — a human reviewer
    must be able to see this before approving, but the system does not
    auto-reject on it.
15. No `ConfigVersion` is ever hard-deleted (already required by Phase 1) —
    this story must not introduce any deletion path, since audit
    reconstruction depends on full lineage.

## Implementation Notes

- Trigger mechanism for the scheduled proposer run should reuse whatever
  job-scheduling approach already exists in the codebase if one does
  (check `src/agents/scheduling/agent.ts` for a precedent); otherwise a
  simple cron-invoked script is acceptable for a first cut.
- Keep `proposer.ts` and `backtester.ts` as pure-ish functions over
  historical data where possible — no live side effects — so they can be
  unit tested deterministically with synthetic datasets.
- The `+3%` and similar thresholds throughout should be named constants,
  not magic numbers, so they can be tuned without a logic change.

## Dependencies

- `story-rsi-config-versioning.md` (Phase 1) — must be implemented first.
- Existing `addObservabilityEntry` / `readObservability` infrastructure in
  `src/models/store.ts`.
- Existing `requireRole` auth middleware pattern for gating the
  approve/reject/rollback routes.

## Acceptance Test Sketch (for future implementation)

1. Seed synthetic historical `applications`/`hires` data where a known
   better weight set clearly outperforms the current live config on the
   derived outcome signal. Run the backtester directly against both —
   assert the better set's metric exceeds baseline by more than the margin.
2. Seed a synthetic dataset where a candidate is only marginally
   different (below the margin) — assert it does *not* advance to
   `'testing'`.
3. End-to-end: run proposer → assert a `'testing'` `ConfigVersion` exists
   with `backtestMetrics` populated → call the approve route → assert the
   new version is `'live'`, the old one is `'archived'`, and an
   observability entry was written.
4. Rollback test: after the above, call the rollback route targeting the
   original version → assert it is `'live'` again and a second
   observability entry recorded the rollback.

## Out of Scope (deferred to Phase 3, not recommended per the feasibility plan)

- Making the proposer's own prompt-writing meta-prompt itself a target of
  automated tuning.
