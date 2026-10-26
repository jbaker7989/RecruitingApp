# NFR-SLOP-S02: Delete Dead Exports, Commented-Out Code and the Orphan Stub Endpoint

**Status:** Proposed
**Priority:** Medium (P2)
**Size:** M (3–6h) — ~20 symbols plus ~35 commented lines; each needs a "no caller, no test, no doc promise" check
**Tracks:** NFR-027, NFR-023
**Parent:** [Code hygiene remediation](README.md)

## Problem

A cross-reference of every `export` in `src/` against `src/`, `tests/` and `scripts/` finds functions that **nothing references**. Dead exports are not free: they are maintained by accident, show up in reviews, create false "coverage", and — worst — read as supported behavior. Two are security-relevant by position (a stub endpoint that writes to user records; a token-consumption function that bypasses the route that is supposed to own it).

## Inventory

### A. Exports with zero references anywhere (`NEVER referenced`)

| Symbol | File | Disposition to decide |
|---|---|---|
| `isTerminalState` | `src/agents/scheduling/agent.ts` | Delete, or use in the scheduler's loop condition if it duplicates that check. |
| `logAction` | `src/middleware/auth.ts` | Delete. Already listed in NFR-027. Audit logging goes through `addObservabilityEntry`. |
| `parseUploadedFile` | `src/middleware/validation.ts` | Delete. NFR-027 already notes it reads `file.name` off a `Buffer`, i.e. it is wrong as well as unused. |
| `importFromCSV` | `src/services/importService.ts` | Delete (`processImport` is the live path). |
| `getLLMConfig`, `validateApiKeys` | `src/services/llm/index.ts` | Delete `getLLMConfig`. **`validateApiKeys` is the only startup guard for missing provider keys** — confirm it is not meant to be called at boot (if so, wire it; do not delete). |
| `createHireRecord`, `checkJobAutoClose` | `src/services/matching.ts` | Delete **only after** S03 replaces the inline copy in `routes/applications.ts:185` with `createHireRecord`. Do not delete the correct helper while keeping the duplicate. |
| `validateAndConsumeResetToken` | `src/services/passwordResetService.ts` | Delete if `resetPasswordWithToken` supersedes it (the docstring at line ~56 describes the atomic path). A non-atomic consume function that nobody calls is a trap for the next contributor. |
| `startCleanup`, `stopCleanup` | `src/services/revocationService.ts` | Revocation cleanup is never started, so expired revocation entries are never purged. Treat as a **defect candidate**: either wire to server start/shutdown with a test, or delete and record how expiry is handled. |
| `reindexAll`, `deleteJobFromIndex`, `deleteApplicantFromIndex`, `getIndexStats` | `src/services/vectorStore/index.ts` | `deleteJobFromIndex`/`deleteApplicantFromIndex` imply deletes never remove vectors: check whether job/applicant deletion leaves stale Pinecone vectors that later surface in similarity results. Wire or delete; record the decision. |
| `findRates` | `src/telemetry/cost.ts` | Delete or document as public API of the report module. |
| `MAX_TRACESTATE_LENGTH`, `SchedulingOp`, `Collection`, `TargetCounts`, `EducationEntryParsed`, `EmploymentEntryParsed`, `SCREENING_SERVICE_BASE` | various | Delete. `SCREENING_SERVICE_BASE` references a Python service under `agent-home/` that is not part of the Node runtime (see S06). |

### B. Exported only for no reason (used only inside their own file)

About 60 `export` keywords (mostly interfaces/types in `src/telemetry/*`, `src/models/store.ts`, `src/services/*`) have no external importer. This is **low value, high churn** — keep exports that form a documented module API (telemetry types, `StoreMode`), and un-export the rest opportunistically. Do not block the story on this table.

### C. Commented-out code left for "reviewers to diff"

`src/services/vectorStore/index.ts` lines ~213–214, ~259–260 and ~305–317 keep the pre-fix implementation as `//` comments, as demanded by the earlier slop pass ([story](../story-slop-cleanup-screening-vectorstore.md), acceptance criterion 3). That story is **Done** and merged; the comments now duplicate git history and show a deliberately replaced, wasteful implementation. Remove them and keep the story reference in the commit message.

### D. Stub endpoint with no consumer

`POST /api/auth/oauth-stub` (`src/routes/auth.ts:108`) lets a `member-services` or `hiring-manager` user write an arbitrary, **unvalidated** `provider` string to any user's `oauthProvider` field by user ID. Nothing in `src/`, `tests/`, `views/`, `public/` or `docs/` calls it, real OAuth now exists for applicants, and `oauthProvider` influences login behavior. Remove the route, or — if staff OAuth is planned — replace it with a story that validates the provider against the enabled-provider allow-list. Add a regression test that the path returns 404 after removal.

## Acceptance criteria

- [ ] **S02-AC1:** Re-run the cross-reference script (attached to the PR) and show zero "NEVER referenced" exports, except those with a recorded keep-decision in the PR description.
- [ ] **S02-AC2:** Every deleted symbol is classified *dead*, *should be wired* or *defect*. Items classed *defect* (`startCleanup`, vector deletes, `validateApiKeys`) get their own bug entry in `BUGS.md` rather than silent deletion; the owner chooses fix vs. delete before merge.
- [ ] **S02-AC3:** `createHireRecord` is used by `routes/applications.ts` **before** the inline copy is removed (coordinate with S03), or both are deleted by explicit decision.
- [ ] **S02-AC4:** All commented-out code blocks in `src/` are removed (`grep -nE '^\s*//\s*(const|let|if|for|return|await)' src` returns no code); explanatory prose comments remain.
- [ ] **S02-AC5:** `POST /api/auth/oauth-stub` is removed or constrained to a validated allow-list, with a test proving an unauthenticated and an arbitrary-provider request cannot set `oauthProvider`.
- [ ] **S02-AC6:** JSON and PostgreSQL suites pass with totals unchanged apart from added/removed tests for the endpoint above.

## Implementation tasks

1. Commit the reference-scan script under `scripts/` (or paste in PR) so the claim is reproducible.
2. Delete class-A noise symbols; open bug entries for the three *defect* candidates.
3. Remove commented-out blocks (class C).
4. Remove or constrain `oauth-stub` and add its test.
5. Re-run the scan and the full gate.

## Boundaries

Do not delete a function referenced only by docs without updating the doc. Do not change store or schema. Un-exporting (class B) must not alter test imports.
