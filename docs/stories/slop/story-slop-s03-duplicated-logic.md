# NFR-SLOP-S03: Consolidate Copy-Pasted Logic into Single Sources of Truth

**Status:** Proposed
**Priority:** Medium (P2) — duplication already produced divergent behavior (see "Evidence of drift")
**Size:** L (1–2 days) — nine duplicate clusters; the applicant constructor and LLM-client classes need characterization tests first
**Tracks:** NFR-027, NFR-023
**Parent:** [Code hygiene remediation](README.md)
**Depends on:** S01 (so the diff is not drowned in import churn). Coordinate with S02 on `createHireRecord`.

## Problem

The same logic lives in several files, usually because a route or chain was cloned and edited. Each copy then evolves alone. In a recruiting product that matters: a hire record, an applicant record or a match score that differs by entry point is a data-integrity and fairness problem, not a style problem.

## Duplicate clusters

| # | Cluster | Locations | Why it is a risk |
|---|---|---|---|
| D1 | **Hire record construction** | Inline in `src/routes/applications.ts:185-197` (typed `any`); dead but correct `createHireRecord` in `src/services/matching.ts:122` | The route owns the only live copy and bypasses the typed helper, so `HireRecord` shape changes are not compiler-checked at the one place that writes hires. |
| D2 | **Applicant record literal** (`hireRecords: [], oauthProvider: null, …`) | `src/routes/applicants.ts:185,444`, `src/routes/dashboard.ts:123`, `src/services/oauthService.ts:516` | Four hand-written applicant factories. A new required field (e.g. a PII or consent field) is added to some and not others, producing records that fail validation later or silently lack defaults. Highest-value item in this story. |
| D3 | **`validateEmail`** | `src/middleware/validation.ts:5`, `src/services/matching.ts:7` | Two regexes can accept different addresses at different entry points. Keep one, export once. |
| D4 | **`calculateCompleteness`** | `src/routes/applicants.ts:134` (typed), `src/routes/dashboard.ts:482` (`a: any`) | The dashboard can show a different profile-completeness percentage than the API for the same applicant. Verify and add a test that both surfaces agree. |
| D5 | **JSON-extraction/repair helpers** `parseJsonResponse`, `fixJsonString` | `src/chains/jobDescription.ts:240,268`, `src/chains/candidateCommunication.ts:161,189` (comment-for-comment copies) | Bug fixes to LLM-output repair must be made twice; `resumeParsing.ts` has a third variant. Extract one `parseLlmJson` with a shared test table. Coordinate with NFR-079: the extracted helper must not put raw model output in thrown messages. |
| D6 | **Variant-generation loops** | `generateMessageVariants` / `generateJobDescriptionVariants` in `src/chains/*` vs. hand-rolled loops in `routes/agents/jdGenerator.ts:~240-262` and `candidateCommunication.ts:~188` | The chain-level helpers exist, are imported by the routes, and are *not used* (S01). The route loops add draft persistence and catch/log per tone, so decide: have the chain helper accept a per-variant callback or delete the helper. |
| D7 | **`calculateInputConfidence`** | `src/chains/candidateCommunication.ts:208`, `src/chains/jobDescription.ts:287` | Same name, different inputs/formula. If intentional, rename (`…ForMessage` / `…ForJobDescription`) so imports are unambiguous. |
| D8 | **Two `calculateMatchScore`** | `src/services/matching.ts:12` (deterministic, sync), `src/chains/matching.ts:100` (async, semantic) | Same name, different semantics; routes can import the wrong one without a compile error. Rename the async one (e.g. `calculateSemanticMatchScore`) and document which route uses which. README §8/§11 describe different weightings; confirm the code matches the documented weights. |
| D9 | **Instrumented LLM client classes** | `src/services/llm/index.ts` `InstrumentedChatOpenAI` / `InstrumentedChatAnthropic` (~160-210) | Two classes that differ only in the base class. Use a small mixin/factory so a telemetry fix is one edit. |

## Evidence of drift (why this is not cosmetic)

- D5's two copies already differ in whitespace and comment order; the next functional edit to one will not reach the other.
- D4 has typed and `any` versions of the same formula.
- D2's four copies are the surface that the recent applicant-PII work (`87f468e`) had to touch in several places.

## Acceptance criteria

- [ ] **S03-AC1:** Characterization tests are added **before** each extraction (table-driven where possible) and pass against the old code, then the new code. No assertion is loosened.
- [ ] **S03-AC2 (D1/D2):** One typed `createApplicant(...)` factory and one `createHireRecord(...)` are the only code paths that build those records; routes, dashboard and OAuth use them. A test proves every creation path yields identical default fields.
- [ ] **S03-AC3 (D3/D4):** Exactly one `validateEmail` and one `calculateCompleteness`; a test proves API and dashboard return the same completeness for a fixture applicant.
- [ ] **S03-AC4 (D5):** One shared LLM-JSON parser used by the three chains; malformed-output tests assert no raw model text is placed in error messages (aligns with NFR-079).
- [ ] **S03-AC5 (D6–D8):** Variant helpers are either used by the routes or deleted; same-named functions are renamed or documented so no two exported symbols share a name across `src/`. (`grep -rhoE '^export (async )?function \w+' src | sort | uniq -d` is empty.)
- [ ] **S03-AC6 (D9):** A single instrumentation wrapper serves both providers; existing `tests/observability-p2-ai*.test.ts` pass unchanged.
- [ ] **S03-AC7:** JSON and PostgreSQL suites pass; endpoint responses are byte-for-byte identical for the characterization fixtures.

## Implementation tasks

1. Land characterization tests for D2, D4, D5 first (they will pass on current code).
2. Extract in this order: D3 → D4 → D1/D2 → D5 → D7/D8 → D6 → D9. One commit per cluster.
3. Re-run the duplicate-name scan and the full gate after each cluster.

## Boundaries

No scoring-formula changes (a formula discrepancy found in D8 becomes a separate bug). No schema changes. Hiring-related logic is not to be "simplified" in a way that alters outputs; the human-review boundary in the README is unchanged.
