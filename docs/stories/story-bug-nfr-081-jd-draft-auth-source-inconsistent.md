# Bug Story: JD draft authorization source is inconsistent between /generate and /publish

**Tracking ID:** NFR-081
**Status:** Open
**Priority:** Medium (P2) — UX / consistency, not a security exploit
**Size:** S (1–3h)
**Created:** 2026-10-23
**Source:** Follow-up from NFR-046 implementation review
**Backlog:** [BUGS.md](../../BUGS.md)
**Related:** [NFR-046 story](./story-bug-nfr-046-jd-draft-publish-auth.md)

## User impact

A hiring manager who has just created a new company sees inconsistent authorization behaviour depending on which endpoint they hit. They cannot generate a draft for the new company until they re-login (their existing JWT has no `companyId`), but they *can* publish a draft for the same company without re-logging in (the publisher lookup reads from the store). The asymmetry is invisible until a tenant encounters it, and there is no error message that hints at the fix.

## Evidence

NFR-046 introduced two authorization checks in `src/routes/agents/jdGenerator.ts`:

- `POST /api/agents/jd/generate` (line 113) calls `assertCompanyAuthorization(res, req.user, companyId, ...)`. The helper reads `req.user.companyId` (the JWT snapshot) only. `req.user` is populated by `src/middleware/auth.ts:74` from `payload.companyId`.
- `POST /api/agents/jd/drafts/:id/publish` (lines 525–547) resolves `publisher = store.users.find(u => u.id === userId)` inside the mutator and compares `publisher.companyId` to `draft.companyId`. This reads from the durable store, not the JWT.

The dominant codebase pattern (`src/routes/applications.ts:147` `/hires` filter, `src/middleware/auth.ts:74`) is JWT-source. NFR-046's `/generate` follows that pattern; `/publish` does not.

A user who registered, created a company (which mutates `store.users[…].companyId`), and did **not** re-login has:

- A JWT without `companyId` → `/generate` with any `companyId` returns 403
- A store record with the new `companyId` → `/publish` against a draft with that `companyId` returns 201

Static route review, 2026-10-23. Not exploitable (the publish-side check is the stricter one), but the asymmetry is a UX and consistency issue introduced by NFR-046.

## Acceptance criteria

1. Both `/generate` and `/publish` resolve the user's authorization from the same source. Recommendation: align on JWT (`req.user.companyId`), matching `/hires` and the rest of the codebase.
2. A hiring manager who creates a company and then publishes a draft for that company without re-logging in receives the same authorization outcome from both endpoints.
3. The fix preserves NFR-046's admin override: `member-services` users can publish any draft and can generate drafts with any `companyId`.
4. Existing NFR-046 regression tests stay green; a new test should specifically cover the "no re-login after company creation" scenario.

## Regression and CI coverage

Add a route-level test that creates a hiring manager, creates a company, generates a draft for the new company via direct store insert, and confirms publish succeeds under the unified check without requiring a re-login. Run under the normal CI gate alongside the existing NFR-046 regression.

## Estimate rationale

Small: one source-of-truth refactor across two adjacent code paths and one new regression. No model or schema change. Implementation and regression coverage are included; deployment and review waiting time are excluded.

## Out of scope

- Multi-company membership (one user, many companies) — the model only supports a single `companyId` per user. Future work.
- Admin override on `/update` and `/delete` — current behaviour (only the owner can edit or archive a draft) is intentional.