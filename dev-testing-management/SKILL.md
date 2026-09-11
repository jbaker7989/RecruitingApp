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

### The Development Lifecycle (mandatory, in order)

**Step 1 — Branch**
- Branch from an up-to-date `main` (`git checkout main && git pull`)
- Name the branch after the work item ID:
  - Bug fix: `fix/NFR-004` (optionally with a slug: `fix/NFR-004-hires-array-migration`)
  - Feature: `feat/NFR-FEAT-001`
  - Pipeline/tooling: `chore/<slug>`
- One work item per branch. Batch only when bugs share a root cause (e.g. `NFR-001` + `NFR-002` may share one branch)

**Step 2 — Write failing tests (Red)**
- Write **at least two tests per bug** (or per feature acceptance criterion) covering the broken/intended functionality
- Run them and **confirm every new test fails, and fails for the right reason** (e.g. fails with the exact `500 "Cannot read properties of undefined"` from the bug report — not a syntax error in the test itself)
- A test that passes immediately proves nothing — investigate before proceeding

**Step 3 — Implement the fix, bounded loop (Green)**
- Implement the minimum change that makes the failing tests pass — no drive-by changes, no scope creep into other IDs
- If the tests do not pass: review the error, update the code, re-run
- **This fix loop runs a maximum of 3 iterations.** If the tests still fail after 3 attempts, stop, revert or quarantine the half-fix, document what was tried, and escalate for direction rather than thrashing

**Step 4 — Document the fix**
- Record, for every resolved item: root cause, what changed (files/functions), why the fix is correct, and the test evidence (red run → green run)
- Documentation lives in: (a) the resolution annotation on the item's `BUGS.md` entry, and (b) the commit/PR body

**Step 5 — Test the fix and merge**
- Full suite green plus all CI pipeline gates passing on the branch
- Merge back into `main` with the bug/feature ID noted in the merge commit (e.g. `merge: fix NFR-004 — default missing hires array`), squash merge preferred, branch deleted after merge

**Step 6 — Post-merge regression review**
- After every merge, review the codebase areas touched by the fix/feature to determine whether any **new bugs were introduced**
- Check at minimum: the modified files, their direct callers/callees, the data schemas they read/write, and the full test suite on `main`
- **Step 7 — File and prioritize new bugs**
- Any new bug found is added to `BUGS.md` with: the next sequential `NFR-0XX` ID, severity, evidence, the introducing branch/PR, and a priority position so it enters the fix queue in a prioritized way (highest severity first, then dependency order per the suggested fix order)

### Test Standards
- **Quantity:** minimum **2 tests per bug** being resolved; features require tests for every acceptance criterion
- **Runner:** Node's built-in test runner (`node:test`) executed via `tsx --test` — no new test framework dependency unless a story explicitly justifies it. (Bootstrap work under `NFR-030` replaces the placeholder `npm test` script with `tsx --test tests/**/*.test.ts`.)
- **Location:** `tests/` directory, mirroring `src/` structure (e.g. `tests/routes/applications.test.ts`); regression tests in `tests/regression/`
- **Naming/tagging:** file named for the work item (e.g. `NFR-004-hires-array.test.ts`); every `describe`/`it` block includes the ID, e.g. `it('NFR-004: accepting an application creates a hire record', ...)`
- **Isolation:** tests must not touch committed `data/store.json` or `data/observability.json`. Each test run uses a temp data directory (override via env var, e.g. `DATA_DIR=$(mktemp -d)`) and seeds its own fixtures
- **Types of tests:**
  - *Unit* — pure logic (matching scores, validators, import parsing)
  - *Route/integration* — boot the Express app on an ephemeral port and assert HTTP status + body (assert the **correct** behavior, not the current broken behavior)
  - *Regression* — encode the bug's `BUGS.md` "Evidence" section as assertions

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
| 1. Install | `npm ci` | Deterministic dependency install |
| 2. Typecheck | `npm run typecheck` | `tsc --noEmit` must be clean |
| 3. Build | `npm run build` | `tsc` emits without error |
| 4. Test | `npm test` | Full suite green (unit + integration + regression) |
| 5. Smoke | boot server, `curl /health` expects 200 | Proves the built artifact actually starts (guards `NFR-001`/`NFR-002` class regressions) |

- **CD:** merges to `main` produce a verified, runnable `dist/` artifact; deployment stories are out of scope until the pipeline bootstrap is complete
- Pipeline status is reported on the PR; a red pipeline is never overridden by hand

### Merge Requirements (Definition of Done)
A work item is done only when **all** are true:
1. **At least two** tests exist for the item, include the work item ID, and were observed failing before the fix
2. Fix completed within the 3-iteration loop cap (or formally escalated)
3. Fix documented: root cause + changes + test evidence in `BUGS.md` annotation and commit/PR body
4. Full pipeline green on the branch (all 5 gates)
5. Merge commit notes the bug/feature ID; `git status` clean; no stray files (`agent-home/`, temp data, `.env`) in the diff
6. Post-merge regression review performed; any new bugs filed in `BUGS.md` with ID, severity, and priority

### Sequencing Constraint (Pipeline Bootstrap)
The pipeline itself cannot work until the app builds, starts, and has a test runner. Therefore the first branches under this skill, in order:
1. `chore/ci-bootstrap` — real `npm test` script + `tests/` skeleton + `.github/workflows/ci.yml` (addresses `NFR-030`)
2. `fix/NFR-001` + `fix/NFR-002` — build/start fixes, proven by the new smoke gate
3. Remaining bugs per the prioritized order in `BUGS.md`

## Files
- `BUGS.md` — Bug registry, source of `NFR-0XX` IDs, resolution annotations, and priority order
- `tests/` — All test suites (unit, integration, regression)
- `.github/workflows/ci.yml` — Pipeline definition
- `package.json` — `test`, `typecheck`, `build` scripts are pipeline entry points

## Roles
- `member-services`: Approves pipeline changes and merge-gate exceptions (none permitted for red pipelines)
- `recruiter`/`hiring-manager`: Acceptance-review feature stories against their domain skill files
- Any contributor: May author branches and PRs following this skill

## Observability
- Every resolved item's `BUGS.md` entry records: ID, branch, PR, date, root cause, fix summary, red→green evidence
- PRs link the red run (before fix) and the green run (after fix) as the audit trail for "tests failed first, then passed"
- Post-merge reviews and any resulting new bug entries are logged with the introducing branch/PR for traceability
- Repeated regression-test failures on `main` trigger a review of the merge gates before new work proceeds
