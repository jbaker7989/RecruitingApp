# DB storage contract (NFR-034, NFR-061–070)

Owner: foundation (Implementer B). Status: implementation in progress; signatures below are the contract.

## Public facade: `src/models/store.ts`

| API | Semantics |
|---|---|
| `readStore(): Promise<DataStore>` | Reads from the configured backend. Returns a fresh copy; mutating it persists nothing. |
| `updateStore<T>(mutator: (store: DataStore) => T \| Promise<T>): Promise<T>` | Atomic read-latest → mutate → commit, resolved only after commit. Throw/reject in the mutator = full rollback (nothing persisted), error is rethrown. Collection reassignment (`store.jobs = store.jobs.filter(...)`) and in-place edits/push/splice are both supported. Records must keep a unique string `id`. |
| `writeStore(data)` | LEGACY. **Postgres: always throws `LegacyWholesaleWriteError`.** JSON: allowed for seeding; throws `StaleStoreWriteError` if `data` came from `readStore` and the file changed since. Do not use in production code. |
| `addObservabilityEntry(entry)` | Atomic audit append (DB: `INSERT`, JSON: serialized read-append-write). Never use `read/writeObservability` to append. |
| `readObservability()` | Audit log in insertion order. |
| `writeObservability(logs)` | LEGACY; JSON only (throws on Postgres). |
| `initializeStore()` | JSON: create files. Postgres: connect, create schema (idempotent), fail closed with an error. |
| `checkStoreHealth(): Promise<'up'\|'down'>` | Used by `/ready`. Postgres: `SELECT 1`; JSON: data dir readable. |
| `getStoreMode(): 'json' \| 'postgres'` | Resolved backend. |
| `closeStore(): Promise<void>` | Ends the pg pool (tests/shutdown). |

### Mutator rules
1. Do not call `readStore/writeStore/updateStore` inside a mutator (throws `StoreReentrancyError`).
2. No network/LLM/bcrypt-heavy work inside; compute first (e.g. `bcrypt.hash`), then validate against current records in the mutator.
3. Return a plain result/status object; send HTTP responses only after `updateStore` resolves.
4. `store.observability` is not writable via updateStore in Postgres (non-empty throws); use `addObservabilityEntry`.

## Backend selection (fails closed)

| Env | Result |
|---|---|
| `DATABASE_URL` set, `USE_DATABASE` unset or `true` | Postgres |
| `USE_DATABASE=false` | JSON (even if `DATABASE_URL` set) |
| `USE_DATABASE=true`, no `DATABASE_URL` | Error at first use / startup |
| neither set | JSON (`DATA_DIR` or `./data`) — local/test |
| `NODE_ENV=production` resolving to JSON | Error unless `ALLOW_JSON_STORE=true` (explicit ephemeral opt-in) |
| Postgres configured but unreachable | Startup fails; requests error; **never** falls back to JSON |

Other env: `DATABASE_SCHEMA` (optional; isolates all tables/locks in that Postgres schema — **test agent: use one schema per test file/run**, name `[a-z_][a-z0-9_]*`, created if missing), `DATABASE_POOL_MAX` (10), `DATABASE_CONNECT_TIMEOUT_MS` (5000). TLS via `?sslmode=` in the URL. Config is re-read on every call, so tests can switch env between files; call `closeStore()` in `after()`.

## Postgres layout (schema version 1, `store_meta`)
- `app_records(collection, id, seq bigserial, data jsonb, created_at, updated_at)` PK `(collection,id)`: one typed-record row per entity for companies, jobs, applicants, applications, users, hires, drafts, passwordResetTokens. `seq` preserves insertion order on read. Unique partial indexes: applicant email, user username, applicant (oauthProvider, oauthProviderId), reset token.
- `audit_log(seq, id unique, data jsonb)` append-only.
- Writers: one transaction with `pg_advisory_xact_lock` (cross-process serialization), load snapshot, run mutator, upsert only changed records and delete removed ones, commit. Readers are lock-free single-statement snapshots.
- Tradeoff: each write loads all records (O(n)) and writers are globally serialized. Fine at current scale; next step is per-collection locks / targeted queries. Array reordering is not persisted (order = insertion order).

## Seeding in tests
Postgres: `await updateStore(s => { s.companies.push(...); })` (not `writeStore`). JSON: either works. Isolate with `DATABASE_SCHEMA`.

## Migration from legacy JSON
`node --import tsx scripts/migrate-json-to-db.mjs [--dry-run] [--data-dir DIR] [--allow-nonempty-target]` with `DATABASE_URL` (dry-run works without it; it only validates the source and reports counts).
- Source: `<data-dir>/store.json` + `observability.json`. Validates string unique ids; prints per-collection counts only (never record contents).
- Empty target: inserts all in one transaction, verifies counts, commits.
- Non-empty target: refuses (exit 2) unless the target already contains every source record byte-equivalently (→ no-op "already migrated", idempotent), or `--allow-nonempty-target` is given, which inserts only missing ids and never overwrites. Any id whose data differs is always a conflict (exit 2).
- Never run against a DB you do not own with `--allow-nonempty-target` without a backup.

## Password reset helper (for route wiring)
`src/services/passwordResetService.ts`:
```ts
resetPasswordWithToken(token: string, newPasswordHash: string):
  Promise<{ ok: true; applicantId: string } | { ok: false; reason: 'invalid' | 'used' | 'expired' | 'no_applicant' }>
```
Single `updateStore`: validates token, marks used, and writes the applicant `passwordHash` + `updatedAt` atomically — a failed write does not burn the token. Hash with bcrypt before calling. `createResetToken` and `validateAndConsumeResetToken` remain (the latter deprecated).

## Implementation status / notes (Implementer B)
- Telemetry: `updateStore` emits sibling `store.read` (load) and `store.write` (diff+commit) spans under the caller, matching legacy shape; a throwing mutator emits no write span. `addObservabilityEntry` keeps the `store.audit.append` parent with `audit.read`/`audit.write` children in JSON mode; Postgres emits the parent only.
- `addObservabilityEntry`/`readObservability` are also forbidden inside a mutator (JSON mode would deadlock); write audit after commit.
- Compare-and-swap legacy hash upgrades: `/api/auth/login` and `/dashboard/login` re-check the stored legacy hash inside `updateStore`; if it changed they return the normal invalid-credentials response (no stale success).
- `PATCH /api/auth/me` now ignores `id, role, companyId, passwordHash, createdAt, oauthProvider` in the body (previously mass-assignable).
- Package script: `npm run db:migrate-json -- [--dry-run] [--data-dir DIR] [--allow-nonempty-target]`. `test:db` is not defined by foundation; tests agent may add it.
- Schema version is checked on init: a `store_meta.schema_version` other than 1 fails closed. Migration inserts audit rows strictly (collision rolls back); malformed or conflicting-duplicate source audit data is rejected.
- Existing tests that read `data/store.json` directly assume JSON mode; do not set `DATABASE_URL` when running them.
