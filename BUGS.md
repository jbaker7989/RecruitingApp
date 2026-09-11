# Bug Report — New Fronteir Recruiting Application

**Date:** 2026-09-11
**Scope:** Full review of application setup, all source files (`src/`), config, data layer, and skill specs (`brain/brain.md`, `*/SKILL.md`).
**Method:** Static code review + live smoke tests against a running instance (data files were backed up and restored; working tree left clean).
**Status:** No fixes applied — report only, per instruction.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low/Hygiene

**Tracking IDs:** Every bug carries a unique alphanumeric ID in the format `NFR-0XX` (**N**ew **F**ronteir **R**ecruiting), assigned sequentially 001–032 in report order. Use these IDs in commits, branches, and status discussions.

## Tracking Index

| ID | # | Severity | Title |
|---|---|---|---|
| NFR-001 | 1 | 🔴 | `npm start` crashes — ESM/CJS module mismatch |
| NFR-002 | 2 | 🔴 | ✅ Server never starts — `start()` never invoked — **RESOLVED** (fix/NFR-002) |
| NFR-003 | 3 | 🔴 | Auth chicken-and-egg — register/login unreachable |
| NFR-004 | 4 | 🔴 | ✅ `store.json` missing `hires` array — hire-flow crashes — **RESOLVED** (fix/NFR-004) |
| NFR-005 | 5 | 🔴 | CSV job import completely broken |
| NFR-006 | 6 | 🔴 | Job import silently drops all `requirements` |
| NFR-007 | 7 | 🔴 | Hires routes unreachable — route ordering |
| NFR-008 | 8 | 🟠 | Trivially forgeable auth tokens |
| NFR-009 | 9 | 🟠 | Passwords stored as reversible plaintext stub |
| NFR-010 | 10 | 🟠 | Privilege escalation via self-selected role |
| NFR-011 | 11 | 🟠 | No authorization/ownership checks on applicants |
| NFR-012 | 12 | 🟠 | Credential file and binaries tracked in git |
| NFR-013 | 13 | 🟠 | CORS wide open |
| NFR-014 | 14 | 🟡 | Job auto-close triggers on applications, not hires |
| NFR-015 | 15 | 🟡 | `POST /api/applications` validates wrong payload |
| NFR-016 | 16 | 🟡 | Email-confirmation mismatch never blocks |
| NFR-017 | 17 | 🟡 | Convenience apply creates orphan applications |
| NFR-018 | 18 | 🟡 | No duplicate-application prevention |
| NFR-019 | 19 | 🟡 | Hires filter references nonexistent `companyId` |
| NFR-020 | 20 | 🟡 | No concurrency control on JSON store |
| NFR-021 | 21 | 🟡 | `importService.ts` dead and broken |
| NFR-022 | 22 | 🟡 | DELETE endpoints lie and orphan data |
| NFR-023 | 23 | 🟡 | MCP route inconsistencies |
| NFR-024 | 24 | 🔵 | Spec mismatch — data files |
| NFR-025 | 25 | 🔵 | Dead `observability` array in store |
| NFR-026 | 26 | 🔵 | Empty/duplicate directories |
| NFR-027 | 27 | 🔵 | Unused imports/code |
| NFR-028 | 28 | 🔵 | No applicant DELETE endpoint |
| NFR-029 | 29 | 🔵 | Employer notification never implemented |
| NFR-030 | 30 | 🔵 | `npm test` is a placeholder |
| NFR-031 | 31 | 🔵 | Error handling leaks internals |
| NFR-032 | 32 | 🔵 | Matching nits |

---

## 🔴 Critical — App won't run / core flows broken

### 1. [NFR-001] `npm start` crashes immediately — ESM/CJS module mismatch
- **Where:** `package.json` (`"type": "commonjs"`) vs `tsconfig.json` (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
- **Symptom:** `node dist/index.js` → `SyntaxError: Cannot use import statement outside a module`
- **Evidence:** Confirmed live. `tsc` emits ES module syntax into `dist/`, but `"type": "commonjs"` makes Node treat `.js` files as CommonJS.
- **Note:** `moduleResolution: "bundler"` is also wrong for a Node-executed app (should be `nodenext`/`node16` if ESM is intended).

### 2. [NFR-002] ✅ Server never starts — `start()` is never invoked
- **Where:** `src/index.ts:41-59` — `start()` is defined and exported but never called anywhere; no `if (require.main === module)` / `import.meta` entry guard.
- **Symptom:** Even when module loading succeeds (via `tsx`), the process exits silently without listening. No port is bound.
- **Evidence:** Confirmed live — `npx tsx src/index.ts` produced no "server running" log and `curl :3000/health` connection-refused. The smoke tests in this review required manually invoking `start()` via `tsx -e "import('./src/index.ts').then(m => m.start())"`.
- **Impact:** `npm run dev` and `npm start` both cannot serve traffic. **Bugs 1 + 2 together mean the application cannot be started at all by its own scripts.**

> **✅ RESOLUTION — 2026-09-11, branch `fix/NFR-002`, merged to `main`**
> - **Fix:** added an entrypoint guard in `src/index.ts` — `start()` is now invoked when the module is executed directly (`realpath(argv[1]) === realpath(fileURLToPath(import.meta.url))`), and NOT when imported as a library (tests/tooling). `start()` failures log and exit(1).
> - **Files changed:** `src/index.ts`, `tests/regression/NFR-002-server-starts.test.ts` (new, 3 tests)
> - **Tests:** each spawns the real entrypoint (`node --import tsx src/index.ts`) against an isolated temp `DATA_DIR`: (1) `/health` returns 200; (2) startup observability entry written (proves `start()` executed); (3) process stays alive + startup banner printed. All 3 observed failing pre-fix (child exited code 0, no listener, no banner), all 3 passing post-fix — iteration 1 of 3. Full suite 6/6 (NFR-004 regressions still green). Manual checks: library import binds no listener; `npm run dev` boots and serves /health.
> - **Gates:** `tsc --noEmit` ✅ · `tsc` build ✅ · tests 6/6 ✅ · CI smoke gate pending `NFR-030` bootstrap
> - **Note:** `npm start` still fails until NFR-001 (ESM/CJS mismatch) is fixed; if NFR-001 chooses CommonJS output, this guard must switch to the `require.main === module` form (import.meta will not compile under CommonJS).

### 3. [NFR-003] Authentication chicken-and-egg — register/login are unreachable
- **Where:** `src/index.ts:27` — `app.use('/', authenticate)` is mounted before all routers, including `/api/auth`.
- **Symptom:** `POST /api/auth/register` and `POST /api/auth/login` return `401 {"error":"No authentication token provided"}` without a token. The middleware's anonymous bypass only covers `/health` and `/`.
- **Evidence:** Confirmed live.
- **Impact:** No first user can ever be created through the API; the only way in is hand-editing `data/store.json`. Also blocks `POST /api/applicants` (public applicant self-registration) and `/api/mcp/health`.

### 4. [NFR-004] ✅ `data/store.json` is missing the `hires` array — runtime crashes on hire flows
- **Where:** committed `data/store.json` (has `companies, jobs, applicants, applications, users, observability` — no `hires`), vs `DataStore` interface and `initializeStore()` in `src/models/store.ts` which expect/create `hires`.
- **Symptom:** Any code path touching `store.hires` throws on the existing data file:
  - `PUT /api/applications/:id/status` with `accepted` → `500 "Cannot read properties of undefined (reading 'push')"` (hire can never be recorded)
  - `GET /api/applicants/:id` → `500 "Cannot read properties of undefined (reading 'filter')"` (applicant profiles unreadable)
  - All `/hires` endpoints crash the same way.
- **Evidence:** Confirmed live against the committed store.json.
- **Root cause:** `initializeStore()` only seeds `hires: []` when creating a *new* file; there is no migration/defaulting when reading an existing file missing keys. `.gitignore` force-includes `data/store.json`, so the malformed empty file is committed.

> **✅ RESOLUTION — 2026-09-11, branch `fix/NFR-004`, merged to `main`**
> - **Fix:** `readStore()` now normalizes on read — the parsed file is shallow-merged over a fresh `emptyStore()` so any collection missing from the on-disk file (e.g. `hires`) defaults to `[]`. The normalized shape self-heals on disk at the next `writeStore()`. `initializeStore()` reuses `emptyStore()` (deduplication). Added `DATA_DIR` env override for test isolation.
> - **Files changed:** `src/models/store.ts`, `tests/regression/NFR-004-hires-array.test.ts` (new, 3 tests)
> - **Tests:** unit (`readStore` defaults all collections) + 2 integration (GET applicant 200; accept application creates hire + links to applicant). All 3 observed failing pre-fix with the exact bug evidence (`reading 'filter'` / `reading 'push'` 500s), all 3 passing post-fix — iteration 1 of 3.
> - **Gates:** `tsc --noEmit` ✅ · `tsc` build ✅ · tests 3/3 ✅ · CI smoke gate pending `NFR-030` bootstrap

### 5. [NFR-005] CSV job import is completely broken
- **Where:** `src/routes/jobs.ts:80-81` — `const Papa = await import('papaparse'); Papa.parse(...)`
- **Symptom:** `500 "Papa.parse is not a function"` on every CSV import.
- **Evidence:** Confirmed live. Dynamic `import()` of the CommonJS `papaparse` package returns a module namespace where the API lives on `.default`, so `Papa.parse` is undefined.
- **Impact:** The entire `/api/jobs/import` CSV path (a headline feature per the skill docs) is dead.

### 6. [NFR-006] Job import silently drops ALL `requirements`
- **Where:** `src/routes/jobs.ts:95` — `const reqStr = String(row.requirements || row.requirements === undefined ? '' : '');`
- **Symptom:** Operator precedence makes this `(row.requirements || row.requirements === undefined) ? '' : ''` → always `''`. Every imported job gets `requirements: []`.
- **Evidence:** Confirmed live — JSON import of `{"requirements":"req1;req2"}` produced `"requirements": []`.
- **Impact:** Match scores (`calculateMatchScore` matches against `job.requirements`) are degraded for every imported job.

### 7. [NFR-007] Hires routes are unreachable — route ordering bug
- **Where:** `src/routes/applications.ts` — `router.get('/:id')` (line 92) is registered **before** `router.get('/hires')` (line 164) and `router.get('/companies/:id/hires')` (line 181). Express matches in registration order.
- **Symptom:** `GET /api/applications/hires` → `404 {"error":"Application not found"}` (`'hires'` is captured as `:id`). Same for the company-hires route.
- **Evidence:** Confirmed live.
- **Impact:** Recruiters/hiring-managers can never list hires via the API (and with bug 4, the handlers would crash anyway).

---

## 🟠 High — Security

### 8. [NFR-008] Trivially forgeable auth tokens
- **Where:** `src/middleware/auth.ts:31` — `store.users.find(u => u.id === token || u.username === token)`
- **Issue:** The "token" is just the user's id **or username**. Knowing any username (e.g. `admin`) authenticates as that user. No signing, no expiry, no revocation. Tokens are also accepted via `?token=` query string (leaks into logs/proxies).
- **Evidence:** Confirmed live — `Authorization: Bearer hmanager` authenticated successfully.

### 9. [NFR-009] Passwords stored as reversible plaintext stub
- **Where:** `src/routes/auth.ts:23` — `passwordHash: `encrypted_${password}`` (same check at login, line 40).
- **Issue:** Base64-grade "encryption"; anyone with read access to `data/store.json` (or a `GET` leak) recovers every password. No hashing (bcrypt/argon2/scrypt) anywhere.

### 10. [NFR-010] Privilege escalation via self-selected role at registration
- **Where:** `src/routes/auth.ts:13-28` — `role` is taken verbatim from the request body with no allow-list or approval flow.
- **Symptom:** Any authenticated caller can register a new `member-services` (full admin) account.
- **Evidence:** Confirmed live — registered user `evil` with role `member-services`.

### 11. [NFR-011] No authorization/ownership checks on applicant profiles
- **Where:** `src/routes/applicants.ts` — `PUT /:id` (line 73) and `GET /:id` (line 58) have no `requireRole` and no ownership check.
- **Symptom:** Any authenticated user can read full applicant PII (address, phone, work authorization status) and modify **any** applicant's profile.
- **Evidence:** Confirmed live — a `hiring-manager` token renamed another applicant (`"firstName":"HACKED"` persisted).

### 12. [NFR-012] Credential file and large binaries tracked in git
- **Where:** `agent-home/auth.json` (currently `{}`, but is the pi agent's OAuth credential store and will contain tokens at runtime), `agent-home/bin/fd` and `agent-home/bin/rg` (~7 MB of binaries) — all committed in the initial commit; `.gitignore` does not exclude `agent-home/`.
- **Risk:** Next commit after the agent authenticates anywhere will leak OAuth tokens to the remote. Repo bloat regardless.

### 13. [NFR-013] CORS wide open
- **Where:** `src/index.ts:21` — `app.use(cors())` allows any origin for an API serving PII and (weak) credential auth.

---

## 🟡 Medium — Functional / logic bugs

### 14. [NFR-014] Job auto-close triggers on application count, not hires
- **Where:** `src/routes/applications.ts:51` and `src/routes/mcp.ts:58` — `if (job.currentApplications >= job.totalOpenings) job.isActive = false`
- **Symptom:** A job with `totalOpenings: 1` closes after **one application** (not one hire). Confirmed live: after a single application, `isActive` flipped to `false` and subsequent applications were rejected with `"Job is no longer accepting applications"`.
- **Issue:** `totalOpenings` is a headcount of positions; closing on *application* volume contradicts the domain model (`brain/brain.md`) and blocks hiring pipelines after N applicants.

### 15. [NFR-015] `POST /api/applications` validates the wrong payload
- **Where:** `src/routes/applications.ts:11` — uses `validateApplicationBody`, which demands `firstName, lastName, email, phone, address, educationHistory, employmentHistory, rightToWork` — i.e., a full applicant profile — even though the endpoint references an existing applicant via `applicantId`.
- **Issue:** Callers must redundantly resubmit the entire profile; `applicantId`/`jobPostingId` themselves are never validated for presence (only for existence). Validation rule set appears copy-pasted from applicant creation.

### 16. [NFR-016] Email-confirmation mismatch never blocks anything
- **Where:** `src/routes/applications.ts:31` — `emailConfirmed = req.body.email === req.body.emailConfirmation`; result is only *recorded*, never enforced.
- **Issue:** `applicant-management/SKILL.md` specifies "Validate email format using Regex + confirmation field match" as a submission gate. A mismatched/missing confirmation still creates the application. (Edge: if both fields were absent the comparison would be `undefined === undefined` → `true`; currently masked because `email` is required.)

### 17. [NFR-017] Convenience apply endpoint creates orphan applications
- **Where:** `src/routes/applicants.ts:97` — `POST /api/applicants/:id/apply`
- **Symptoms:** No job-existence check (confirmed live: application created for `jobPostingId: "DOES-NOT-EXIST"`), no `isActive` check, never increments `job.currentApplications`, never auto-closes, no match score (hardcoded 0s), no email confirmation, no observability entry. Silently diverges from `POST /api/applications`.

### 18. [NFR-018] No duplicate-application prevention
- **Where:** `src/routes/applications.ts` POST `/`, `src/routes/applicants.ts` `/:id/apply`, `src/routes/mcp.ts` `/apply`
- **Issue:** The same applicant can apply to the same job repeatedly; each submission inflates `currentApplications` and (per bug 14) hastens auto-close.

### 19. [NFR-019] Hiring-manager hires filter references a nonexistent field
- **Where:** `src/routes/applications.ts:168` — `req.user.companyId` — the auth token payload (`src/middleware/auth.ts:6`) only carries `{ id, username, role }`, and the `User` model has no `companyId`.
- **Issue:** The hiring-manager branch would always return `[]` (also `hireIds` is computed and unused). Currently masked by bug 7 (route unreachable) but latent.

### 20. [NFR-020] No concurrency control on the JSON store
- **Where:** `src/models/store.ts` — every mutation is `readStore()` → mutate → `writeStore()` with no locking/queueing. `addObservabilityEntry` does a full read+write per log line.
- **Issue:** Concurrent requests lose updates (classic read-modify-write race). `data/SKILL.md` explicitly promises "Atomic read/write operations with file locking" — not implemented.

### 21. [NFR-021] `src/services/importService.ts` is dead **and** broken
- **Where:** never imported by any route (`grep` confirms zero usages); `routes/jobs.ts` re-implements import inline instead.
- **Latent bug if ever wired up:** `parseCSV` normalizes headers to `lower_snake_case` (`job_title`, `required_skills`) but `processImport` reads camelCase (`row.jobTitle`, `row.requiredSkills`) → CSV imports through this service would produce jobs with empty titles/skills.

### 22. [NFR-022] DELETE endpoints lie and orphan data
- **Where:** `src/routes/jobs.ts:204`, `src/routes/companies.ts:97`
- **Issues:** Both return `{"message":"... deleted"}` even when the id doesn't exist (no 404). Neither cleans up dependents: deleting a company orphans its jobs; deleting a job orphans its applications and hires.

### 23. [NFR-023] MCP route inconsistencies
- **Where:** `src/routes/mcp.ts`
  - `/api/mcp/health` is behind the global auth middleware → 401 without token (index.ts logs it as if it were a public health URL).
  - `/api/mcp/applications` contains a dead branch filtering for role `applicant` while `requireRole` excludes applicants (line 23-25).
  - `/api/mcp/apply` duplicates apply logic with no match score, no validation, no observability — a third divergent apply path.

---

## 🔵 Low — Hygiene / spec gaps

24. [NFR-024] **Spec mismatch — data files:** `data/SKILL.md` specifies one JSON file per entity (`companies.json`, `jobs.json`, `hires.json`, …) plus a `data/imports/` archive; implementation uses a single `store.json`. `.gitignore` still lists the per-entity files.
25. [NFR-025] **Dead `observability` array** inside `store.json`/`DataStore` — observability actually lives in `observability.json`; the in-store array is never read or written.
26. [NFR-026] **Empty/duplicate directories:** `src/frontend/`, `src/mcp/` (empty), and misspelled `job-managment/` (empty duplicate of `job-management/`).
27. [NFR-027] **Unused imports/code:** `jobs.ts` imports `validateApplicationBody`, `createApplication`, `calculateMatchScore` (unused); `applicants.ts` imports `requireRole` (unused); `auth.ts` `logAction` (unused); `validation.ts` `parseUploadedFile` (unused, and reads `file.name` off a `Buffer`); `fileUpload.ts` is a no-op middleware; `express-fileupload` dependency installed but never wired; `matching.ts` `createApplication`, `createHireRecord`, `checkJobAutoClose` all unused (logic duplicated inline in routes). Duplicate `validateEmail` in both `validation.ts` and `matching.ts`.
28. [NFR-028] **No applicant DELETE endpoint** despite `applicant-management/SKILL.md` specifying "Create, read, update, and delete applicant profiles". No `GET /api/applicants` list endpoint either.
29. [NFR-029] **Employer notification never implemented:** `HireRecord.notifiedEmployer` is hardcoded `false` forever; skill requires "Notify employer of new hire". `Applicant.notificationToManager` is collected but never used.
30. [NFR-030] **`npm test` is a placeholder** (`echo "Error: no test specified" && exit 1`); zero tests exist for matching, validation, or routes.
31. [NFR-031] **Error handling leaks internals:** `errorHandler` returns raw `err.message` to clients; several catch blocks do the same. `errorHandler`'s `next` param unused (Express 5 tolerant, but sloppy).
32. [NFR-032] **Matching nits:** experience uses naive `endYear - startYear` (Dec→Jan counts as a year); final score is clamped to a 1–10 floor of 1, so a 0 match is impossible.

---

## Verification summary

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ passes |
| `npm run build` | ✅ emits (but output unrunnable — bug 1) |
| `npm start` | 🔴 crashes (bug 1) |
| `npm run dev` | 🔴 exits without listening (bug 2) |
| Live smoke test (company → job → applicant → apply → accept → hires) | 🔴 bugs 3–7, 10, 11, 14, 16, 17 confirmed at runtime |

*Test data was seeded only to exercise endpoints; `data/store.json` and `data/observability.json` were restored to their committed state afterward. `git status` is clean. No source files were modified.*

## Suggested fix order (for direction, not yet applied)

1. NFR-002 (call `start()`) + NFR-001 (pick ESM *or* CJS and align `package.json`/`tsconfig`) — makes the app runnable at all.
2. NFR-004 (store migration/defaulting for `hires`) — unblocks applicant profiles and hire flow.
3. NFR-003 (mount `/api/auth` before `authenticate`) — unblocks onboarding.
4. NFR-007, NFR-005, NFR-006 (route order, papaparse `.default`, ternary) — restores hires listing and import feature.
5. Security cluster (NFR-008 – NFR-013) before any real data/users.
6. Logic cluster (NFR-014 – NFR-019) and spec gaps.
