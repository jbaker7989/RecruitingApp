# NFR-SLOP-S08: Fix Misleading Names, Process-Narration Comments, Stale Docs and Fake Data That Looks Real

**Status:** Proposed
**Priority:** Low–Medium (P3); the simulated-data item is P2 because it can reach users
**Size:** S–M (2–4h) — text and constants, plus tests that assert the literal strings
**Tracks:** NFR-027; brand-copy migration (README status table)
**Parent:** [Code hygiene remediation](README.md)

## Problem

Text in code and docs that lies, narrates the editing process, or masquerades as real data. It is cheap to fix and expensive to leave, because readers (and AI agents working in this repo) treat comments and docs as ground truth.

## Findings

### A. Simulated data that is indistinguishable from real data (P2)

`src/agents/scheduling/agent.ts:256-258` creates `calendarEventId = cal_<uuid>` and `videoLink = https://meet.example.com/interview-<id>` and stores them on the workflow state as the interview's `calendarEventId` and `location`. Nothing marks them as simulated in the data itself (only the telemetry attribute `simulated: true`). If any candidate-facing message, dashboard or export renders `location`, an applicant is sent to a non-functioning link, or hiring staff believe a calendar hold exists. Likewise line 163 ("For now, we'll simulate receiving proposed times").

Action: make simulation explicit in the data (for example `integration: 'simulated'` and a `simulated: true` field on the record, with an obviously fake host such as `https://simulated.invalid/...`), ensure no outbound message template includes it while simulated, and gate on a single `SCHEDULING_INTEGRATION=simulated|live` switch so the "For now" comments become a real boundary. Add a test that candidate communications generated from a simulated interview never contain a link.

### B. Misspelled product name in runtime output and metadata

"New **Fronteir** Recruiting" appears in `src/index.ts:55,78` (the root and `/health` JSON), `src/routes/mcp.ts:83`, `src/agents/README.md:3`, `package.json` `description`, `brain/brain.md`, five `SKILL.md` stubs, `BUGS.md`, and the repo-root prompt file. The README states the brand is "New Frontier Recruiting" and that migration is in progress. Fix all code/metadata occurrences in one change, update every test that asserts the old string, and leave a single historical note in `BUGS.md` rather than rewriting history in evidence documents.

### C. Process-narration and "for now" comments

Comments that describe how the code was written, or promise future work with no owner:

- `src/middleware/validation.ts:63` `// For now, expect file in req.body.file or req.file` (function is dead; see S02).
- `src/agents/scheduling/agent.ts:163,256` "For now / Simulate" (see A).
- `src/routes/auth.ts:108` `// POST /api/auth/oauth-stub - OAuth stub endpoint` (endpoint removed in S02).
- `src/services/vectorStore/pinecone.ts:271` `sanitized until schema updated` (stale if the schema has since been updated; verify).
- Section-banner comments such as `// ──` / `// ====` repeated in route files carry no information beyond the code.

Rule applied: keep comments that state *why* or a constraint (security, ordering, an NFR link); delete comments that restate the next line or narrate the edit; convert every surviving "for now" into a tracked issue ID or remove it.

### D. Stale documentation that contradicts the code

- `data/SKILL.md` and the four `*-management/SKILL.md` stubs describe JSON-file persistence and "Fronteir"; storage is PostgreSQL-capable and the JSON mode is legacy.
- `src/agents/README.md` describes "LangChain/LangGraph-based" workflows; the scheduler is a hand-written state machine (README §11 already says so).
- `BUGS.md` NFR-027 says `express-fileupload` is "never wired" and `fileUpload.ts` is a "no-op"; the middleware is wired at `src/index.ts:75`. Update NFR-027's evidence so it reflects `main`.
- Duplicated sections in `README.md` §11 versus the feature docs — keep README as the status truth and link out.

## Acceptance criteria

- [ ] **S08-AC1:** Simulated scheduling output is explicitly marked in the persisted record and cannot be rendered as a live link in any candidate-facing message; test added.
- [ ] **S08-AC2:** `grep -rIl "Fronteir" src package.json views public` returns nothing; tests asserting the string are updated in the same commit; the `/health` consumers (Vercel, Docker healthcheck, smoke) are checked and still pass.
- [ ] **S08-AC3:** No "for now" / "for the time being" / "TODO without owner" comment remains in `src/` unless it cites a tracked ID. `grep -rniE "for now|simulate" src` hits are limited to the explicit simulation boundary.
- [ ] **S08-AC4:** The four stale documents above are corrected or removed, and no document claims behavior (JSON persistence as primary, LangGraph execution) that `main` does not implement.
- [ ] **S08-AC5:** NFR-027's BUGS.md entry reflects the real remaining items after S01–S02 (link to this feature) instead of stale evidence.
- [ ] **S08-AC6:** JSON and PostgreSQL suites and the Docker smoke pass.

## Implementation tasks

1. Fix A with tests first (candidate message contains no link when simulated).
2. Brand-string change across code and metadata in one commit; update tests; run smoke.
3. Comment and doc pass using the keep/delete rule; list deletions in the PR.
4. Update BUGS.md NFR-027 and link this feature.

## Boundaries

Do not rewrite historical evidence documents (QA records, resolution `.docx` files) for the brand fix. Do not implement a real calendar integration. Do not change API field names.
