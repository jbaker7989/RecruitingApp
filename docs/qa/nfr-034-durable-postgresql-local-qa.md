# NFR-034 Durable PostgreSQL — Local QA Record

**Date:** 2026-10-22
**Status:** Local implementation and validation complete; hosted verification pending.
**Branch:** `feature/durable-db-nfr034-061-070`

## Validation

Node 24.20.0, isolated `rec-app-db-delivery` worktree, synthetic fixtures, disposable PostgreSQL 16 container `recapp-nfr034-db-agent` on loopback port 64776.

| Gate | Result |
|---|---|
| Locked install (`npm ci`) | Passed during workspace setup |
| `npm run typecheck` | Passed |
| `npm run lint` | 0 errors; 178 warnings |
| `npm run build` | Passed |
| JSON `npm test` with database variables unset | 340 passed; 0 failures |
| `DB_TEST_REQUIRED=true npm run test:db` with disposable DATABASE_URL | 18 passed; 0 failures; 2 non-applicable prerequisite sentinel tests skipped |
| `npm run smoke`, built JSON mode | `smoke-health=ok` |
| `npm run smoke`, built PostgreSQL mode | `smoke-health=ok` |

PostgreSQL coverage includes idempotent initialization/readiness, cross-process persistence, thrown-mutator rollback, concurrent updates, route/service persistence, duplicate/capacity races, hires, dashboard bcrypt flows, legacy hash upgrades, single-use reset, database-trigger password failure rollback, privileged profile field protection, unsupported schema rejection, unavailable database rejection, migration dry-run/idempotence/conflict protection, and malformed/conflicting audit rejection.

The JSON regression suite and PostgreSQL integration suite are separate gates. `DB_TEST_REQUIRED=true` fails immediately if DATABASE_URL is absent; connection errors fail setup. The new GitHub workflow provisions PostgreSQL and runs the database gate plus built smoke. It has not been executed on GitHub because this delivery is local only.

Two Claude Sonnet 5.5 implementation agents completed development and integration corrections. The GPT-5.6-SOL testing agent produced the initial CI/tests/backlog updates but hit a provider usage limit. The Astra orchestrator completed integration fixes to tests, reran final validation, and reconciled this record. This is not a claim of completed independent GPT-5.6-SOL sign-off.

## Limits and hosted follow-up

- No hosted migration, deployment, or production verification was performed.
- Writers serialize under one database advisory lock and load the full store; load testing and finer-grained persistence are future scaling work.
- Audit append happens after business mutation commit; it is durable but is not an atomic outbox with the business transaction.
- Matching was exercised with the external vector provider unavailable, using the existing fallback. No external LLM/vector service was validated.
- JSON mode remains single-process development storage. PostgreSQL store telemetry retains the existing `json_store` dependency label.
- Hosted acceptance must prove migration, readiness, restart persistence, rollback, and concurrency before production bugs are closed.
