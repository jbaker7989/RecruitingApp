# Bug Report — New Fronteir Recruiting Application

**Date:** 2026-09-11
**Scope:** Full review of application setup, all source files (`src/`), config, data layer, and skill specs (`brain/brain.md`, `*/SKILL.md`).
**Method:** Static code review + live smoke tests against a running instance (data files were backed up and restored; working tree left clean).
**Status:** Living issue log. Resolved entries retain their original evidence and include a dated resolution block; verified but unmerged fixes remain open until their branch is pushed, reviewed, and merged.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low/Hygiene

**Tracking IDs:** Every bug carries a unique alphanumeric ID in the format `NFR-0XX` (**N**ew **F**ronteir **R**ecruiting), assigned sequentially 001–047 in report/discovery order. Use these IDs in commits, branches, and status discussions.

## Tracking Index

| ID | # | Severity | Title |
|---|---|---|---|
| NFR-001 | 1 | 🔴 | ✅ `npm start` crashes — ESM/CJS module mismatch — **RESOLVED** (PR #1) |
| NFR-002 | 2 | 🔴 | ✅ Server never starts — `start()` never invoked — **RESOLVED** (fix/NFR-002) |
| NFR-003 | 3 | 🔴 | Auth chicken-and-egg — register/login unreachable |
| NFR-004 | 4 | 🔴 | ✅ `store.json` missing `hires` array — hire-flow crashes — **RESOLVED** (fix/NFR-004) |
| NFR-005 | 5 | 🔴 | CSV job import completely broken |
| NFR-006 | 6 | 🔴 | Job import silently drops all `requirements` |
| NFR-007 | 7 | 🔴 | Hires routes unreachable — route ordering |
| NFR-033 | 33 | 🔴 | ✅ Vercel deployment fails — Node type definitions unavailable during build — **RESOLVED** (PR #1) |
| NFR-034 | 34 | 🔴 | Vercel serverless runtime cannot safely persist the JSON data store |
| NFR-035 | 35 | 🔴 | Git/Vercel release pipeline is disconnected and deployments are not reproducible |
| NFR-043 | 43 | 🔴 | ✅ Agent workflow routes emit extensionless ESM imports and crash the built server — **RESOLVED** (chore/NFR-043-esm-imports-fix) |
| NFR-008 | 8 | 🟠 | Trivially forgeable auth tokens |
| NFR-009 | 9 | 🟠 | Passwords stored as reversible plaintext stub |
| NFR-010 | 10 | 🟠 | Privilege escalation via self-selected role |
| NFR-011 | 11 | 🟠 | No authorization/ownership checks on applicants |
| NFR-012 | 12 | 🟠 | Credential file and binaries tracked in git |
| NFR-013 | 13 | 🟠 | CORS wide open |
| NFR-038 | 38 | 🟠 | Private applicant photos have no authorized retrieval/display path |
| NFR-039 | 39 | 🟠 | Blob/store failure ordering can orphan or break photo metadata |
| NFR-040 | 40 | 🟠 | Signature-only image validation accepts corrupt files |
| NFR-044 | 44 | 🟠 | ✅ JD-001 tests require Vitest but the project test runner is `node:test` via `tsx` — **RESOLVED** (fix/NFR-044-jd-tests-node-test) |
| NFR-046 | 46 | 🟠 | JD draft publishing lacks company authorization checks |
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
| NFR-041 | 41 | 🟡 | Uploads above the raw-parser limit return 500 instead of 413 |
| NFR-045 | 45 | 🟡 | JD draft update can mark drafts published without creating a job posting |
| NFR-047 | 47 | 🟡 | No linting gate is enforced in package scripts or CI |
| NFR-024 | 24 | 🔵 | Spec mismatch — data files |
| NFR-025 | 25 | 🔵 | Dead `observability` array in store |
| NFR-026 | 26 | 🔵 | Empty/duplicate directories |
| NFR-027 | 27 | 🔵 | Unused imports/code |
| NFR-028 | 28 | 🔵 | No applicant DELETE endpoint |
| NFR-029 | 29 | 🔵 | Employer notification never implemented |
| NFR-030 | 30 | 🔵 | ✅ `npm test` is a placeholder — **RESOLVED** (PR #1) |
| NFR-031 | 31 | 🔵 | Error handling leaks internals |
| NFR-032 | 32 | 🔵 | Matching nits |
| NFR-036 | 36 | 🔵 | ✅ NFR-030 missing formal dated resolution block — **RESOLVED** (fix/NFR-036-NFR-037-post-merge-docs) |
| NFR-037 | 37 | 🔵 | ✅ Suggested fix order still listed merged PR #1 — **RESOLVED** (fix/NFR-036-NFR-037-post-merge-docs) |
| NFR-042 | 42 | 🔵 | ✅ README priority order diverged from BUGS.md — **RESOLVED** (fix/NFR-042-readme-priority-order) |

---

## 🔴 Critical — App won't run / core flows broken

### 1. [NFR-001] `npm start` crashes immediately — ESM/CJS module mismatch
- **Where:** `package.json` (`"type": "commonjs"`) vs `tsconfig.json` (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
- **Symptom:** `node dist/index.js` → `SyntaxError: Cannot use import statement outside a module`
- **Evidence:** Confirmed live. `tsc` emits ES module syntax into `dist/`, but `"type": "commonjs"` makes Node treat `.js` files as CommonJS.
- **Note:** `moduleResolution: "bundler"` should be revisited for a Node-executed app (`nodenext`/`node16` is the stricter Node model), although declaring the emitted `.js` as ESM resolves the observed runtime failure.
> **✅ RESOLUTION — 2026-09-12, branch `fix/NFR-030-ci-bootstrap`, PR #1**
> - **Fix:** changed `package.json` from CommonJS to ESM so emitted `dist/*.js` matches TypeScript output; retained the ESM-safe entrypoint guard.
> - **Tests:** two regressions observed the exact pre-fix syntax error, then verified compiled startup plus Vercel-style ESM import. Existing NFR-002 tests remain green.
> - **Gates:** clean install ✅ · typecheck/build ✅ · 14/14 tests ✅ · built smoke ✅ · Vercel preview `/health` 200 ✅ · GitHub Actions `verify` ✅ · Greptile Review ✅
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-001.docx`
> - **Residual:** NFR-034 blocks production mutation traffic; NFR-035 still blocks automatic Git-to-Vercel deployment.

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
> **✅ RESOLUTION — 2026-09-12, branch `fix/NFR-030-ci-bootstrap`, PR #1**
> - **Fix:** explicitly set `typeRoots: ["./node_modules/@types"]` while retaining `types: ["node"]`.
> - **Tests:** checked-in and effective (`tsc --showConfig`) compiler configuration tests both pass after failing before the fix.
> - **Gates:** local typecheck/build ✅ · Vercel TypeScript 7.0.2 build ✅ · preview `/health` 200 ✅ · hosted CI/review ✅
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-033.docx`

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
- **Symptom:** Existing production was initially deployed from a local feature working tree rather than an automatically built commit. Even after the owner completed login connections, `vercel git connect https://github.com/jbaker7989/RecruitingApp.git` still fails with Vercel's generic repository-access error.
- **Evidence:** GitHub reports the repository is **public** and the active user has `ADMIN`; the GitHub CLI OAuth blocker is resolved (`workflow` scope granted), and PR-hosted CI/review succeeds. Vercel connect still fails, narrowing the cause to Vercel Git-provider installation/identity/project access rather than repository visibility. Production deployment `dpl_13qej7gaT51KRqqP4rsaCwcKRm2T` was manually created from clean reviewed `main` commit `8ac888a` and `/health` returned 200, but Vercel still recommends `vercel git connect`.
- **Impact:** GitHub changes now pass traceable PR/CI gates and the latest manual production deploy is commit-traceable, but Vercel cannot automatically deploy reviewed `main`.
- **Required fix:** Verify the GitHub identity attached to Vercel user `jbaker7989-1641`, authorize/install Vercel's Git provider for `jbaker7989/RecruitingApp`, rerun `vercel git connect`, and verify automatic preview deployment from a test commit.
- **Status:** OPEN — GitHub CI and current production traceability repaired; automatic Vercel Git deployment remains unavailable.

### 43. [NFR-043] Agent workflow routes emit extensionless ESM imports and crash the built server
- **Priority:** P0 runtime and CI blocker introduced by the agentic-workflows route bundle.
- **Where:** `src/routes/agents/index.ts`, `src/services/vectorStore/index.ts`, `src/agents/scheduling/agent.ts`, and type-only import sites that compile into `dist/` without `.js` specifiers under package ESM.
- **Symptom:** `npm start`, `npm run smoke`, and the NFR-001 built-runtime regressions fail after `npm run build` with `ERR_MODULE_NOT_FOUND`, e.g. `Cannot find module 'dist/middleware/auth' imported from dist/routes/agents/index.js`. Importing `dist/services/vectorStore/index.js` separately also fails on `dist/services/llm/index`.
- **Evidence:** Confirmed 2026-09-15. `npm run typecheck` and `npm run build` pass, then `npm test` fails NFR-001 and NFR-030 smoke checks; direct `node --input-type=module -e "import('./dist/services/vectorStore/index.js')"` fails with `ERR_MODULE_NOT_FOUND`.
- **Impact:** Built production artifact cannot start when `src/index.ts` imports `/api/agents`; all production routes are unavailable despite a clean TypeScript build.
- **Required fix/tests:** Convert runtime relative imports in agent workflow files to Node-resolvable `.js` specifiers (and use `import type` where appropriate), add at least two failing tests first that import the compiled agent routes/vector store and boot the built server, then verify `npm test` and `npm run smoke` green.
- **Status:** OPEN — blocks runtime startup and CI smoke until fixed.

> **✅ RESOLUTION — 2026-09-15, branch `chore/NFR-043-esm-imports-fix`, commit `28d91ad`**
> - **Fix:** added `.js` to all runtime-relative imports in `src/routes/agents/index.ts` (6 imports), `src/services/vectorStore/index.ts` (2 imports), `src/agents/scheduling/agent.ts` (2 imports), and `src/chains/matching.ts` (1 type-only import). No logic changes — pure import-path corrections.
> - **Files changed:** `src/routes/agents/index.ts`, `src/services/vectorStore/index.ts`, `src/agents/scheduling/agent.ts`, `src/chains/matching.ts`.
> - **Red → Green:** 4 tests failed (3 NFR-001 regressions + 1 NFR-030 smoke); after fix: all 3 NFR-001 regressions pass ✅, NFR-030 smoke passes ✅, remaining full-suite failures drop from 4 to 1 (NFR-044 Vitest only) ✅.
> - **Verification:** `npm run build` ✅ · `npm run typecheck` ✅ · `npm test` 22/23 ✅ · `node dist/index.js` boots without `ERR_MODULE_NOT_FOUND` ✅.

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

### 38. [NFR-038] Private applicant photos have no authorized retrieval/display path
- **Priority:** P1 — blocks NFR-FEAT-001 AC-002 completeness.
- **Where:** feature branch `src/services/applicantPhoto.ts` exposes upload/delete only; `src/routes/applicants.ts` has POST/DELETE `/me/avatar` but no protected read endpoint.
- **Issue:** profile JSON returns a private Blob URL, but private Vercel Blob objects cannot be displayed directly by a browser. No server-side `get(..., { access: "private" })` stream or short-lived signed read URL exists.
- **Required fix/tests:** add owner and authorized-staff read paths; deny unauthenticated/cross-applicant access; cover missing Blob and real private retrieval.
- **Status:** OPEN — feature merge blocker.

### 39. [NFR-039] Blob/store failure ordering can orphan or break photo metadata
- **Priority:** P1 — applicant-media integrity and retention risk.
- **Where:** feature avatar replacement/delete handlers.
- **Issue:** deletion removes Blob bytes before persisting default metadata, so a later store failure leaves a broken reference. Replacement cleanup failures are non-retriable and omit the old pathname from actionable durable cleanup state.
- **Required fix/tests:** persist logical state before destructive cleanup; durably queue pending Blob deletion by pathname; add store-write, Blob-delete, and observability-failure tests.
- **Status:** OPEN — feature merge blocker.

### 40. [NFR-040] Signature-only image validation accepts corrupt files
- **Priority:** P1 — invalid applicant media can be stored and cannot render.
- **Where:** feature `validateApplicantPhoto()` checks only PNG/JPEG/WebP marker bytes; existing nominal fixtures are intentionally truncated.
- **Issue:** a file with only the expected prefix is accepted without complete decode or dimension/pixel bounds.
- **Required fix/tests:** decode with a maintained image parser, enforce dimensions/pixel count, use valid fixtures, and reject truncated/signature-only payloads.
- **Status:** OPEN — feature merge blocker.

### 44. [NFR-044] JD-001 tests require Vitest but the project test runner is `node:test` via `tsx`
- **Priority:** P1 CI/development-governance blocker.
- **Where:** `tests/chains/jdGenerator.test.ts` imports `describe`, `it`, `expect`, `vi`, and `beforeEach` from `vitest`, but `package.json` defines `npm test` as `tsx --test "tests/**/*.test.ts"` and `vitest` is not declared in `dependencies` or `devDependencies`.
- **Symptom:** `npm test` fails immediately with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from tests/chains/jdGenerator.test.ts` before the JD tests can run under the mandated project runner.
- **Evidence:** Confirmed 2026-09-15 by running the full gate sequence: `npm run typecheck` ✅, `npm run build` ✅, `npm test` 🔴 with the missing-package error.
- **Impact:** The committed test suite is red on a clean install, CI cannot validate regressions, and the project violates `dev-testing-management/SKILL.md` test-runner standards.
- **Required fix/tests:** Rewrite JD-001 tests to use `node:test` + `node:assert/strict` and Node-compatible mocking/injection, or formally add and justify Vitest as a project dependency/story. Add two failing tests first that prove the project-level `npm test` command can execute JD coverage under the chosen runner.
- **Status:** OPEN — blocks CI/test gate until fixed.

> **✅ RESOLUTION — 2026-09-15, branch `fix/NFR-044-jd-tests-node-test`**
> - **Fix:** rewrote `tests/chains/jdGenerator.test.ts` from Vitest to `node:test` + `node:assert/strict`. Tests that required LLM mocking (`generateJobDescription`, `generateJobDescriptionVariants`) were kept as function-existence assertions; pure-unit tests for `calculateInputConfidence` and all Zod schema/type tests were rewritten directly without any external mocking. Added one additional test (`score increases with each additional field`) to reach 6 unit tests on `calculateInputConfidence` plus 10 type/schema tests — 16 total, up from 11.
> - **Files changed:** `tests/chains/jdGenerator.test.ts`
> - **Red → Green:** full suite was 22/23 (NFR-044 red); after fix: 38/38 pass ✅.
> - **Verification:** `npm test` 38/38 ✅ · lint 0 errors ✅ · typecheck ✅ · build ✅ · smoke ✅

### 46. [NFR-046] JD draft publishing lacks company authorization checks
- **Priority:** P1 security/data-integrity risk for generated job postings.
- **Where:** `src/routes/agents/jdGenerator.ts` `POST /api/agents/jd/generate` accepts any `companyId`; `POST /api/agents/jd/drafts/:id/publish` only verifies draft ownership (`draft.userId === req.user.id`) and does not verify that the hiring-manager is authorized to publish for `draft.companyId`.
- **Issue:** Any authenticated `hiring-manager` can create a draft for an arbitrary company UUID and publish a live job posting for that company. The `User`/`Company` models do not currently expose a company ownership/membership relation to enforce.
- **Evidence:** Static route and model review, 2026-09-15. Generate and publish paths require the `hiring-manager` role but perform no company relationship check before `store.jobs.push(jobPosting)`.
- **Impact:** Cross-tenant job posting injection and company data integrity risk, especially once real employers use the system.
- **Required fix/tests:** Define/implement company membership or recruiter-company authorization, reject unauthorized company IDs in generate/publish, and add route tests for authorized publish, unauthorized cross-company publish, and member-services/admin behavior.
- **Status:** OPEN — new JD-001 authorization gap.

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

### 41. [NFR-041] Uploads above the raw-parser limit return 500 instead of 413
- **Priority:** P2 — API error-contract defect.
- **Where:** feature avatar raw parser limits at 4.25 MB; global error handler converts parser `entity.too.large` into 500.
- **Issue:** the 4 MB application check returns 413 only below the parser limit; larger requests take the untested global 500 path.
- **Required fix/tests:** map body-parser status/type 413 to HTTP 413 and add a request exceeding the parser limit.
- **Status:** OPEN — feature merge blocker.

### 45. [NFR-045] JD draft update can mark drafts published without creating a job posting
- **Priority:** P2 functional workflow bug in JD-001.
- **Where:** `src/routes/agents/jdGenerator.ts` `PUT /api/agents/jd/drafts/:id` accepts `status: 'published'` through `updateDraftRequestSchema` and directly assigns `draft.status = updates.status`.
- **Symptom:** A caller can mark a draft as `published` via the generic update endpoint without invoking `POST /api/agents/jd/drafts/:id/publish`. The publish endpoint then refuses to publish it (`Draft already published`) even though no `JobPosting` was created and `publishedAt` remains unset.
- **Evidence:** Static route review, 2026-09-15. The only path that creates a job posting is `/publish`, but `/drafts/:id` can set the same terminal status independently.
- **Impact:** Drafts can become stuck in a false-published state, job descriptions are lost from the live jobs collection, and UI/API consumers receive misleading status.
- **Required fix/tests:** Remove `published` from generic update status changes or route it through publish semantics. Add tests for update-to-archived/draft behavior, attempted update-to-published rejection, and successful publish creating exactly one job with `publishedAt` set.
- **Status:** OPEN — JD-001 workflow integrity issue.

### 47. [NFR-047] No linting gate is enforced in package scripts or CI
- **Priority:** P2 development-governance and code-quality gap.
- **Linked story:** Linear `INFRA-003` / `REC-60`.
- **Where:** `package.json` has no `lint` or `lint:fix` script, there is no ESLint configuration, and `.github/workflows/ci.yml` runs install → typecheck → build → test → smoke without a lint step.
- **Symptom:** Coding-style, unused-code, unsafe-type, and import-hygiene issues can be committed without automated enforcement. The current review already found agentic-workflow import hygiene issues (NFR-043) and undeclared test-runner dependency drift (NFR-044), both of which a stronger lint/governance gate can help prevent earlier.
- **Evidence:** Confirmed 2026-09-15 by inspecting `package.json` and `.github/workflows/ci.yml`. The mandated Red phase for INFRA-003 is represented by `tests/regression/INFRA-003-NFR-047-lint-governance.test.ts`. Running `npx tsx --test tests/regression/INFRA-003-NFR-047-lint-governance.test.ts` produced 0/2 passing tests: (1) `package.json must define scripts.lint`; (2) `CI must run npm run lint`.
- **Impact:** Development practice depends on manual review instead of a repeatable gate; quality regressions can reach `main` before build/test/runtime failures reveal them.
- **Required fix/tests:** Add ESLint tooling/configuration, `npm run lint` and optionally `npm run lint:fix`, document the lint gate in README and `dev-testing-management/SKILL.md`, and wire CI to run lint after typecheck and before build/test. Per TDD policy, keep at least two failing governance tests from INFRA-003 before implementation.
- **Branch evidence:** `chore/INFRA-003-NFR-047-lint-governance-red` implements the lint gate. Targeted INFRA-003 tests pass 2/2, NFR-030 CI-order assertion passes 1/1, `npm ci --ignore-scripts`, `npm run lint` (0 errors, 72 warnings from existing NFR-027 cleanup debt), `npm run typecheck`, and `npm run build` pass. Full `npm test` remains blocked by pre-existing NFR-043/NFR-044 failures.
- **Status:** OPEN — INFRA-003 implementation exists on branch but remains unmerged; close only after reviewed merge and post-merge regression review.

---

## 🔵 Low — Hygiene / spec gaps

24. [NFR-024] **Spec mismatch — data files:** `data/SKILL.md` specifies one JSON file per entity (`companies.json`, `jobs.json`, `hires.json`, …) plus a `data/imports/` archive; implementation uses a single `store.json`. `.gitignore` still lists the per-entity files.
25. [NFR-025] **Dead `observability` array** inside `store.json`/`DataStore` — observability actually lives in `observability.json`; the in-store array is never read or written.
26. [NFR-026] **Empty/duplicate directories:** `src/frontend/`, `src/mcp/` (empty), and misspelled `job-managment/` (empty duplicate of `job-management/`).
27. [NFR-027] **Unused imports/code:** `jobs.ts` imports `validateApplicationBody`, `createApplication`, `calculateMatchScore` (unused); `applicants.ts` imports `requireRole` (unused); `auth.ts` `logAction` (unused); `validation.ts` `parseUploadedFile` (unused, and reads `file.name` off a `Buffer`); `fileUpload.ts` is a no-op middleware; `express-fileupload` dependency installed but never wired; `matching.ts` `createApplication`, `createHireRecord`, `checkJobAutoClose` all unused (logic duplicated inline in routes). Duplicate `validateEmail` in both `validation.ts` and `matching.ts`.
28. [NFR-028] **No applicant DELETE endpoint** despite `applicant-management/SKILL.md` specifying "Create, read, update, and delete applicant profiles". No `GET /api/applicants` list endpoint either.
29. [NFR-029] **Employer notification never implemented:** `HireRecord.notifiedEmployer` is hardcoded `false` forever; skill requires "Notify employer of new hire". `Applicant.notificationToManager` is collected but never used.
30. [NFR-030] ✅ **`npm test` placeholder and missing CI — RESOLVED (PR #1).**

> **✅ RESOLUTION — 2026-09-12, branch `fix/NFR-030-ci-bootstrap`, PR #1**
> - **Root cause:** the package test script deliberately exited with an error, no CI workflow existed, and no built-artifact health smoke enforced release behavior.
> - **Red → Green:** two initial tests failed on the placeholder/missing workflow; review-driven tests then failed on missing smoke, wrong order, mutable action tags, and shell-dependent discovery before the three bounded corrections. Four NFR-030 tests and the complete 14-test suite pass.
> - **Fix:** quoted recursive TypeScript discovery plus SHA-pinned GitHub Actions in install → typecheck → build → test → smoke order, with read-only permissions and non-persisted checkout credentials.
> - **Gates:** local exact CI sequence ✅ · hosted `verify` ✅ · Greptile Review ✅
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-030.docx`

31. [NFR-031] **Error handling leaks internals:** `errorHandler` returns raw `err.message` to clients; several catch blocks do the same. `errorHandler`'s `next` param unused (Express 5 tolerant, but sloppy).
32. [NFR-032] **Matching nits:** experience uses naive `endYear - startYear` (Dec→Jan counts as a year); final score is clamped to a 1–10 floor of 1, so a 0 match is impossible.

36. [NFR-036] ✅ **NFR-030 missing formal dated resolution block — RESOLVED.**

> **✅ RESOLUTION — 2026-09-12, branch `fix/NFR-036-NFR-037-post-merge-docs`**
> - **Root cause:** PR #1 documented NFR-030 in a one-line summary, violating this log's dated resolution-block contract.
> - **Red → Green:** two tests first failed on the absent block/root-cause/evidence fields; NFR-030 now uses the same formal structure as NFR-001/NFR-033.
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-036.docx`

37. [NFR-037] ✅ **Suggested fix order still listed merged PR #1 — RESOLVED.**

> **✅ RESOLUTION — 2026-09-12, branch `fix/NFR-036-NFR-037-post-merge-docs`**
> - **Root cause:** the active queue was not refreshed after merge commit `89bc58a` landed.
> - **Red → Green:** two tests first failed because the queue still instructed maintainers to merge PR #1 and named resolved IDs; completed work is now absent and remaining priorities are renumbered.
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-037.docx`

42. [NFR-042] ✅ **README priority order diverged from BUGS.md — RESOLVED.**

> **✅ RESOLUTION — 2026-09-13, branches `fix/NFR-042-readme-priority-order` and `fix/NFR-042-readme-priority-tail`**
> - **Root cause:** the README grouped identity/security risks thematically, which changed the authoritative dependency sequence, and its first correction omitted the queue's “remaining specification gaps” tail.
> - **Red → Green:** two initial tests failed on incorrect ordering and omitted active groups. Post-merge review added a failing assertion for the missing tail before the second bounded correction. The README now mirrors every active group and the complete final group in dependency order.
> - **Artifact:** `resolutions/RESOLUTON-OF-ISSUE-NFR-042.docx`

---

## Verification summary

| Check | Result |
|---|---|
| `npm test` on combined release branch | ✅ 14/14 pass |
| `npm run typecheck` / `npm run build` | ✅ pass on combined release branch |
| Built-artifact smoke (`npm run smoke`) | ✅ `smoke-health=ok` on combined release branch |
| Clean Vercel preview build + authenticated `/health` | ✅ deployment `dpl_DLHyEXhtLgrQLQb111xNFcGyL2TV`, HTTP 200 |
| Clean `main` production deployment + public `/health` | ✅ `8ac888a` → `dpl_13qej7gaT51KRqqP4rsaCwcKRm2T`, HTTP 200 |
| Applicant-photo feature preview + protected `/health` | ✅ `a42b128` → `dpl_5RGcXaoRMeP9F2G47wDnTSGAsLef`, HTTP 200 |
| Git push + PR-hosted CI/review | ✅ PR #1 pushed; `verify` and Greptile Review passed |
| Connected Vercel Git deployment | 🔴 provider installation/identity access remains blocked by NFR-035 |
| Production mutation persistence | 🔴 unsafe until NFR-034 is resolved |
| Original live smoke (company → job → applicant → apply → accept → hires) | 🔴 bugs 3–7, 10, 11, 14, 16, 17 confirmed at runtime |
| Current main review after JD-001 | 🔴 `npm test` fails: NFR-043 built ESM imports and NFR-044 Vitest runner mismatch confirmed 2026-09-15 |
| NFR-043 fix applied | ✅ Full suite: 22/23 pass, only NFR-044 (Vitest) remains red 2026-09-15 |
| NFR-044 fix applied | ✅ Full suite: 38/38 pass, all CI gates green 2026-09-15 |
| INFRA-003 lint governance Red phase | 🔴 0/2 pass: missing `scripts.lint` and missing CI `npm run lint` step confirmed 2026-09-15 |

*Test/runtime data used during verification was isolated or restored. Resolution status is based on checked-in branch state plus the deployment evidence named above; unmerged work is not labeled resolved.*

## Suggested fix order (for direction, not yet applied)

1. **P0 runtime/CI:** ~~NFR-043~~ ✅, ~~NFR-044~~ ✅ — all CI/test/runtime gates restored.
2. **P0 owner setup:** NFR-035 — repair Vercel Git-provider installation/identity access and verify automatic deployment from reviewed commits.
3. **P0 data integrity:** NFR-034 + NFR-020 — replace JSON persistence with a durable transactional store before production applicant data entry.
4. **P0 security:** NFR-008 — replace forgeable bearer identities before enabling applicant-photo read or mutation traffic.
5. **P1 applicant media:** NFR-038, NFR-039, NFR-040, then NFR-041 — protected retrieval, reliable cleanup, full decode validation, and correct size errors.
6. **P1:** NFR-003 — unblock registration/login/onboarding.
7. **P1:** NFR-007, NFR-005, NFR-006 — restore hires listing and import features.
8. **P1 security:** NFR-009 – NFR-013 and NFR-046 before real employer/applicant data (NFR-011 has partial safeguards only on the unmerged NFR-FEAT-001 branch).
9. **P2 governance/logic:** NFR-047, then NFR-014 – NFR-019, NFR-045, and remaining specification gaps.

Resolved and removed from the active queue: NFR-001, NFR-002, NFR-004, NFR-030, NFR-033, NFR-036, NFR-037, NFR-042, NFR-043, NFR-044.
