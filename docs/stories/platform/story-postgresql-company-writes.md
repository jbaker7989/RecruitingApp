# NFR-DATA-002-S01: Make Company Writes Atomic in PostgreSQL

**Status:** Implemented; local verification passed (2026-10-26)  
**Priority:** Critical (P1 — first in execution order)  
**Size:** M (3–6h) — three handlers, one cross-record transaction (company + manager link), new focused PostgreSQL tests  
**Parent feature:** [Repair PostgreSQL Company and Job Write Paths](../../features/platform/feature-postgresql-write-path-repair.md)  
**Tracks:** NFR-064  
**Dependency:** Existing `updateStore` contract; this story precedes the full job flow.

## User story

As a recruiting operator, I need company creation and maintenance to commit when PostgreSQL is configured so that I can create jobs for a real persisted company. As a hiring manager, I need my new company association to commit with company creation.

## Current failure and scope

`POST /api/companies` returns 500 in the PostgreSQL gate because it calls `writeStore`, which the database backend deliberately rejects. `PUT /api/companies/:id` and `DELETE /api/companies/:id` use the same unsupported API. The current create route also links the creating hiring-manager user in the same mutated snapshot. This story converts those three route writes to `updateStore` without changing authorization, payloads, response shape, or the separate audit event contract.

## Acceptance criteria

- [x] **S01-AC1:** With PostgreSQL configured, an authorized `POST /api/companies` returns 201 only after the company row commits. A fresh `readStore()` and a new process can read the company. The response keeps the existing fields and defaults.
- [x] **S01-AC2:** When the creator is a hiring manager with a persisted user row, the new company and `user.companyId` are committed in one `updateStore` call. A forced failure rolls both changes back. A member-services creator does not acquire an unintended association.
- [ ] **S01-AC3:** Authorized `PUT /api/companies/:id` updates the current company row through `updateStore`. Authorized `DELETE /api/companies/:id` removes it through `updateStore`. A missing ID keeps the existing 404 behavior and changes no row.
- [x] **S01-AC4:** Two concurrent company mutations do not lose either committed change. No company route calls `writeStore` or mutates a `readStore()` snapshot expecting persistence.
- [x] **S01-AC5:** Company create appends its existing success audit event only after commit. A failed transaction emits no success response or success audit. The direct PostgreSQL `writeStore` rejection remains intact.
- [x] **S01-AC6:** Focused PostgreSQL tests and applicable JSON-mode regressions pass; role restrictions and error response contracts remain covered.

## Implementation tasks

1. Add a real-PostgreSQL create test that demonstrates the present 500 and specifies the committed company and manager-link result. Add update/delete, missing-ID, and rollback cases.
2. Change create to build the server-generated company outside the mutator, then insert it and link the current hiring-manager user inside one `updateStore` callback. Return the committed outcome; append the audit event and send 201 after commit.
3. Change update/delete to find the target inside a mutator and return an explicit `updated`, `deleted`, or `not-found` outcome. Do not send HTTP responses or append audit entries inside the callback.
4. Verify concurrency and JSON parity, inspect the diff for accidental response or authorization changes, and record the focused test results.

## Verification

Run the focused company PostgreSQL test with a disposable schema and `DB_TEST_REQUIRED=true`, then `npm test`, `npm run typecheck`, and `npm run lint`. The test must assert HTTP status **and** a fresh database read. Simulate a mutator or commit failure to prove the manager link and company do not partially persist. Follow the parent feature's full command and environment contract before closing the story.

## Boundaries and dependencies

- Preserve `requireRole(['hiring-manager', 'member-services'])` on create/update and `requireRole(['member-services'])` on delete.
- Preserve existing company deletion behavior concerning dependent jobs; changing cascade policy is separate work.
- No schema change, SQL repository, new dependency, JSON fallback, or PostgreSQL `writeStore` compatibility layer.
- S02 job creation can rely on S01's persisted company, but S01 must be verifiable without S02.

## Local verification evidence (2026-10-26)

Independent validator: CICD-tester (Claude Opus 5.5). Tested HEAD `6bbdeda7808f2b5ccb1dffd027d94b3a9fa13155` plus the uncommitted implementation in this shared checkout; no implementation commit or hosted run exists. Node 24.20.0, npm 12.1.0, disposable PostgreSQL 16.15, synthetic data, unique schemas, `DB_TEST_REQUIRED=true`, `USE_DATABASE=true`, `NODE_ENV=test`.

The ordered gate passed: `npm ci`, PostgreSQL readiness, typecheck, lint (0 errors, 178 warnings), build, JSON `npm test` (378 pass, 0 fail, 0 test skips; PostgreSQL suites skipped at suite level), strict `test:db` (51 tests: 48 pass, 0 fail, 3 inverse prerequisite-guard skips), then built-artifact PostgreSQL smoke (`smoke-health=ok`). A fresh-schema database rerun returned the same totals. Smoke checks `/health` and database initialization, not company/job mutations.

Required-database negative checks: absent URL exits 1 (5 pass, 5 fail); unreachable database exits 1 with `ECONNREFUSED` (0 failures reported but 43 cancelled, not a pass); unreachable-database smoke exits 1. Logs: `/tmp/nfr-data-002-tester-20261026021557/` (`01-npm-ci.log` through `12-test-db-rerun.log`). No new gate failures were found. Hosted GitHub Actions evidence and hosted production durability remain pending.

Passing tests in `tests/integration/database-company-writes.test.ts` (13/13), also independently exercised by `test:db`:

- AC1: `S01-AC1: member-services create returns 201 with existing fields/defaults and commits durably` (fresh read and separate-process read).
- AC2: `S01-AC2: hiring-manager create commits the company and user.companyId together`; `S01-AC2/AC5: forced failure on the manager link rolls back company and link with no success audit`; `S01-AC2/AC5: forced failure on the company insert leaves the manager link unchanged`. AC1 also checks no member-services association.
- AC3 (partial, unchecked): `S01-AC3: authorized update merges into the current row and persists`; `S01-AC3: update of a missing id returns 404 and changes no row`; `S01-AC3: authorized delete removes the row; dependent jobs are left as before`; `S01-AC3: delete of a missing id keeps its existing response and changes no row`; `S01-AC3/F-AC4: failed update and delete commits return 500 and leave the row intact`.
- AC4: `S01-AC4: concurrent company mutations do not lose committed changes`; `S01-AC4: no company route uses writeStore`.
- AC5: the forced-failure tests above and `S01-AC5: direct PostgreSQL writeStore rejection remains intact`; audit/HTTP are after the awaited commit in the route.
- AC6: `S01-AC6: role restrictions and auth errors are unchanged and write nothing`; all 5 tests in `database-company-json.test.ts` pass, plus the full JSON gate.

AC3 remains unchecked because its missing-ID 404 wording conflicts with the existing DELETE contract. The implementation preserves DELETE 200 `{message:'Company deleted'}` with no mutation, as explicitly required by the implementation brief; PUT retains 404. No behavior change or acceptance-criteria rewrite is claimed.

Failing-test baseline: PostgreSQL 3 pass / 10 fail (one initial auth-body expectation corrected to the actual contract); JSON 4 pass / 1 concurrency failure. Developer logs: `/tmp/nfr-data-002-s01/`.
