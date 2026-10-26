# Feature: Durable PostgreSQL Application Storage

**Feature ID:** NFR-DATA-001
**Primary bugs:** NFR-034, NFR-061–NFR-070
**Status:** Company/job write-path implementation complete; local verification passed (2026-10-26); hosted CI and hosted production evidence pending
**Production status:** Not complete until a hosted environment proves durability and readiness

## Problem

The JSON store is useful for local development, but it cannot safely hold production data in a serverless runtime. Writes can disappear when an instance is recycled, concurrent instances do not share state, and read-modify-write operations can overwrite each other.

The archived database branch created tables but left many route handlers mutating an in-memory snapshot and calling a database-mode no-op. That design appeared to succeed at the HTTP layer while losing registrations, applications, imports, authentication changes, and agent workflow updates.

## Outcome

When PostgreSQL is configured, every application collection and audit record is stored in PostgreSQL. A successful mutation response means the transaction committed. A failed mutation rolls back all of its changes. A configured database that is unavailable fails startup/readiness and never falls back to JSON.

JSON mode remains available for local development and its existing regression suite remains green. Production must explicitly configure durable storage; it cannot silently start with the ephemeral JSON backend.

## Storage contract

Production code uses the contract documented in [db-storage-contract.md](../../implementation/db-storage-contract.md):

- `readStore(): Promise<DataStore>` returns a coherent snapshot from the selected backend.
- `updateStore<T>(mutator): Promise<T>` reads the latest state, runs a synchronous or promise-returning mutator, and commits before resolving.
- If a mutator throws, every mutation in that call rolls back.
- Mutators do not call `readStore`, `writeStore`, or external services.
- `writeStore` is a JSON compatibility operation and rejects database mode so snapshot replacement cannot silently lose concurrent writes.
- Audit entries use the same durable backend as application data.

The [write-path repair feature](feature-postgresql-write-path-repair.md) tracks the seven company/job route callers that still use the rejected `writeStore` API. Its selected approach is to migrate them to `updateStore` and restore the real PostgreSQL CI gate.

## Included data

The durable schema covers companies, jobs, applicants, applications, users, hires, observability/audit records, job-description drafts, password-reset tokens, and any persisted matching or scheduling state represented in `DataStore`.

## Acceptance criteria

1. Database initialization is idempotent and applies versioned migrations before the service becomes ready.
2. A configured connection failure stops startup and makes readiness fail; it never activates JSON fallback.
3. Production refuses an implicit ephemeral JSON configuration.
4. Public HTTP flows for applicants, applications, companies, jobs, dashboard, auth, MCP, imports, matching, and scheduling persist across a fresh process.
5. `updateStore` serializes conflicting updates, does not lose unrelated concurrent updates, and returns only after commit.
6. Duplicate application submission is enforced atomically for the `(applicantId, jobPostingId)` pair.
7. Application capacity, counters, status changes, hire creation, and related applicant/job updates commit as one transaction.
8. Password-reset token consumption and password replacement commit together. A failed password update leaves the token usable; a successful reset makes it single-use.
9. Legacy user and applicant password hashes migrate to bcrypt on successful login and remain migrated after restart.
10. Audit records survive restart and are written for the same successful and rejected operations as JSON mode.
11. JSON-to-PostgreSQL migration supports dry-run, is idempotent, and refuses a non-empty target unless the operator explicitly selects the documented override.
12. CI runs Node 24 quality gates in JSON mode and a real PostgreSQL service integration gate. The explicit database gate fails when its database prerequisite is absent or unreachable.

## Release evidence

Local completion requires the JSON regression suite, typecheck, lint, build, built smoke test, and PostgreSQL integration suite to pass using synthetic data in a disposable database.

Production completion additionally requires evidence from a hosted PostgreSQL-backed deployment: migration output, readiness behavior, a mutation observed after a fresh runtime instance, and rollback/concurrency smoke results. No hosted database has been exercised by this local story.

## Out of scope

- Automatic deployment or production publication
- Reusing real applicant, employer, or credential data in tests
- Treating a successful schema-only test as proof that HTTP writers are durable

## Company/job repair verification (2026-10-26)

[NFR-DATA-002](feature-postgresql-write-path-repair.md) has independent local evidence on HEAD `6bbdeda7808f2b5ccb1dffd027d94b3a9fa13155` plus uncommitted changes: PostgreSQL 16.15 `test:db` 48 pass / 0 fail / 3 inverse prerequisite-guard skips (51 total), JSON suite 378 pass / 0 fail, and passing typecheck, lint (0 errors / 178 warnings), build and PostgreSQL built-artifact health smoke. Missing/unreachable database checks exit nonzero. Validator: CICD-tester (Claude Opus 5.5); logs `/tmp/nfr-data-002-tester-20261026021557/`. See the repair stories for named-test evidence and the unresolved missing-ID DELETE/404 wording gaps. No hosted Actions run on the implementation revision or hosted production durability evidence is supplied; neither release gate is closed.
