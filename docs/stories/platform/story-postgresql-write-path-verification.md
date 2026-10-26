# NFR-DATA-002-S03: Verify PostgreSQL Write Paths and Isolate Acceptance Tests

**Status:** Implemented; local and hosted CI verification passed (2026-10-26); AC6 awaiting reviewer sign-off  
**Priority:** Critical (P3 — tests authored first, closed last)  
**Size:** M (3–6h) — fixture isolation, trigger-based rollback test, full gate run and CI evidence capture; excludes time to fix newly revealed defects  
**Parent feature:** [Repair PostgreSQL Company and Job Write Paths](../../features/platform/feature-postgresql-write-path-repair.md)  
**Tracks:** NFR-034, NFR-064, NFR-065, NFR-067  
**Dependency:** S01 and S02 for final end-to-end acceptance; focused tests should be authored before their production changes.

## User story

As a lead developer, I need the real PostgreSQL gate to identify the first defect accurately and prove all company and job mutations are durable, so a green JSON suite cannot mask failed production writes.

## Current failure and scope

The database suite presently reports five failures, beginning with company creation through unsupported `writeStore`. Later tests reuse module-level `companyId`, `jobId`, `applicantId`, and `applicationId` values set only inside the aborted end-to-end test. They then produce zero duplicate conflicts, `/api/applications//status`, invalid reset token, and a rollback test that never reaches the target applicant row. The suite needs independent setup for separately named tests while retaining one coherent end-to-end flow.

## Acceptance criteria

- [x] **S03-AC1:** The real PostgreSQL suite tests each of the seven affected route paths, including status, fresh persisted state, not-found behavior, relevant audit effects, and rollback. At least one concurrency case proves independent writes are preserved.
- [x] **S03-AC2:** Tests for duplicate/capacity submissions, status/hire creation, password reset, and reset rollback have explicit prerequisites in their own fixture or a named enclosing flow. A failed company route cannot silently leave empty IDs for a later independent assertion.
- [x] **S03-AC3:** The reset rollback test seeds a real applicant and token, installs a trigger on that applicant row, observes the intended database rejection, confirms the token remains unused, then retries successfully after removing the trigger.
- [x] **S03-AC4:** With a disposable PostgreSQL 16 service, `npm run test:db` passes with `DB_TEST_REQUIRED=true`, and the existing built-artifact PostgreSQL smoke step runs and passes on the same revision. A missing or unreachable database still fails rather than skipping.
- [x] **S03-AC5:** `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` pass. The direct store-contract test continues to prove `writeStore` rejects PostgreSQL mode. No assertion is weakened or removed merely to make CI green.
- [ ] **S03-AC6:** Record the CI run URL, commit SHA, test counts, any new failures discovered after the first blocker is removed, and the reviewer. Mark the parent feature complete only with the required hosted production evidence, which this story does not supply.

## Implementation tasks

1. Add focused failing tests before S01/S02 production edits. Use synthetic data and a unique `DATABASE_SCHEMA` for the test file/run.
2. Replace shared mutable IDs between independent tests with fixture functions that seed the required company, job, applicant, application, and reset token, or deliberately group dependent steps in one test with clear substeps. Keep fixtures in `updateStore`, never `writeStore`.
3. Add a direct test that PostgreSQL `writeStore` still throws. Add failure-path checks for database commit rollback and no success audit after failure.
4. Run the focused cases, then the complete database suite and smoke. Triage any newly revealed production defect instead of classifying all downstream failures as fixed by the first green company test.
5. Capture the GitHub Actions run on the implementation revision and update the feature acceptance ledger with pass or remaining blocker for each criterion.

## Verification command and evidence

The existing `.github/workflows/database-ci.yml` supplies PostgreSQL 16, Node 24, `DATABASE_URL`, `USE_DATABASE=true`, `DB_TEST_REQUIRED=true`, and `NODE_ENV=test`. It runs `npm ci`, typecheck, lint, build, `npm run test:db`, then `npm run smoke`. Retain that order and strict failure behavior. Local verification must use a disposable schema and the same database-required flag; `npm test` alone is insufficient because it can skip PostgreSQL integration tests.

For each acceptance criterion, record a test name and CI job URL. A passing test that never reached its intended row, route, or trigger does not count as evidence.

## Boundaries

Do not disable the database workflow, convert a failing assertion to a skip, weaken the expected status or persisted-state assertions, use real applicant data, or claim hosted production durability from local CI. The database fixture repair is test architecture work; it does not authorize new product behavior.

## Local verification evidence (2026-10-26)

Independent validator: CICD-tester (Claude Opus 5.5). Tested HEAD `6bbdeda7808f2b5ccb1dffd027d94b3a9fa13155` plus the uncommitted implementation in this shared checkout; no implementation commit or hosted run exists. Node 24.20.0, npm 12.1.0, disposable PostgreSQL 16.15, synthetic data, unique schemas, `DB_TEST_REQUIRED=true`, `USE_DATABASE=true`, `NODE_ENV=test`.

The ordered gate passed: `npm ci`, PostgreSQL readiness, typecheck, lint (0 errors, 178 warnings), build, JSON `npm test` (378 pass, 0 fail, 0 test skips; PostgreSQL suites skipped at suite level), strict `test:db` (51 tests: 48 pass, 0 fail, 3 inverse prerequisite-guard skips), then built-artifact PostgreSQL smoke (`smoke-health=ok`). A fresh-schema database rerun returned the same totals. Smoke checks `/health` and database initialization, not company/job mutations.

Required-database negative checks: absent URL exits 1 (5 pass, 5 fail); unreachable database exits 1 with `ECONNREFUSED` (0 failures reported but 43 cancelled, not a pass); unreachable-database smoke exits 1. Logs: `/tmp/nfr-data-002-tester-20261026021557/` (`01-npm-ci.log` through `12-test-db-rerun.log`). No new gate failures were found. Hosted GitHub Actions evidence and hosted production durability remain pending.

Passing named tests and scope:

- AC1: the company 13-test and job 11-test PostgreSQL suites named in S01/S02 provide all seven routes, persisted-state, rejection, relevant audit, rollback and concurrency evidence. The acceptance flow `staff, company, job, import, applicant, application, matching, scheduling, MCP and audit paths persist` also exercises all seven routes. Existing missing-ID DELETE responses remain 200; the S01-AC3/S02-AC3 wording gaps remain open.
- AC2: `concurrent duplicate and capacity submissions have one coherent winner`; `status acceptance and hire creation commit atomically; audit evidence persists`; `password reset is single-use and persists the bcrypt replacement`; `database failure during applicant password update rolls back token consumption` now have independent prerequisites. The end-to-end flow keeps its dependent IDs local.
- AC3: `database failure during applicant password update rolls back token consumption` reaches the seeded applicant's rejecting trigger, asserts unused token and unchanged hash, drops the trigger, retries successfully and checks committed token/hash.
- AC5: `writeStore rejects PostgreSQL snapshots and leaves committed rows unchanged` in `database-store-contract.test.ts`, plus the full passing quality/JSON gate. Independent diff inspection found no weakened assertions, new skip/only/todo markers, workflow, schema or dependency changes.

AC4 is checked: the local portions above plus the hosted run below. AC6 remains unchecked only because no named human reviewer sign-off is recorded; run URL, SHA, counts and absence of new failures are recorded here.

Hosted evidence: [Actions run 40279372008](https://github.com/jbaker7989/RecruitingApp/actions/runs/40279372008) `database` job on PR #24 head `c564aef` (squash-merged as `8ecbef1`): strict `test:db` 51 tests / 48 pass / 0 fail / 3 prerequisite-guard skips, then built-artifact smoke `smoke-health=ok`; quality, verify, local-backend and applicant-pii-regression also passed. No new failures revealed.

Baseline unchanged acceptance suite: 13 pass / 5 fail / 2 skips. New tests against original HEAD routes in a temporary copy: 18 pass / 1 end-to-end company-create failure / 3 guard skips; independent fixture tests no longer cascaded. Developer logs: `/tmp/nfr-data-002-s03/`. The durability suite now generates its own unique schema instead of honoring an externally supplied schema name.
