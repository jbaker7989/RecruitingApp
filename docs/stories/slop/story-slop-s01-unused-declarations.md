# NFR-SLOP-S01: Remove Unused Imports, Locals, Parameters and Properties

**Status:** Proposed
**Priority:** Medium (P1 — first; unblocks the S07 compiler ratchet)
**Size:** M (3–6h) — 44 compiler diagnostics across 24 files; mechanical but each removal must be checked for hidden intent
**Tracks:** NFR-027 (refreshes its stale inventory)
**Parent:** [Code hygiene remediation](README.md)

## Problem

`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` reports **44 TS6133/TS6138/TS6192/TS6196 diagnostics** on `main` (`8ecbef1`). The repository's own `tsconfig.json` does not enable those checks, and ESLint's base `no-unused-vars` is not TypeScript-aware, so the debt is invisible in CI. The compiler is the authoritative source; the 178 ESLint warnings are a noisy superset (see S07).

Unused imports are not harmless: each one is a signal that code was written, copied or half-refactored without finishing. Several below point to logic that was **meant** to be used and silently is not.

## Inventory (compiler-confirmed)

| Area | File:line | Unused | Reviewer note |
|---|---|---|---|
| Imports (pure noise) | `src/chains/candidateCommunication.ts:9` `MessageType`; `src/chains/jobDescription.ts:8` `z`; `src/chains/matching.ts:6` `getLLMClient`; `src/index.ts:11` `readStore`; `src/middleware/auth.ts:2` `UserTokenPayload`, `ApplicantTokenPayload`; `src/middleware/validation.ts:1` `Response`, `NextFunction` and `:2` (whole import); `src/models/store.ts:2` `dirname`; `src/routes/auth.ts:4` `AuthRequest`; `src/routes/companies.ts:3` `validateJobBody`; `src/routes/jobs.ts:4` `validateApplicationBody` and `:6` (whole import); `src/routes/applicants.ts:5` `validateApplicationBody`; `src/routes/mcp.ts:2` `addObservabilityEntry`; `src/services/importService.ts:1` `Readable`, `:3` `Company`; `src/services/matching.ts:1` `EducationEntry`, `EmploymentEntry`, `Company`, `:2` `addObservabilityEntry`; `src/routes/agents/index.ts:23` `InterviewSchedulingState` | Delete. `routes/jobs.ts:6` and `middleware/validation.ts:2` are *whole-statement* dead imports. |
| Unused request types | `src/routes/agents/candidateCommunication.ts:15,17` `GenerateMessageRequest`, `GenerateVariantsRequest`; `src/routes/agents/jdGenerator.ts:17,19,23` `GenerateRequest`, `GenerateVariantsRequest`, `UpdateDraftRequest` | These were meant to type `req.body`; the handlers use `req: any` instead. **Do not just delete** — resolve with S04 (use the types) or delete the types if S04 supplies replacements. |
| Unused route helpers | `src/routes/agents/candidateCommunication.ts:8,9` `readStore`, `generateMessageVariants`, `calculateInputConfidence`; `src/routes/agents/jdGenerator.ts:10` `generateJobDescriptionVariants` | `generateMessageVariants` / `generateJobDescriptionVariants` are imported but the route builds variants with its own loop (`jdGenerator.ts:262`, `candidateCommunication.ts:188`) — see S03. |
| Unused handler args | `src/routes/agents/index.ts:240` `req` (rebuild-index); `src/routes/mcp.ts:72` `req` (hires); `src/middleware/auth.ts:118` `req`, `next` (error handler) | Prefix `_` (Express identifies error middleware by arity 4, so `next` must remain). |
| Unused locals | `src/agents/scheduling/agent.ts:294` `state` (`confirmedNode`) | Node ignores its input; verify it is intentionally a pass-through. |
| Unused function parameter that hides intent | `src/chains/jobDescription.ts:154` `baseOutput` in `generateJobDescriptionVariants(baseOutput, tones, input)` | The "base" output is never used, so variants are generated from `input` only and the first parameter is misleading. Decide: use it as the base or drop it (API change; check callers). |
| Unused OAuth parameters | `src/services/oauthService.ts:127,140,153` `redirectUri` in `googleConfig`, `linkedinConfig`, `facebookConfig` | Remove the parameter and fix three call sites. Confirm the redirect URI is applied elsewhere (token exchange) so this is not a lost value. |
| Property declared, never read | `src/services/llm/index.ts:165,189` `private readonly _aiOpts` | Only the constructor argument is used. Drop the `private readonly` modifier; also see S03 (the two classes are near-identical). |
| Lint-suppression idiom | `src/telemetry/privacy.ts:358` `const { exemplars: _drop, ...rest } = dp; void _drop;` | Same pattern the earlier slop pass removed (`void updated; // suppress lint`). Replace with an explicit omit helper or `delete` on a copy. |

**Excluded because already tracked:** `src/routes/agents/index.ts:260` `durationMinutes` is [NFR-080](../story-bug-interview-duration-ignored.md) (a real defect: the requested duration is ignored). Do **not** "fix" it by deleting the variable.

## Acceptance criteria

- [ ] **S01-AC1:** `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` reports zero diagnostics other than the NFR-080 `durationMinutes` entry (or zero, if NFR-080 has landed).
- [ ] **S01-AC2:** Each removal is classified in the PR description as *noise*, *intent lost* (code should use the symbol) or *API change*. Every *intent lost* and *API change* item has a regression test or a recorded decision to drop.
- [ ] **S01-AC3:** `baseOutput` and `redirectUri` are resolved deliberately, not blindly deleted; the OAuth tests under `tests/regression/NFR-053*`, `NFR-071-074*` and `NFR-076*` pass unchanged.
- [ ] **S01-AC4:** No behavior change: `npm test` (JSON) and `npm run test:db` totals are unchanged from the baseline recorded at story start. No exports used by tests are removed.
- [ ] **S01-AC5:** `privacy.ts` no longer uses `void` to silence the linter, and an existing/added test proves exemplars are still dropped from sanitized metrics.

## Implementation tasks

1. Record the baseline: tsc diagnostic list, `npm test` totals, `npm run test:db` totals.
2. Remove pure-noise imports first (one commit), run typecheck.
3. Resolve the "intent lost" items one at a time with a failing test where behavior would change.
4. Re-run the diagnostic command; attach before/after output.

## Verification

Compiler diagnostics before/after, plus the full ordered gate in `.github/workflows/database-ci.yml`. A reviewer must read the diff for any removed import that has side effects (`import 'x'` forms are not in scope here, but check `routes/jobs.ts:6`).

## Boundaries

No dependency removals (S06). No type tightening beyond what a removal requires (S04). Do not enable the compiler flags in `tsconfig.json` in this story; that is S07's ratchet so the order of work is reviewable.
