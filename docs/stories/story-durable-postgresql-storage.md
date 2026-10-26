# Story: Replace Production JSON Persistence with Durable PostgreSQL

**Status:** Company/job write-path implementation complete; local and hosted PostgreSQL CI passed (2026-10-26, PR #24); hosted production durability evidence pending
**Priority:** Critical
**Tracks:** NFR-034, NFR-020, NFR-061–NFR-070
**Feature:** [Durable PostgreSQL Application Storage](../features/platform/feature-durable-postgresql-storage.md)

## User story

As an applicant or recruiting operator, I need every successful change to remain available after process replacement and under concurrent traffic so registration, applications, hiring decisions, imports, and account recovery do not disappear or partially apply.

## Background

The production serverless filesystem is not a database. The prior database attempt loaded PostgreSQL rows into a `DataStore` snapshot, allowed routes to mutate the snapshot, and made `writeStore` a no-op. This story replaces that unsafe behavior with a single atomic storage contract used by every writer.

The storage backend now rejects database-mode `writeStore`, but seven company/job route handlers still call it. The focused remediation and its three stories are specified in [PostgreSQL Company and Job Write Path Repair](../features/platform/feature-postgresql-write-path-repair.md).

## Implementation tasks

- Add PostgreSQL connection, schema migration, startup, shutdown, and readiness behavior.
- Implement atomic `updateStore` for PostgreSQL and concurrency-safe `updateStore` for JSON mode.
- Convert all route and service writers to `updateStore`.
- Persist audit records, password-reset tokens, drafts, hires, and workflow updates.
- Add a JSON-to-PostgreSQL migration command with dry-run, idempotence, and target protection.
- Add real PostgreSQL integration tests and a required database CI job on Node 24.
- Preserve the complete JSON-mode regression suite and built-artifact smoke test.

## Route and service acceptance map

| Tracking ID | Path | Required proof |
|---|---|---|
| NFR-061 | Dashboard registration | Registration redirects, row persists, and the account logs in after a fresh process |
| NFR-062 | Applicant API and reset flow | Register/profile/reset mutations persist; reset consumption and password update are atomic |
| NFR-063 | Applications | Concurrent duplicate/capacity submissions have one coherent winner; status/hire updates are atomic |
| NFR-064 | Companies | Create, update, list, and dependent job reads persist across restart |
| NFR-065 | Jobs and job import | CRUD and bulk imports persist; failed import does not leave partial rows |
| NFR-066 | Dashboard login | PostgreSQL-backed bcrypt and legacy-hash login work through the rendered dashboard flow |
| NFR-067 | Import service | Company/job import changes commit atomically; subsequent audit appends persist separately |
| NFR-068 | Matching and scheduling | Reads use current PostgreSQL state and all workflow state changes persist |
| NFR-069 | Staff auth | Registration, login, profile mutation, OAuth link, and audit records persist |
| NFR-070 | Password verification | Bcrypt verification and successful legacy migration remain correct after restart |

## Test stories

### Storage and lifecycle

- Given a clean database, starting the application applies migrations once and reports ready.
- Given the same database, a second process reads data created by the first.
- Given an unreachable configured database, startup and readiness fail without creating or reading JSON state.
- Given a throwing `updateStore` mutator, no field or collection change is visible afterward.
- Given concurrent updates to separate records and the same counter, all committed changes are present.

### Public HTTP behavior

- Register staff and applicant users, create a company and job, apply, update status, and read the results through public HTTP handlers after restart.
- Race two submissions for the same applicant/job and verify one application, one counter increment, and one duplicate response.
- Race submissions against a one-opening job and verify capacity never exceeds one accepted application state transition.
- Exercise dashboard registration, login, profile update, and dashboard application submission with cookies and redirects.
- Exercise MCP reads and mutation paths using authenticated public handlers.
- Exercise imports, scheduling, and matching with deterministic mocks only at external LLM/vector/email boundaries.

### Credentials and audit

- Consume a reset token once, persist a bcrypt password, reject reuse, and authenticate after process replacement.
- Force a password-update failure after reset validation and verify the token was not consumed.
- Login with supported legacy hashes and verify the persisted hash is bcrypt after restart.
- Verify success and rejection audit records remain queryable after restart.

### Migration

- Dry-run reports collection counts and changes no target rows.
- The first migration preserves identifiers, relationships, password hashes, tokens, drafts, and audit data.
- Re-running the same migration is idempotent.
- A non-empty target is rejected unless the documented override is explicitly provided.

## Definition of done

All local gates pass with synthetic data and a disposable PostgreSQL instance. BUGS.md records local verification without claiming production resolution. Production completion remains blocked until the hosted evidence listed in the feature is captured.

## Company/job repair verification (2026-10-26)

[NFR-DATA-002](../features/platform/feature-postgresql-write-path-repair.md) has independent local evidence on HEAD `6bbdeda7808f2b5ccb1dffd027d94b3a9fa13155` plus uncommitted changes: PostgreSQL 16.15 `test:db` 48 pass / 0 fail / 3 inverse prerequisite-guard skips (51 total), JSON suite 378 pass / 0 fail, and passing typecheck, lint (0 errors / 178 warnings), build and PostgreSQL built-artifact health smoke. Missing/unreachable database checks exit nonzero. Validator: CICD-tester (Claude Opus 5.5); logs `/tmp/nfr-data-002-tester-20261026021557/`. See the repair stories for named-test evidence and the unresolved missing-ID DELETE/404 wording gaps. No hosted Actions run on the implementation revision or hosted production durability evidence is supplied; neither release gate is closed.
