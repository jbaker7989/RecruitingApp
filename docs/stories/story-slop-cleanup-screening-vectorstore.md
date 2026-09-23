# Story: Clean Up Slop in Screening Routes & Pinecone Vector Store Migration

**Status:** Done
**Priority:** Low (code quality, no behavior change intended except one perf fix)
**Created:** 2026-09-23 (uncommitted-diff slop review)

## Overview

A review of the uncommitted working-tree diff (candidate screening endpoints in
`src/routes/agents/index.ts`, the duplicate-application check in
`src/routes/applications.ts`, and the Pinecone migration of
`src/services/vectorStore/index.ts` / `pinecone.ts`) turned up leftover
AI-generated cruft and one redundant/wasteful abstraction introduced during
the Pinecone swap. None of these are functional bugs in the sense of wrong
output today, but they either add noise for future readers or cost real
money/latency on every semantic-search call.

## Findings

1. **Lint-suppression cruft** (`src/routes/agents/index.ts`,
   `/screening/:jobId/result`): the loop that patches application records
   counted `updated` and then immediately discarded it with
   `void updated; // suppress lint`. The count was computed for no reason —
   either use it or don't compute it. Fixed by folding it into the
   observability log entry, which is genuinely useful debugging context.

2. **Process-narration comment** (`src/routes/agents/index.ts`, end of file):
   `// ── Keep existing routes above, add new screening section below ──` is a
   note to the editor about *how the diff was constructed*, not documentation
   of the code. Removed.

3. **Redundant re-embedding on every similarity query**
   (`src/services/vectorStore/index.ts`): `findSimilarJobsForApplicant`,
   `findSimilarApplicantsForJob`, and `calculateSemanticSimilarity` all fetch
   a `VectorEntry` that was already embedded once at index time, then call
   `store.findSimilar(entry.text, embeddings, ...)` — which re-embeds that
   same text through the OpenAI embeddings API before searching. Pinecone's
   `fetch` already returns the stored vector (`values`), but
   `pinecone.ts#toVectorEntry` was dropping it. This means every "similar
   jobs for applicant" / "similar applicants for job" / semantic-match-score
   call was paying for an extra embedding API call it didn't need. Fixed by
   carrying `embedding` through `VectorEntry` and calling
   `similaritySearch(entry.embedding, ...)` directly instead of
   `findSimilar(entry.text, ...)`.

4. **Redundant explicit default argument** (`src/routes/applications.ts`):
   `validateApplicationBody(req.body, false)` — `false` is already the
   function's default value for `requireProfile`, so passing it explicitly
   adds nothing. Simplified to `validateApplicationBody(req.body)`.

## Acceptance Criteria

1. No behavior change for findings 1, 2, and 4 — pure cleanup.
2. Finding 3 must not change search results (cosine similarity computed from
   the same embeddings as before), only remove the redundant embedding API
   call.
3. Removed/replaced code is left commented out inline with a reference to
   this story for reviewers to diff against, per the requested review
   process for this pass.

## Notes

This was a scoped cleanup pass over the current uncommitted diff only —
it does not attempt a full-repo slop audit.
