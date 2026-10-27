# Bug Story: JD draft publish lacks company authorization

**Tracking ID:** NFR-046
**Status:** Complete (QA passed; local only)
**Priority:** High (P1) — security / data-integrity
**Size:** S (1–3h)
**Created:** 2026-10-23
**Resolved:** 2026-10-23
**Source:** Static route review, `agents/jdGenerator.ts` cross-tenant publish path
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

A hiring manager can generate a draft against any company UUID and publish a live job posting for a company they do not belong to. This is a cross-tenant job-posting-injection risk and a company-data-integrity risk for any deployment where multiple employers share the system.

## Evidence

`src/routes/agents/jdGenerator.ts:94–166` (`POST /api/agents/jd/generate`) accepts any well-formed `companyId` after the route-level `requireRole(['hiring-manager', 'member-services'])` check. The handler reads the company for context only (`store.companies.find(...)` near line 122) and never compares `req.user.companyId` to `input.companyId`.

`src/routes/agents/jdGenerator.ts:508–593` (`POST /api/agents/jd/drafts/:id/publish`) verifies `draft.userId === userId` (originally at line 521) but never verifies that the publishing user belongs to `draft.companyId`. After that check, the handler unconditionally pushes a new `JobPosting` into `store.jobs` with `draft.companyId`.

`User` model (`src/models/store.ts:127–137`) already exposes `companyId?: string`; `src/routes/companies.ts:25–29` already sets `store.users[userIndex].companyId = company.id` when a hiring manager creates a company. The membership signal exists — only the route check is missing.

## Acceptance criteria

1. A `hiring-manager` whose `user.companyId` is set receives `403` when `POST /api/agents/jd/generate` is called with any other `companyId`. The draft is not created and no LLM call is made.
2. A `hiring-manager` whose `user.companyId` is set can call `POST /api/agents/jd/generate` with their own `companyId` (or omit it) and proceed normally.
3. A `member-services` user can call `POST /api/agents/jd/generate` with any `companyId` (admin override).
4. `POST /api/agents/jd/drafts/:id/publish` rejects (403) when `draft.companyId` is set and does not match the publishing hiring-manager's `user.companyId`. The job is not created and the draft status is unchanged.
5. `POST /api/agents/jd/drafts/:id/publish` succeeds (201) when a hiring-manager publishes their own draft whose `companyId` matches their own. `member-services` users can publish any draft for any company.
6. Existing 401/403/404/400 paths (missing token, wrong role, draft not found, already published, missing company) still behave as before.

## Regression and CI coverage

Four focused route-level tests against a real running app on an ephemeral port with a temp `DATA_DIR`. Publish tests seed drafts directly via the in-process `updateStore` so the LLM is never invoked; the generate test runs the route against a stubbed `ChatOpenAI.prototype.invoke`:

- **authorized publish** — hiring-manager creates a draft via direct store insert (no LLM) with `companyId === user.companyId`, then publishes and expects 201 with a new `JobPosting` and the draft flipped to `published`.
- **cross-tenant publish rejected** — hiring-manager attempts to publish a draft whose `companyId` differs from their own; expects 403, no job inserted, draft status still `draft`.
- **admin override** — `member-services` user publishes a draft owned by a hiring-manager for a company the admin does not belong to; expects 201 even though the admin is not the draft owner.
- **cross-tenant generate rejected** — hiring-manager calls `POST /generate` with a foreign `companyId`; expects 403, no LLM call, no draft persisted.

Run under the normal CI gate alongside typecheck, lint, build, smoke, and the existing tests. No new dependencies.

## Estimate rationale

Small: one route handler pair plus four route-level regressions. The membership signal (`User.companyId`) is already set when a hiring manager creates a company; no model or schema change is needed. The fix introduces one helper (`assertCompanyAuthorization`) and a new `403` branch on each of the two routes. Implementation and regression coverage are included; deployment and review waiting time are excluded. Tracking is unrelated to database-migration regressions.

## Resolution (2026-10-23)

- **Fix 1 (`/generate`):** new `assertCompanyAuthorization(res, user, companyId, action)` helper gates `POST /api/agents/jd/generate` before any LLM call or store write; hiring-managers must supply their own `companyId` or omit it; `member-services` are always allowed.
- **Fix 2 (`/publish`):** mutator now resolves the publisher once and applies both checks: ownership bypass for admins (`isAdmin = role === 'member-services'`), then `companyId` match for everyone else. The publish path returns 403 before any `JobPosting` is pushed to `store.jobs`.
- **Tests:** new `tests/regression/NFR-046-jd-draft-publish-auth.test.ts` — 4/4 green: authorized publish, cross-tenant publish rejected, admin override, cross-tenant generate rejected.
- **Gates:** `npm run typecheck` ✅ · `npm run lint` 0 errors ✅ · `npm run build` ✅ · `npm test` 394/394 ✅ · `npm run smoke` ✅.
- **Out of scope:** variants, draft update, and draft delete still rely on user-level ownership only — follow-up bugs are filed separately. Hosted acceptance is pending the same hosted-CI blocker as the other durable-store stories.