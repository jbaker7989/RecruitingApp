# NFR-DATA-002-S02: Make Job Writes Atomic in PostgreSQL

**Status:** Implemented; local verification passed (2026-10-26)  
**Priority:** Critical (P2 — after S01)  
**Size:** L (1–2 days) — four handlers; bulk import needs atomic all-rows commit with preserved per-row result semantics, plus rollback and concurrency tests  
**Parent feature:** [Repair PostgreSQL Company and Job Write Paths](../../features/platform/feature-postgresql-write-path-repair.md)  
**Tracks:** NFR-065, NFR-067  
**Dependency:** Persisted company from S01 for end-to-end verification.

## User story

As a recruiting operator, I need job creation, import, edits, and deletion to persist in PostgreSQL so applicants see current openings and concurrent staff work does not disappear.

## Current failure and scope

`POST /api/jobs`, `POST /api/jobs/import`, `PUT /api/jobs/:id`, and `DELETE /api/jobs/:id` each call `writeStore` after mutating a detached snapshot. All four paths fail against the configured PostgreSQL backend. This story migrates those routes to `updateStore` while preserving existing validation, role checks, generated fields/defaults, import result shape, and response codes.

## Acceptance criteria

- [x] **S02-AC1:** Authorized job creation for a persisted company returns 201 only after commit. A fresh PostgreSQL read finds the new job with the existing defaults, and the create audit event is appended after commit. A missing company returns the existing 404 without a job or success audit.
- [x] **S02-AC2:** Job import parses the existing CSV or JSON shapes and reports `totalRows`, `successes`, `failures`, `errors`, and `jobsCreated` as before. The company existence check occurs inside the mutator. All rows reported as created are committed together before a 200 response; a failed commit returns an error and leaves no new imported jobs or success audit.
- [ ] **S02-AC3:** Authorized update and delete find the current job inside `updateStore`, preserve the existing response behavior, and persist the change. Missing job IDs retain 404 and cause no mutation.
- [x] **S02-AC4:** Concurrent independent job writes preserve both committed changes. Job routes contain no production `writeStore` calls or detached-snapshot mutations expecting persistence.
- [x] **S02-AC5:** Focused real-PostgreSQL tests cover create, import, update, delete, missing parent/target, commit failure, and concurrent writes. Applicable JSON-mode regression tests remain green.

## Implementation tasks

1. Write focused PostgreSQL regression cases that show the unsupported-write failure for each route family. Seed a company directly with `updateStore` or use S01's verified company route; do not depend on a previous test's mutable module-level ID.
2. Convert job create. Keep request validation and server-side field construction outside the mutator; recheck the company and append the job inside the mutator. Return a typed not-found or created outcome.
3. Convert import. Parse and normalize candidate rows before the mutator. Recheck the company and push the successful candidates in one mutation. Preserve row-level parsing errors in the result. Send success and append the import audit only after commit.
4. Convert update and delete with current-state lookup inside the mutator. Preserve existing role checks and status/response shapes.
5. Run focused PostgreSQL and JSON checks. Review all four route paths for accidental changes to defaults, validation, and audit sequencing.

## Verification

Use an isolated PostgreSQL schema with `USE_DATABASE=true` and `DB_TEST_REQUIRED=true`. Assert response data and fresh persisted records, including all imported IDs. Force a commit failure and confirm no partial import or success audit. Race two independent updates or creations and confirm both are present. Run `npm test`, `npm run typecheck`, and `npm run lint` before handing the slice to S03.

## Boundaries and open product choice

The current import route counts per-row parsing successes and failures, then writes once. The default for this repair is to retain those row results while making the database write of successful rows atomic. A database commit failure must not be represented as per-row success. If the team wants partial database commits per row, record that as an explicit product and storage-contract change before implementation.

This story does not change job validation rules, role policy, company deletion relationships, schema, or the existing `writeStore` fail-closed behavior.

## Local verification evidence (2026-10-26)

Independent validator: CICD-tester (Claude Opus 5.5). Tested HEAD `6bbdeda7808f2b5ccb1dffd027d94b3a9fa13155` plus the uncommitted implementation in this shared checkout; no implementation commit or hosted run exists. Node 24.20.0, npm 12.1.0, disposable PostgreSQL 16.15, synthetic data, unique schemas, `DB_TEST_REQUIRED=true`, `USE_DATABASE=true`, `NODE_ENV=test`.

The ordered gate passed: `npm ci`, PostgreSQL readiness, typecheck, lint (0 errors, 178 warnings), build, JSON `npm test` (378 pass, 0 fail, 0 test skips; PostgreSQL suites skipped at suite level), strict `test:db` (51 tests: 48 pass, 0 fail, 3 inverse prerequisite-guard skips), then built-artifact PostgreSQL smoke (`smoke-health=ok`). A fresh-schema database rerun returned the same totals. Smoke checks `/health` and database initialization, not company/job mutations.

Required-database negative checks: absent URL exits 1 (5 pass, 5 fail); unreachable database exits 1 with `ECONNREFUSED` (0 failures reported but 43 cancelled, not a pass); unreachable-database smoke exits 1. Logs: `/tmp/nfr-data-002-tester-20261026021557/` (`01-npm-ci.log` through `12-test-db-rerun.log`). No new gate failures were found. Hosted GitHub Actions evidence and hosted production durability remain pending.

Passing tests in `tests/integration/database-jobs.test.ts` (11/11), independently exercised by `test:db`:

- AC1: `S02-AC1: create persists the job with existing defaults and appends the audit after commit`; `S02-AC1: create keeps validation, role checks and missing-company 404 without mutation`; `S02-AC1/F-AC4: failed create commit returns an error, persists no job and appends no audit`.
- AC2: `S02-AC2: JSON import commits every created row and reports the existing result shape`; `S02-AC2: CSV import persists rows with existing defaults`; `S02-AC2: import keeps 400/404 responses and does not mutate on missing parent or bad input`; `S02-AC2/F-AC4: failed import commit persists none of the rows and no success audit`.
- AC3 (partial, unchecked): `S02-AC3: update merges into the current job, persists it and keeps 404 for missing IDs`; `S02-AC3: delete removes only the target job and keeps the existing response`.
- AC4: `S02-AC4: concurrent independent job writes all persist`; `S02-AC4/F-AC3: job routes use updateStore and writeStore still rejects PostgreSQL`.
- AC5: all 11 focused tests above, plus the passing JSON gate including existing import regressions.

AC3 remains unchecked because its missing-ID 404 wording conflicts with the existing DELETE contract. DELETE preserves 200 `{message:'Job deleted'}` with no mutation; PUT retains 404. The explicit instruction to preserve response contracts takes precedence; no acceptance-criteria rewrite is claimed. Import retains an early read-only parent check for existing error precedence and repeats the authoritative check inside the mutator. A parent disappearing between those checks is not deterministically tested.

Failing-test baseline: 2 pass / 9 fail before route changes. Developer logs: `/tmp/nfr-data-002-s02-logs/`. Independent lint identified one added warning for the type-only `JobPosting` import under the base unused-vars rule; lint still exits 0.
