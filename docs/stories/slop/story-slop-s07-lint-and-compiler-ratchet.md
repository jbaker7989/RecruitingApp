# NFR-SLOP-S07: Make the Linter and Compiler Prevent Slop (Ratchet)

**Status:** Proposed
**Priority:** High (P1 *enabler*) — without this the cleanup regresses within weeks
**Size:** M (3–6h) — configuration plus per-rule baselines; no feature code
**Tracks:** NFR-027, INFRA-003
**Parent:** [Code hygiene remediation](README.md)
**Order:** Land the *tooling* part first as non-failing baselines, enforce rule-by-rule as S01–S05 finish.

## Problem

CI is green while the repository has 178 lint warnings and 44 compiler-detectable unused declarations. The gates are configured so that slop cannot fail them:

1. **ESLint uses the base `no-unused-vars` on TypeScript.** It is not type-aware, so it reports TypeScript type-only imports and interface members as unused (for example 43 warnings in `src/telemetry/*`, mostly OpenTelemetry type imports) — noise that trains people to ignore warnings — **and** it cannot see whether an `export` has any importer. Of the 137 `no-unused-vars` warnings under `src/`, the compiler confirms only 44 as genuinely unused (S01); the remainder are mostly type-only imports and interface members the rule cannot see being used.
2. **Warnings never fail.** `npm run lint` exits 0 with 178 warnings (it was 72 when INFRA-003 landed, so debt grew ~2.5x while the gate was "green").
3. **`tsc` does not check unused code.** `tsconfig.json` has `strict` but no `noUnusedLocals` / `noUnusedParameters`.
4. **Lint scope is partial.** `npm run lint` covers only `src/**/*.ts` and `tests/**/*.test.ts`. `scripts/*.mjs` (CI smoke, migration, telemetry verifiers) and the root `*.cjs` demos are unlinted; running ESLint over them produces ~270 `no-undef` errors because no Node globals are configured for `.mjs/.cjs`.
5. **`no-undef` is turned off** for TypeScript (correct for TS) but the config comments still describe the cleanup as deferred to "NFR-027", which is now several features old.
6. **No dead-export detection** and no duplicate-name check, which is how S02/S03 accumulated.

## Acceptance criteria

- [ ] **S07-AC1:** Replace the base rule with `@typescript-eslint/no-unused-vars` (same ignore patterns) via `typescript-eslint` flat config. Re-baseline: the false-positive type-import warnings disappear and the remaining count is recorded in the PR.
- [ ] **S07-AC2:** Add `.mjs`/`.cjs` blocks with Node globals; `scripts/` and any retained root scripts lint with zero `no-undef`. `npm run lint` covers `scripts/**`.
- [ ] **S07-AC3:** Enable `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json` **after** S01 reaches zero; `npm run typecheck` fails on regression. (Tests are outside `rootDir` and are covered by lint rule AC1 instead.)
- [ ] **S07-AC4:** Add `--max-warnings=<current count>` to `npm run lint` and lower the ceiling in each cleanup PR so the count can only fall. Final target is `--max-warnings=0`.
- [ ] **S07-AC5:** Enable `@typescript-eslint/no-explicit-any` as `warn` now, `error` for `src/**` when S04 hits its target; add `eqeqeq` and `no-console` (allowing the telemetry logger and documented bootstrap sink) as warnings that S05 promotes to errors.
- [ ] **S07-AC6:** Add a lightweight dead-export check (for example `knip` or `ts-prune` in CI report mode, or the scan from S02 committed under `scripts/`), plus the duplicate exported-name check. Start report-only; make blocking when S02/S03 close.
- [ ] **S07-AC7:** CI (`ci.yml` and `database-ci.yml` lint step) uses the same commands; `package.json` `lint:fix` is aligned; documented in the README testing section.
- [ ] **S07-AC8:** A seeded-defect test proves the gate bites: a throwaway branch/PR with an unused import and an unused local fails CI, and the result is linked in the story.

## Implementation tasks

1. Add `typescript-eslint`; convert `eslint.config.js`; re-run and record counts by rule (before/after table in PR).
2. Add script/cjs globals and widen the lint glob.
3. Introduce the ratchet (`--max-warnings`) at the current value; open the seeded-defect PR.
4. After each of S01–S05 merges, lower the ceiling and flip the matching rule to `error`.
5. Add the dead-export and duplicate-name checks in report mode.

## Boundaries

New dev-only dependencies are acceptable here (`typescript-eslint`, optionally `knip`); no runtime dependency changes. Do not mass-disable rules or add file-level `eslint-disable` to hit the ceiling. The unrelated NFR-043/044 test failures are not a prerequisite.
