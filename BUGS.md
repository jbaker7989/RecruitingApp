# Bug Report — New Fronteir Recruiting Application

**Date:** 2026-09-11
**Scope:** Full review of application setup, all source files (`src/`), config, data layer, and skill specs (`brain/brain.md`, `*/SKILL.md`).
**Method:** Static code review + live smoke tests against a running instance (data files were backed up and restored; working tree left clean).
**Status:** Living issue log. Resolved entries retain their original evidence and include a dated resolution block; verified but unmerged fixes remain open until their branch is pushed, reviewed, and merged.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low/Hygiene

**Tracking IDs:** Every bug carries a unique alphanumeric ID in the format `NFR-0XX` (**N**ew **F**ronteir **R**ecruiting), assigned sequentially 001–035 in report/discovery order. Use these IDs in commits, branches, and status discussions.

## Tracking Index

| ID | # | Severity | Title |
|---|---|---|---|
| NFR-001 | 1 | 🔴 | 🟡 `npm start` crashes — ESM/CJS module mismatch — **FIX VERIFIED; MERGE BLOCKED** |
| NFR-002 | 2 | 🔴 | ✅ Server never starts — `start()` never invoked — **RESOLVED** (fix/NFR-002) |
| NFR-003 | 3 | 🔴 | Auth chicken-and-egg — register/login unreachable |
| NFR-004 | 4 | 🔴 | ✅ `store.json` missing `hires` array — hire-flow crashes — **RESOLVED** (fix/NFR-004) |
| NFR-005 | 5 | 🔴 | CSV job import completely broken |
| NFR-006 | 6 | 🔴 | Job import silently drops all `requirements` |
| NFR-007 | 7 | 🔴 | Hires routes unreachable — route ordering |
| NFR-033 | 33 | 🔴 | 🟡 Vercel deployment fails — Node type definitions unavailable during build — **FIX VERIFIED; MERGE BLOCKED** |
| NFR-034 | 34 | 🔴 | Vercel serverless runtime cannot safely persist the JSON data store |
| NFR-035 | 35 | 🔴 | Git/Vercel release pipeline is disconnected and deployments are not reproducible |
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
- **Note:** `moduleResolution: "bundler"` should be revisited for a Node-executed app (`nodenext`/`node16` is the stricter Node model), although declaring the emitted `.js` as ESM resolves the observed runtime failure.
- **Status (2026-09-12):** **FIX VERIFIED; MERGE BLOCKED.** Branch `fix/NFR-001-NFR-033-vercel-release`, stacked into `fix/NFR-030-ci-bootstrap`, changes `package.json` to `"type": "module"`. Two regression tests observed the exact pre-fix syntax error and now pass. Local built startup, ESM import, and `/health` pass; clean Vercel preview deployment `dpl_DLHyEXhtLgrQLQb111xNFcGyL2TV` built successfully and authenticated preview smoke returned HTTP 200. Push/merge is blocked by NFR-035's missing GitHub `workflow` OAuth scope.

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

### 33. [NFR-033] Vercel deployment fails — Node type definitions unavailable during build
- **Priority:** P0 release blocker (newly discovered during NFR-FEAT-001 preview deployment)
- **Where:** Vercel project `jbaker7989-1641s-projects/rec-app-build`; TypeScript build using `tsconfig.json` (`types: ["node"]`) while `@types/node` is declared under `devDependencies`.
- **Symptom:** `vercel --yes` uploads successfully but the remote build terminates with `TS2688: Cannot find type definition file for 'node'`. No deployable preview is produced.
- **Evidence:** Confirmed 2026-09-12 in deployment `3cVp1ExYrTEq35mxp7AQHbHbkgig`; Vercel dependency installation completed, then `vercel build` failed at TypeScript compilation.
- **Likely cause:** The Vercel install/build environment is not making the project's development type packages available to the compiler. Exact configuration cause must be reproduced in a failing deployment/build test before changing dependencies or Vercel commands.
- **Impact:** Blocks all Vercel preview/production deployments, including NFR-FEAT-001 media integration.
- **Status (2026-09-12):** **FIX VERIFIED; MERGE BLOCKED.** `tsconfig.json` explicitly sets `typeRoots: ["./node_modules/@types"]`; two regression tests cover checked-in and effective compiler configuration. Local typecheck/build pass, and clean Vercel preview deployment `dpl_DLHyEXhtLgrQLQb111xNFcGyL2TV` completed with TypeScript 7.0.2 and served `/health` successfully. Push/merge is blocked by NFR-035.

### 34. [NFR-034] Vercel serverless runtime cannot safely persist the JSON data store
- **Priority:** P0 production data-integrity blocker.
- **Where:** `src/models/store.ts` writes application state beneath `DATA_DIR` or `process.cwd()/data`; Vercel deploys the function under a read-only packaged filesystem and only temporary storage is writable/ephemeral.
- **Symptom:** Health/read-only handlers can run, but profile, user, application, job, hire, and observability mutations attempt to rewrite local JSON files. On Vercel these writes can fail with a read-only-filesystem error or disappear when an instance is recycled; concurrent instances also cannot share state.
- **Evidence:** Static runtime-path review after the first healthy Vercel preview; this is additionally compounded by NFR-020's read-modify-write race. The preview cannot create an authenticated test user because NFR-003 blocks unauthenticated registration and the committed store contains no users, so no destructive production mutation was attempted.
- **Impact:** The deployed API is not production-safe for applicant/profile metadata even though photo bytes themselves can be stored durably in private Vercel Blob.
- **Required fix:** Replace JSON persistence with a durable transactional database supported by the deployment environment, migrate existing data, and add deployment-level mutation/persistence/concurrency tests. Do not use Blob object replacement as a pseudo-database.
- **Status:** OPEN — blocks production data entry and full NFR-FEAT-001 release.

### 35. [NFR-035] Git/Vercel release pipeline is disconnected and deployments are not reproducible
- **Priority:** P0 release-governance blocker.
- **Where:** Vercel project `rec-app-build`, GitHub repository `jbaker7989/RecruitingApp`, and local GitHub CLI credentials.
- **Symptom:** Existing production was deployed from a local feature working tree rather than an automatically built commit. `vercel git connect https://github.com/jbaker7989/RecruitingApp.git` fails because the Vercel account has no GitHub Login Connection. Pushing `.github/workflows/ci.yml` fails because the active GitHub OAuth token has `repo` but lacks `workflow`; SSH also has no configured GitHub key.
- **Evidence:** Vercel CLI still recommends `vercel git connect`; connect returned HTTP 400 (`add a Login Connection to your GitHub account first`). Git push rejected commit `95e9d53` with `refusing to allow an OAuth App to create or update workflow ... without workflow scope`. `gh auth status` confirms scopes `gist, read:org, repo` only.
- **Impact:** Releases can bypass pull-request checks, production source cannot be reliably reconstructed, and the verified NFR-001/NFR-030/NFR-033 fixes cannot currently be pushed/merged.
- **Required fix:** Owner adds the GitHub Login Connection in Vercel and refreshes GitHub CLI authorization with `workflow` scope (or configures an authorized SSH key), then pushes the clean branch, confirms CI, merges by reviewed commit, and deploys production from connected `main`.
- **Status:** OPEN — owner authorization required.

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
30. [NFR-030] 🟡 **`npm test` is a placeholder — FIX VERIFIED; MERGE BLOCKED.** Branch `fix/NFR-030-ci-bootstrap` replaces the placeholder with full TypeScript test discovery and adds SHA-pinned GitHub Actions gates in the mandated install → typecheck → build → test → built-artifact smoke order. Four NFR-030 tests and the combined 14-test suite pass locally; push/merge is blocked by NFR-035's missing GitHub `workflow` OAuth scope.
31. [NFR-031] **Error handling leaks internals:** `errorHandler` returns raw `err.message` to clients; several catch blocks do the same. `errorHandler`'s `next` param unused (Express 5 tolerant, but sloppy).
32. [NFR-032] **Matching nits:** experience uses naive `endYear - startYear` (Dec→Jan counts as a year); final score is clamped to a 1–10 floor of 1, so a 0 match is impossible.

---

## Verification summary

| Check | Result |
|---|---|
| `npm test` on combined release branch | ✅ 14/14 pass |
| `npm run typecheck` / `npm run build` | ✅ pass on combined release branch |
| Built-artifact smoke (`npm run smoke`) | ✅ `smoke-health=ok` on combined release branch |
| Clean Vercel preview build + authenticated `/health` | ✅ deployment `dpl_DLHyEXhtLgrQLQb111xNFcGyL2TV`, HTTP 200 |
| Git push / connected deployment | 🔴 blocked by NFR-035 authorization setup |
| Production mutation persistence | 🔴 unsafe until NFR-034 is resolved |
| Original live smoke (company → job → applicant → apply → accept → hires) | 🔴 bugs 3–7, 10, 11, 14, 16, 17 confirmed at runtime |

*Test/runtime data used during verification was isolated or restored. Resolution status is based on checked-in branch state plus the deployment evidence named above; unmerged work is not labeled resolved.*

## Suggested fix order (for direction, not yet applied)

1. **P0 owner setup:** NFR-035 — grant GitHub `workflow` scope, add the Vercel GitHub Login Connection, push the verified release branch, and require green CI.
2. **P0 release:** merge verified NFR-001 + NFR-030 + NFR-033 fixes, then deploy connected `main` and repeat production health checks.
3. **P0 data integrity:** NFR-034 + NFR-020 — replace JSON persistence with a durable transactional store before production applicant data entry.
4. **P1:** NFR-003 — unblock registration/login/onboarding.
5. **P1:** NFR-007, NFR-005, NFR-006 — restore hires listing and import features.
6. **P1 security:** NFR-008 – NFR-013 before real applicant data (NFR-011 has partial safeguards only on the unmerged NFR-FEAT-001 branch).
7. **P2:** NFR-014 – NFR-019 and remaining specification gaps.

Resolved and removed from the active queue: NFR-002, NFR-004.
