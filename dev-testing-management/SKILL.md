---
name: dev-testing-management
description: Test-driven development process, branching strategy, and CI/CD pipeline governance for all bug fixes and feature work in the New Fronteir Recruiting application
---

# Dev Testing Management Skills

This skill governs how all engineering work is executed in the New Fronteir Recruiting application. Every bug fix and every feature follows the same lifecycle: branch named for the work item ID, at least two failing tests first, a bounded fix loop, documented resolution, merge back to `main`, and a post-merge regression review that feeds any newly discovered bugs back into `BUGS.md` with priority. No direct commits to `main`. No fix without failing tests first.

## Core Functions

### Work Item Tracking
- Every bug is tracked by a unique alphanumeric ID from `BUGS.md` (format `NFR-0XX`, e.g. `NFR-004`)
- Every feature is tracked by a story ID (format `NFR-FEAT-0XX`, assigned sequentially in the feature backlog)
- Tests, branches, commits, and PRs must reference the work item ID so the full lifecycle is traceable: `BUGS.md entry → failing tests → branch → fix → green pipeline → merge → post-merge review`
- New bugs discovered during post-merge review receive the next sequential ID in `BUGS.md`, a severity (🔴🟠🟡🔵), and a priority position relative to the existing backlog

### Pre-Development Test Requirement (MANDATORY)
> **Before ANY development begins on a story, bug, or enhancement, two tests MUST be written and confirmed failing.**

This is a hard prerequisite — no exceptions:
- **Stories/Features:** Write 2 tests covering acceptance criteria before writing any implementation code
- **Bug Fixes:** Write 2 regression tests encoding the bug evidence before writing any fix code
- **Enhancements:** Write 2 tests for the new behavior being added

The test-first requirement ensures:
1. The failure is understood and reproducible
2. The fix/feature is validated by tests, not manual inspection
3. Regression protection exists from day one

**Procedure:**
1. Write 2 tests for the work item
2. Run tests and confirm they fail (with the correct failure mode)
3. Only then proceed to implementation
4. Tests must remain in the codebase with the work item ID in the filename

### The Development Lifecycle (mandatory, in order)

**Step 1 — Branch**
- Branch from an up-to-date `main` (`git checkout main && git pull`)
- Name the branch after the work item ID:
  - Bug fix: `fix/NFR-004` (optionally with a slug: `fix/NFR-004-hires-array-migration`)
  - Feature: `feat/NFR-FEAT-001`
  - Pipeline/tooling: `chore/<slug>`
- One work item per branch. Batch only when bugs share a root cause (e.g. `NFR-001` + `NFR-002` may share one branch)

**Step 2 — Write failing tests (Red)** ⚠️ **MANDATORY — No implementation until tests are written and confirmed failing**
- Write **exactly two or more tests per work item** before any implementation code is written
- For bugs: encode the `BUGS.md` evidence as test assertions (exact error messages, expected vs actual behavior)
- For features: write tests for acceptance criteria that will validate the implementation
- Run them and **confirm every new test fails, and fails for the right reason** (e.g. fails with the exact `500 "Cannot read properties of undefined"` from the bug report — not a syntax error in the test itself)
- A test that passes immediately proves nothing — investigate before proceeding
- **Development code must NOT be written until these tests exist and are confirmed failing**
- Test file naming: `tests/{category}/{NFR-ID}-{slug}.test.ts` (e.g. `tests/regression/NFR-003-auth-chicken.test.ts`, `tests/chains/JD-001-jd-generator.test.ts`)

**Step 3 — Implement the fix, bounded loop (Green)**
- Implement the minimum change that makes the failing tests pass — no drive-by changes, no scope creep into other IDs
- If the tests do not pass: review the error, update the code, re-run
- **This fix loop runs a maximum of 3 iterations.** If the tests still fail after 3 attempts, stop, revert or quarantine the half-fix, document what was tried, and escalate for direction rather than thrashing

**Step 4 — Document the fix**
- Record, for every resolved item: root cause, what changed (files/functions), why the fix is correct, and the test evidence (red run → green run)
- Documentation lives in: (a) the resolution annotation on the item's `BUGS.md` entry, (b) the commit/PR body, and (c) a **Word resolution document** (see below)
- **Resolution Word document (mandatory per fix):** create `resolutions/RESOLUTON-OF-ISSUE-{issue ID}.docx` (e.g. `resolutions/RESOLUTON-OF-ISSUE-NFR-004.docx`). Required sections:
  1. Issue (ID, severity, title, where reported)
  2. Symptoms (the observed failures / evidence)
  3. Root cause
  4. Resolution summary (status, branch, merge commit, date)
  5. Fix implemented (changes + files touched)
  6. Test evidence, red → green (each test's pre-fix failure and post-fix pass; loop iterations used of the 3 permitted)
  7. Pipeline gates (pass/fail per gate, any documented deviations)
  8. Post-merge regression review (areas audited, new bugs found/filed or none)
  9. Related (BUGS.md entry, related IDs, work unblocked)
- The document is generated programmatically (e.g. `python-docx`) so formatting stays consistent across fixes; commit it alongside the `docs(NFR-ID)` commit on the fix branch

**Step 5 — Test the fix and merge**
- Full suite green plus all CI pipeline gates passing on the branch
- Merge back into `main` with the bug/feature ID noted in the merge commit (e.g. `merge: fix NFR-004 — default missing hires array`), squash merge preferred, branch deleted after merge

**Step 6 — Post-merge regression review**
- After every merge, review the codebase areas touched by the fix/feature to determine whether any **new bugs were introduced**
- Check at minimum: the modified files, their direct callers/callees, the data schemas they read/write, and the full test suite on `main`
- **Check the deployed application, not only the repository** (see Deployment Standards): production `/health` via `npm run verify:deploy`, Vercel runtime logs for the new deployment, and — whenever dependencies or runtime-loaded files changed — the built function bundle
- If the work cannot be merged or deployed yet (e.g. waiting on owner-only setup), run the same review on the branch and its preview deployment, record that it was pre-merge, and repeat the deployed checks after merge
- **Step 7 — File and prioritize new bugs**
- Any new bug found is added to `BUGS.md` with: the next sequential `NFR-0XX` ID, severity, evidence, the introducing branch/PR, and a priority position so it enters the fix queue in a prioritized way (highest severity first, then dependency order per the suggested fix order)

### Test Standards
- **Quantity:** **minimum 2 tests per work item** — this is a hard prerequisite that must be satisfied BEFORE development begins. Features require tests for every acceptance criterion.
- **Pre-development requirement:** Tests MUST be written and confirmed failing before any implementation code is written. This is not optional.
- **Runner:** Node's built-in test runner (`node:test`) executed via `tsx --test` — no new test framework dependency unless a story explicitly justifies it. (Bootstrap work under `NFR-030` replaces the placeholder `npm test` script with `tsx --test tests/**/*.test.ts`.)
- **Location:** `tests/` directory, mirroring `src/` structure (e.g. `tests/routes/applications.test.ts`); regression tests in `tests/regression/`; feature chains in `tests/chains/`
- **Naming/tagging:** file named for the work item (e.g. `NFR-004-hires-array.test.ts`, `JD-001-jd-generator.test.ts`); every `describe`/`it` block includes the ID, e.g. `it('NFR-004: accepting an application creates a hire record', ...)`
- **Isolation:** tests must not touch committed `data/store.json` or `data/observability.json`. Each test run uses a temp data directory (override via env var, e.g. `DATA_DIR=$(mktemp -d)`) and seeds its own fixtures
- **Types of tests:**
  - *Unit* — pure logic (matching scores, validators, import parsing)
  - *Route/integration* — boot the Express app on an ephemeral port and assert HTTP status + body (assert the **correct** behavior, not the current broken behavior)
  - *Regression* — encode the bug's `BUGS.md` "Evidence" section as assertions
  - *Feature* — validate implementation against acceptance criteria (written before implementation)
  - *Third-party call* — any code path that calls a library (parsers, SDKs, view engines) needs at least one test that executes the real library call with real input. Type-casting an import to `any` or mocking the library hides API mismatches (`NFR-072`: `pdf-parse` v2 was called with the v1 API and no test ran it)
  - *Deployment artifact* — assert against what the deployment platform ships, using the platform's own tooling at the version it ships (`NFR-071`: `tests/regression/NFR-071-vercel-bundle-trace.test.ts` traces `dist/index.js` with the pinned `@vercel/nft`)

### Lint Standards
- **Required gate:** every branch must pass `npm run lint` before build/test/smoke and before merge.
- **Scope:** lint covers `src/**/*.ts` and `tests/**/*.test.ts`.
- **Initial enforcement:** existing pre-lint cleanup debt is tracked separately (NFR-027), so warnings may be tolerated only when documented; lint errors must be fixed or explicitly converted to warnings with a linked debt issue.
- **No bypass:** do not use `--no-verify`, CI overrides, or local-only exclusions to bypass lint failures.

### Commit Standards
- Messages: `type(NFR-ID): summary`
  - `test(NFR-004): add failing regression for missing hires array`
  - `fix(NFR-004): default missing store keys on read`
  - `docs(NFR-004): record root cause and resolution in BUGS.md`
  - `merge: fix NFR-004 — default missing hires array`
- Keep branches short-lived; rebase on `main` if it drifts

### CI/CD Pipeline Gates
Every push and PR to `main` runs the pipeline (GitHub Actions, `.github/workflows/ci.yml`). **Merge is blocked unless all gates pass, in order:**

| Gate | Command | Purpose |
|------|---------|---------|
| 0. Test-First | Tests written and confirmed failing BEFORE development | Enforces TDD practice; no implementation without failing tests |
| 1. Install | `npm ci` | Deterministic dependency install |
| 2. Typecheck | `npm run typecheck` | `tsc --noEmit` must be clean |
| 3. Lint | `npm run lint` | ESLint must check source and test TypeScript before build/test |
| 4. Build | `npm run build` | `tsc` emits without error |
| 5. Test | `npm test` | Full suite green (unit + integration + regression) |
| 6. Smoke | boot server, `curl /health` expects 200 | Proves the built artifact actually starts (guards `NFR-001`/`NFR-002` class regressions) |
| 7. Bundle trace | part of `npm test` (`NFR-071` regression) | Proves the Vercel function bundle contains the files the server loads |
| 8. Deploy verify | `npm run verify:deploy` (`.github/workflows/deploy-verify.yml`, on `deployment_status`) | Proves the deployed URL answers `/health`; a "Ready" build is not evidence of a working function |

- **CD:** Vercel builds Production from `main` and a Preview for every pushed branch. Gates 1–7 run in `ci.yml` before merge; gate 8 runs after each successful Vercel deployment
- **NFR-072–076 branch coverage (2026-10-05, unmerged):** smoke runs development and production with generated test secrets (`NFR-076`); gate 8 fails protected/unreachable URLs instead of reporting a skipped pass (`NFR-074`); NFR-073 checks the PDF worker and exercises real parsing in an isolated traced artifact. The NFR-071 trace audit resolves each OpenAI subpath from its actual LangChain importer (`NFR-075`). These local checks do not prove hosted health: owner-only signing/bypass secrets, reviewed merge, deployment runtime logs and affected-feature checks remain required. NFR-077/NFR-078 separately block real upload/prompt workflows.
- Pipeline status is reported on the PR; a red pipeline is never overridden by hand

### Deployment Standards (Vercel)
These rules exist because of `NFR-071`: production returned 500 on every route from at least 2026-09-24 until it was noticed on 2026-10-03, while every build was "Ready" and every CI gate was green.

- **Green build ≠ working deployment.** Vercel marks a deployment "Ready" when the build finishes; the function is first loaded on the first request. Never report a deployment as healthy from build status, the GitHub `Vercel` check, or CI alone — request `/health` on the deployed URL and read the runtime logs (`vercel logs <url> --since 15m`).
- **Test the artifact that ships.** `npm run smoke` runs `dist/` against the full `node_modules`; Vercel runs a traced subset. Any work item that adds, removes, or upgrades a dependency, or adds code that loads files at runtime, must:
  1. run the full suite (the bundle-trace test must stay green), and
  2. run `vercel build` locally, boot `.vercel/output/functions/index.func` with `NODE_ENV=production`, and exercise the affected feature end to end — not only `/health`.
- **Runtime-loaded files are invisible to the tracer.** Dynamic `import()`/`require()` with computed paths, worker files, view templates, native bindings, and data files are not found by static tracing (`NFR-073`: the `pdfjs-dist` worker). Each such file needs an explicit static reference or include rule **and** an assertion in the bundle-trace test.
- **Read tracer warnings.** A `Failed to resolve dependency` or `Failed to parse` warning from `@vercel/nft` for a package the app uses is a defect until shown otherwise; check that Node itself can resolve the import and that the target file is in the trace.
- **Keep the pinned tracer honest.** `@vercel/nft` in `devDependencies` is pinned to the version the Vercel builder ships (`npm view vercel dependencies.@vercel/node`, then `npm view @vercel/node@<version> dependencies.@vercel/nft`). Re-check when upgrading the Vercel CLI; a newer tracer can hide a defect production still has.
- **Environment variable parity.** A work item that introduces or changes a required environment variable must, in the same branch: add it to `.env.example`, list it in the PR body under "Required before deploy", and confirm it exists in Vercel for Production and Preview (`vercel env ls`) before merge. Code that fails fast when a variable is missing must have a test that runs the built server with `NODE_ENV=production` (`NFR-056`, `NFR-076`).
- **A skipped check is not a pass.** A gate that could not reach its target must fail or be reported as "not verified" in the PR — never as green (`NFR-074`).
- **Import only declared dependencies.** Do not import a package that is absent from `package.json`, and do not import a package's internal paths, unless it is a documented workaround with a comment naming the bug ID and the condition for removing it (`NFR-075`).
- **Workarounds for platform defects** are filed in `BUGS.md` with the upstream version that fixes them, so they are removed rather than accumulated.
- **Owner-only setup** (Vercel secrets, repository secrets, protection settings) is listed explicitly in the PR and in the `BUGS.md` entry as "Blocked on owner"; the item stays open until the owner step is done and the deployed check passes.

### Merge Requirements (Definition of Done)
A work item is done only when **all** are true:
1. **TWO OR MORE tests written BEFORE development started**, include the work item ID in filename, and were observed failing before the fix (Red phase documented)
2. Fix completed within the 3-iteration loop cap (or formally escalated)
3. Fix documented: root cause + changes + test evidence in `BUGS.md` annotation, commit/PR body, **and** `resolutions/RESOLUTON-OF-ISSUE-{issue ID}.docx`
4. Full pipeline green on the branch (install, typecheck, lint, build, test, smoke)
5. Merge commit notes the bug/feature ID; `git status` clean; no stray files (`agent-home/`, temp data, `.env`) in the diff
6. Post-merge regression review performed; any new bugs filed in `BUGS.md` with ID, severity, and priority
7. If dependencies, runtime-loaded files, environment variables, or deployment configuration changed: Deployment Standards followed, and the built function bundle exercised for the affected feature
8. After merge, production `/health` returns 200 (`npm run verify:deploy`) and the new deployment's runtime logs show no load errors; a work item whose production check is red or unverified is not done

### Sequencing Constraint (Pipeline Bootstrap)
The pipeline itself cannot work until the app builds, starts, and has a test runner. Therefore the first branches under this skill, in order:
1. `chore/ci-bootstrap` — real `npm test` script + `tests/` skeleton + `.github/workflows/ci.yml` (addresses `NFR-030`)
2. `fix/NFR-001` + `fix/NFR-002` — build/start fixes, proven by the new smoke gate
3. Remaining bugs per the prioritized order in `BUGS.md`

## Files
- `BUGS.md` — Bug registry, source of `NFR-0XX` IDs, resolution annotations, and priority order
- `resolutions/` — Per-fix Word resolution documents (`RESOLUTON-OF-ISSUE-{issue ID}.docx`)
- `tests/` — All test suites (unit, integration, regression)
- `.github/workflows/ci.yml` — Pipeline definition
- `.github/workflows/deploy-verify.yml` — Post-deploy health gate (runs on Vercel `deployment_status`)
- `scripts/ci-smoke.mjs` — Built-artifact smoke gate
- `scripts/verify-deployment.mjs` — Deployed-URL health check (`DEPLOYMENT_URL=<url> npm run verify:deploy`)
- `tests/regression/NFR-071-vercel-bundle-trace.test.ts` — Vercel bundle-trace gate
- `.env.example` — Every environment variable the app reads, including production-only secrets
- `package.json` — `test`, `typecheck`, `lint`, `build`, `smoke`, `verify:deploy` scripts are pipeline entry points

## Roles
- `member-services`: Approves pipeline changes and merge-gate exceptions (none permitted for red pipelines)
- `recruiter`/`hiring-manager`: Acceptance-review feature stories against their domain skill files
- Any contributor: May author branches and PRs following this skill

## Observability
- Every resolved item's `BUGS.md` entry records: ID, branch, PR, date, root cause, fix summary, red→green evidence
- PRs link the red run (before fix) and the green run (after fix) as the audit trail for "tests failed first, then passed"
- Post-merge reviews and any resulting new bug entries are logged with the introducing branch/PR for traceability
- Repeated regression-test failures on `main` trigger a review of the merge gates before new work proceeds
- Deployment evidence in a resolution names the deployment ID, the HTTP result of `/health` on the deployed URL, and the runtime-log check — not only the build status
