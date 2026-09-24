# Story: Duplicate-Application-Prevention Edge Cases (Bug/Gap List)

**Status:** Open
**Priority:** High (item 1 and 3 are security/correctness risks; rest are coverage gaps)
**Created:** 2026-09-24 (test review of `tests/regression/NFR-048-duplicate-application-prevention.test.ts`)

## Overview

`NFR-048-duplicate-application-prevention.test.ts` covers the happy paths of
duplicate-application prevention (`POST /api/applications`,
`POST /api/applicants/:id/apply`, `GET /api/applicants/me/jobs`), but a
review found several edge cases the current tests don't exercise. Some are
just test-coverage gaps; a couple point at plausible real bugs in
`src/routes/applications.ts`. Each is listed as its own bug below so they
can be triaged/fixed independently.

## Bugs / Gaps

### 1. Unauthenticated caller can supply an arbitrary `applicantId`
`POST /api/applications` resolves the applicant as
`req.user?.role === 'applicant' ? req.user.id : req.body.applicantId`. When
there is no `Authorization` header, `req.user` is undefined and the route
falls through to trusting `req.body.applicantId` outright — i.e. an
unauthenticated caller can submit (or duplicate-check) an application on
behalf of any applicant id they choose, with no proof of identity.

**Acceptance Criteria**
- Add a test: `POST /api/applications` with no `Authorization` header and an
  `applicantId` belonging to another applicant.
- Decide and document the intended behavior (reject unauthenticated
  submissions entirely, or accept them — this route currently has no
  `authenticateApplicant` middleware at all). If acceptance is intentional,
  add a story note explaining why; if not, require auth.

### 2. Authenticated token identity vs. mismatched body `applicantId` is untested
Every authenticated test in the suite sends a body `applicantId` that
matches the token's own id, so the "token id always wins over body id"
precedence in the route is never actually exercised.

**Acceptance Criteria**
- Add a test: authenticated request where `req.user.id` and
  `req.body.applicantId` differ. Assert the application is recorded under
  the *authenticated* applicant, not the body value.

### 3. Duplicate check is a check-then-insert race (TOCTOU)
The duplicate lookup reads the store, checks for an existing application,
and only then writes the new one. Two concurrent `POST /api/applications`
calls for the same applicant+job could both pass the "no existing
application" read before either write completes, producing two
applications for the same applicant/job pair.

**Acceptance Criteria**
- Add a test that fires two concurrent duplicate requests
  (`Promise.all([...])`) and asserts exactly one succeeds with `201` and the
  other returns `409`.
- If the test reveals both succeed, fix `src/routes/applications.ts` to
  serialize the check+write (e.g. a per-applicant/job lock, or an atomic
  "insert if absent" on the store).

### 4. No cross-endpoint duplicate detection test
There are two application entry points: `POST /api/applications` (new,
authenticated) and `POST /api/applicants/:id/apply` (legacy). Each is
tested for duplicates against itself only.

**Acceptance Criteria**
- Add a test: apply via the legacy endpoint, then attempt the same
  applicant+job via `POST /api/applications` (and vice versa). Assert `409`
  in both directions.

### 5. Reapplication after withdrawal/rejection is undefined
The duplicate check matches on `applicantId + jobPostingId` only — it does
not consider the existing application's status. If applications can be
withdrawn or rejected elsewhere in the app, there's no test (or documented
behavior) for whether an applicant can ever reapply to the same job.

**Acceptance Criteria**
- Determine intended product behavior with the team.
- Add a test covering it (either "reapplication after withdrawal is
  allowed" or "reapplication is permanently blocked, by design").

### 6. Ordering between "job inactive" and "duplicate application" is untested
If an applicant already applied to a job and the job is later deactivated,
it's unclear (and untested) which error a second attempt should surface —
`400 Job is no longer accepting applications` or `409 Already applied`.

**Acceptance Criteria**
- Add a test: apply to an active job, deactivate the job, attempt to apply
  again. Assert the expected status code and document the precedence.

### 7. Test suite has order-dependent shared state
The "applicant can apply to different jobs" test injects `job-2` directly
via `store.writeStore()` mid-suite instead of seeding it in `before()`,
making that test implicitly dependent on running after suite setup rather
than being self-contained.

**Acceptance Criteria**
- Move all fixture data (jobs, companies) into `before()` so each test only
  reads/creates the applicants/applications it needs.
