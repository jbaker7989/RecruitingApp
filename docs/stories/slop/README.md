# Code Hygiene ("Slop") Remediation

**Feature ID:** NFR-SLOP-001
**Status:** Proposed — review complete 2026-10-26 against `main` (`8ecbef1`); no implementation started
**Priority:** Medium overall; S07 is a P1 enabler, S05 overlaps an open security finding
**Size:** XL in total (about 6–8 working days), delivered as nine independently shippable stories
**Tracks:** NFR-027 (unused code), NFR-031 (error leakage), NFR-023 (duplicated logic); complements NFR-078/079/080

## Why this exists

Unused variables are the visible symptom. A principal-level read of `src/`, `tests/`, `scripts/`, the repository root, `package.json` and the Docker image shows a wider pattern: code written or generated, partly wired, and left behind — with CI gates that cannot fail on it. Some items are only noise; several hide **intent that was never finished** (revocation cleanup never started, vector deletes never called, hire-record helper bypassed, a stub endpoint writing to user records, simulated calendar links stored as if real). Those are the findings that justify the effort.

## Method (reproducible)

All numbers come from commands run on `main` at `8ecbef1`:

| Signal | Command | Result |
|---|---|---|
| Compiler-confirmed unused code | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | **44** diagnostics in `src/` |
| Lint warnings | `npx eslint .` | 269 `no-undef` (scripts/cjs, unconfigured globals), 186 `no-unused-vars` (137 in `src/`, 33 in `tests/`, rest in scripts), 6 `preserve-caught-error`, 2 `no-case-declarations` |
| Dead exports | Cross-reference of every `export` in `src/` against `src/`, `tests/`, `scripts/` | ~20 exports referenced nowhere |
| Explicit `any` | `grep -E "as any\|: any\|<any>" src` | ~129 (`req: any` in 70 handlers) |
| Ad-hoc logging | `grep "console\." src` | ~45 calls bypassing the sanitizing logger |
| Duplicate function names | `grep -rhoE '^export (async )?function' src \| sort \| uniq -d` and non-exported duplicates | 7 duplicated names (validateEmail, calculateCompleteness, calculateMatchScore, calculateInputConfidence, parseJsonResponse, fixJsonString, build) |
| Dependencies | import scan vs `package.json` | `@langchain/langgraph` unused; dev tooling in runtime deps |
| Repo hygiene | `git ls-files` review | prompt-as-filename, demo scripts, tracked data fixtures, local-agent artifacts |

Already tracked and **not duplicated here**: NFR-078 (PDF parser API), NFR-079 (resume text in errors, including the `resumeParsing.ts` caught-error sites), NFR-080 (`durationMinutes` ignored). NFR-031 owns the client-facing error-message change; S05 only supplies the logging/handler hygiene around it.

## Stories

| Order | Story | Priority | Size | Delivers |
|---|---|---|---|---|
| 1 | [S07 Lint and compiler ratchet](story-slop-s07-lint-and-compiler-ratchet.md) | High (P1, enabler) | M (3–6h) | Type-aware lint, wider scope, warning ceiling, seeded-defect proof |
| 2 | [S01 Unused declarations](story-slop-s01-unused-declarations.md) | Medium (P1) | M (3–6h) | 44 compiler diagnostics resolved, intent-lost items decided |
| 3 | [S02 Dead code and stub endpoint](story-slop-s02-dead-code.md) | Medium (P2) | M (3–6h) | Dead exports, commented-out code and `oauth-stub` removed; defect candidates triaged |
| 4 | [S05 Error handling and logging](story-slop-s05-error-handling-and-logging.md) | Medium–High (P2) | M (3–6h) | Sanitized logging, shared handler, revocation fail-open decision |
| 5 | [S03 Duplicated logic](story-slop-s03-duplicated-logic.md) | Medium (P2) | L (1–2 days) | Single applicant/hire factories, one JSON parser, renamed look-alikes |
| 6 | [S06 Dependency, image and repo hygiene](story-slop-s06-dependency-and-repository-hygiene.md) | Medium (P2) | M (3–6h) | Unused deps removed, dev tooling out of the image, root cleaned (owner decisions) |
| 7 | [S09 Test-code slop](story-slop-s09-test-code-slop.md) | Medium (P2) | M (3–6h) | Unused test code resolved; suspected missing assertions verified |
| 8 | [S08 Misleading names, comments, stubs](story-slop-s08-misleading-names-comments-and-stubs.md) | Low–Medium (P3; simulated data P2) | S–M (2–4h) | Brand typo, narration comments, stale docs, explicit simulation |
| 9 | [S04 Type safety](story-slop-s04-type-safety.md) | Medium (P3) | L (1–2 days) | `any` removed; typed request handlers |

Rationale for order: land the guardrail first so nothing regresses (S07), remove noise (S01/S02), then fix the places that touch PII or security (S05), de-duplicate (S03), clean the supply chain and repo (S06), repair test credibility (S09), polish (S08), and tighten types last (S04) once duplication is gone.

Sizes use the repository legend (XS < 1h, S 1–3h, M 3–6h, L 1–2 days). Feature total: M×6 + L×2 + S–M ≈ 6–8 working days for one developer, excluding review wait.

## Rules for all stories

- Characterization tests before refactors; no assertion is weakened or skipped.
- Each story ships alone: green JSON suite, green PostgreSQL job (`database-ci.yml`), no behavior change unless the story lists it.
- Anything that turns out to be a defect gets its own `BUGS.md` entry and is not silently fixed inside a cleanup commit.
- Evidence is recorded per acceptance criterion; the story is not marked done on local results alone.

## Out of scope / observations to triage separately

- The production Docker stage bakes placeholder JWT secrets into `.env` and sets `ALLOW_JSON_STORE=true`.
- Scale of `updateStore` (full-store load per write) is a known contract limit (NFR-DATA-001).
- The Python screening service in `agent-home/` is unsupported by CI; its status needs an owner decision (S06).
