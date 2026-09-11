---
name: dev-testing-management
description: Test-driven development process, branching strategy, and CI/CD pipeline governance for all bug fixes and feature work in the New Fronteir Recruiting application
---

# Dev Testing Management Skills

This skill governs how all engineering work is executed in the New Fronteir Recruiting application: every bug fix and feature is delivered through a test-driven development (TDD) cycle on a dedicated git branch, validated by the CI/CD pipeline, and merged only when all gates pass. No direct commits to `main`. No fix without a failing test first.

## Core Functions

### Work Item Tracking
- Every bug is tracked by a unique alphanumeric ID from `BUGS.md` (format `NFR-0XX`, e.g. `NFR-004`)
- Every feature is tracked by a story ID (format `NFR-FEAT-0XX`, assigned sequentially in the feature backlog)
- Tests, branches, commits, and PRs must reference the work item ID so the full lifecycle is traceable: `BUGS.md entry → failing test → branch → fix → green pipeline → merge`
- When a bug is fixed, its `BUGS.md` entry is annotated with the fixing branch/PR and marked ✅ resolved

### Test-Driven Development Cycle (Red → Green → Refactor)
1. **Red** — Write a test that reproduces the bug (or specifies the feature's acceptance criteria). Run it and **confirm it fails for the right reason** (e.g. fails with the exact `500 "Cannot read properties of undefined"` from the bug report, not a syntax error in the test itself). A test that passes immediately proves nothing — investigate before proceeding.
2. **Green** — Implement the **minimum** change that makes the test pass. No drive-by changes, no scope creep into other bug IDs.
3. **Refactor** — Clean up with the test suite green. Re-run the full suite before committing.

### Test Standards
- **Runner:** Node's built-in test runner (`node:test`) executed via `tsx --test` — no new test framework dependency unless a story explicitly justifies it. (Bootstrap work under `NFR-030` replaces the placeholder `npm test` script with `tsx --test tests/**/*.test.ts`.)
- **Location:** `tests/` directory, mirroring `src/` structure (e.g. `tests/routes/applications.test.ts`)
- **Naming:** one file per work item or module; regression tests named for the bug: `tests/regression/NFR-004-hires-array.test.ts`
- **Tagging:** every test's `describe`/`it` block includes the work item ID, e.g. `it('NFR-004: accepting an application creates a hire record', ...)`
- **Isolation:** tests must not touch committed `data/store.json` or `data/observability.json`. Each test run uses a temp data directory (override via env var, e.g. `DATA_DIR=$(mktemp -d)`) and seeds its own fixtures
- **Types of tests:**
  - *Unit* — pure logic (matching scores, validators, import parsing)
  - *Route/integration* — boot the Express app on an ephemeral port and assert HTTP status + body (this is how most `BUGS.md` items were evidenced; tests must assert the **correct** behavior, not the current broken behavior)
  - *Regression* — one test minimum per `NFR-0XX` bug, encoding its `BUGS.md` "Evidence" section as an assertion

### Branching Strategy
- Branch from an up-to-date `main` (`git checkout main && git pull`)
- Naming:
  - Bug fix: `fix/NFR-004-hires-array-migration`
  - Feature: `feat/NFR-FEAT-001-applicant-delete-endpoint`
  - Pipeline/tooling: `chore/<slug>`
- One work item per branch. Batch only when bugs share a root cause (e.g. `NFR-001` + `NFR-002` module/startup fixes may share one branch)
- Commit messages: `type(NFR-ID): summary` — e.g. `test(NFR-004): add failing regression for missing hires array`, `fix(NFR-004): default missing store keys on read`
- Keep branches short-lived; rebase on `main` if it drifts

### CI/CD Pipeline Gates
Every push and PR to `main` runs the pipeline (GitHub Actions, `.github/workflows/ci.yml`). **Merge is blocked unless all gates pass, in order:**

| Gate | Command | Purpose |
|------|---------|---------|
| 1. Install | `npm ci` | Deterministic dependency install |
| 2. Typecheck | `npm run typecheck` | `tsc --noEmit` must be clean |
| 3. Build | `npm run build` | `tsc` emits without error |
| 4. Test | `npm test` | Full suite green (unit + integration + regression) |
| 5. Smoke | boot server, `curl /health` expects 200 | Proves the built artifact actually starts (guards `NFR-001`/`NFR-002` class regressions) |

- **CD:** merges to `main` produce a verified, runnable `dist/` artifact; deployment stories are out of scope until the pipeline bootstrap is complete
- Pipeline status is reported on the PR; a red pipeline is never overridden by hand

### Merge Requirements (Definition of Done)
A work item is done only when **all** are true:
1. Regression/acceptance test exists, includes the work item ID, and was observed failing before the fix
2. Full pipeline green on the branch (all 5 gates)
3. `BUGS.md` / feature backlog updated with resolution annotation
4. No uncommitted changes; `git status` clean; no stray files (`agent-home/`, temp data, `.env`) in the diff
5. PR reviewed and merged to `main` — squash merge preferred, branch deleted after merge

### Sequencing Constraint (Pipeline Bootstrap)
The pipeline itself cannot work until the app builds, starts, and has a test runner. Therefore the first branches under this skill, in order:
1. `chore/ci-bootstrap` — real `npm test` script + `tests/` skeleton + `.github/workflows/ci.yml` (addresses `NFR-030`)
2. `fix/NFR-001-…` + `fix/NFR-002-…` — build/start fixes, proven by the new smoke gate
3. Remaining bugs per the fix order in `BUGS.md`

## Files
- `BUGS.md` — Bug registry and source of `NFR-0XX` IDs
- `tests/` — All test suites (unit, integration, regression)
- `.github/workflows/ci.yml` — Pipeline definition
- `package.json` — `test`, `typecheck`, `build` scripts are pipeline entry points

## Roles
- `member-services`: Approves pipeline changes and merge-gate exceptions (none permitted for red pipelines)
- `recruiter`/`hiring-manager`: Acceptance-review feature stories against their domain skill files
- Any contributor: May author branches and PRs following this skill

## Observability
- Every merged fix annotates its `BUGS.md` entry (ID, branch, PR, date)
- Pipeline runs are the audit trail for "tests failed first, then passed" — PRs should link the red run (before fix) and the green run (after fix)
- Repeated regression-test failures on `main` trigger a review of the merge gates before new work proceeds
