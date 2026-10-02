# Story: Config Versioning & Audit Trail for Matching/LLM Settings (RSI Phase 1)

**Status:** Open
**Priority:** Medium (foundation work — no behavior change to scoring/prompts by itself, but unblocks rollback and future tuning)
**Created:** 2026-09-24
**Related:** `/Users/jbaker/.claude/plans/is-there-a-possibility-calm-church.md` (full RSI feasibility design — this story covers Phase 1 only; Phase 2, the automated propose/backtest loop, is intentionally out of scope here)

## Overview

The matching/scoring weights in `src/chains/matching.ts` (hardcoded 30%
keyword / 30% education / 30% experience / 10% semantic) and the LLM
prompts/model routing in `src/chains/resumeParsing.ts`,
`src/chains/jobDescription.ts`, `src/chains/candidateCommunication.ts`, and
`src/services/llm/index.ts`'s `MODEL_CONFIGS` are all in-code constants.
There is currently no way to change any of them without a code deploy, no
version history, no audit trail of who changed what and when, and no
rollback path if a change turns out worse.

This story externalizes those settings into a versioned, auditable config
store — the prerequisite for any future tuning (manual or automated). It
does **not** add any automated proposal/backtesting loop; all versions are
authored and promoted by a human. Scope matches "Phase 1" from the linked
RSI feasibility plan.

## Current Behavior

```
src/chains/matching.ts:        const weights = { keywordWeight: 0.30, ... }  // hardcoded
src/services/llm/index.ts:     const MODEL_CONFIGS = { ... }                 // hardcoded
src/chains/resumeParsing.ts:   const PROMPT = `...`                         // hardcoded
```
Changing any of these requires editing source, a code review, and a deploy.
No record exists of what the values were before a given deploy, or why they
changed.

## Desired Behavior

```
src/models/store.ts:  ConfigVersion model + data/configs.json (mirrors observability.json)
src/chains/matching.ts:  const weights = await getActiveConfig('matching-weights')  // falls back to current hardcoded values if none is live
```
A human can create a new `ConfigVersion` (via a seed script or a simple
authenticated API call), promote it to `live`, and roll back to any prior
version — all without a code deploy, and all recorded in the existing
observability audit log.

## Acceptance Criteria

1. `src/models/store.ts` defines `ConfigVersion` and `ConfigStatus`
   (`'proposed' | 'testing' | 'approved' | 'live' | 'archived' | 'rejected'`)
   and a `subsystem` union covering `'matching-weights'`,
   `'prompt:resumeParsing'`, `'prompt:jobDescription'`,
   `'prompt:candidateCommunication'`, and `'model-routing'`.
2. New `data/configs.json` + `readConfigs`/`writeConfigs`/`addConfigVersion`
   helpers in `src/models/store.ts`, following the exact pattern already
   used for `readObservability`/`writeObservability`/`addObservabilityEntry`.
3. A `getActiveConfig(subsystem)` lookup: returns the current `live`
   `ConfigVersion.payload` for that subsystem if one exists, otherwise falls
   back to the existing hardcoded default (the static `weights` object /
   `MODEL_CONFIGS` / prompt strings become the built-in "factory reset"
   baseline — never deleted).
4. `src/chains/matching.ts` reads weights via `getActiveConfig('matching-weights')`
   instead of the hardcoded object. Behavior is identical when no live
   config exists yet (defaults match today's values exactly).
5. `src/services/llm/index.ts` layers a `model-routing` live config over
   `MODEL_CONFIGS` the same way, if one exists.
6. `Application` gains a `configVersionId` field recording which config
   produced a given match score, so every score is traceable to an exact
   config version.
7. Promote/rollback of a `ConfigVersion` (`status` transitions to `live` /
   `archived`) writes an `addObservabilityEntry` (`action:
   'rsi.config.promoted'` / `'rsi.config.rolledback'`, `entityType:
   'ConfigVersion'`) — no silent changes.
8. `ConfigVersion` records are never hard-deleted (only status-transitioned),
   preserving full lineage for later audit.
9. No automated proposal generation, backtesting, or scheduled job exists
   in this story — creation of new `ConfigVersion` records is manual only
   (a human via script or authenticated endpoint).

## Implementation Notes

- Cache `getActiveConfig` lookups with a short TTL to avoid a file read per
  request (matching runs per-application).
- Reuse the `dataDir()`/`ensureDataDir()` helpers already in
  `src/models/store.ts` rather than introducing a new path-resolution
  scheme.
- This story deliberately stops short of a review UI or dashboard page —
  that's part of Phase 2's promotion workflow (`story-rsi-proposer-backtester-loop.md`,
  not yet written), since Phase 1 has no automated proposals to review.

## Dependencies

- None — this is additive and backward-compatible; no existing route or
  test should need to change behavior when no `ConfigVersion` is live.

## Out of Scope (deferred to Phase 2)

- Automated proposer/backtester (`src/agents/rsi/`)
- Outcome/feedback-driven weight or prompt tuning
- Human review/approval dashboard UI (`views/dashboard/rsiProposals.ejs`)
- Bias/adverse-impact checks on proposals
- Rate limiting / minimum-sample gates on proposal generation
