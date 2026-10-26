# NFR-SLOP-S09: Remove Unused Test Code and Verify the Assertions Behind It

**Status:** Proposed
**Priority:** Medium (P2) — unused test helpers are evidence of tests that may not assert what their names claim
**Size:** M (3–6h) — 33 warnings in 22 test files; each needs a read-through, not a blind delete
**Tracks:** NFR-027
**Parent:** [Code hygiene remediation](README.md)

## Problem

The ESLint run reports **33 unused-variable warnings in `tests/`**. In production code an unused variable is clutter. In a test it can mean the test **never checks the thing it was written to check**: a helper such as `hasBcryptHeader()` is defined to assert a hash format, then never called. The suite stays green and the assurance the file name promises is absent. That matters here because several of these files are the regression evidence cited for security stories.

## Findings

### A. Helpers defined but never called — possible missing assertions (review first)

| File:line | Unused | Concern |
|---|---|---|
| `tests/regression/story-commercial-auth-hardening.test.ts:85,90` | `hasBcryptHeader`, `isSha256Hex` | The suite is the evidence for password-hash hardening. No test asserts the stored hash is bcrypt-shaped. `passwordHash is not sha256 of password after register` (line ~113) only tests that logging in with the SHA-256 string fails — a behavioral proxy; the stored value is never inspected. Either add the direct store assertion or rename the test to what it proves. |
| same file `:124`, `:428` | `body`, `userId` | Registration/ login response is captured and never asserted. Likely missing id/ownership checks. |
| `tests/regression/story-dashboard-login-phone-optional.test.ts:110` | `hasRequiredAsterisk` | The phone-optional story should assert the phone label has **no** required indicator and required fields do. Only one half is checked if the helper is unused. |
| `tests/regression/NFR-050-jwt-token-edge-cases.test.ts:28` | `encoder` | A crafted-token helper left over; verify no token-tampering case was dropped. |
| `tests/regression/NFR-050-jwt-token-production-patterns.test.ts:243` | `reg` | `Migration — old opaque Applicant tokens are REJECTED` registers an applicant and never uses the result; confirm the rejection assertion targets a token for that applicant. |
| `tests/regression/NFR-048-duplicate-application-prevention.test.ts:87` | `get` | A GET helper unused: confirm duplicate prevention is checked via read-back, not only the POST status. |
| `tests/regression/NFR-053-applicant-oauth-social-login.test.ts:21,27` | `beforeEach`, `randomBytes` | Suspect missing per-test state reset (state leaking between OAuth tests) and unused state-token generation. |

### B. Unused imports (safe, mechanical)

- `Server` (type) unused in 12 regression files; `ChildProcess` / `ChildProcessWithoutNullStreams` in NFR-001/002; `JWTPayload` in NFR-076; `LogRecord` in `tests/telemetry-operations.test.ts`.
- `TestTelemetry` imported but unused in **six** observability P2 test files: `observability-p2-ai-invocation`, `-ai`, `-matching`, `-pinecone`, `-store-workflow`, `-unsampled`, and `UsageRecord` in `-cost`. Those files are owned by the Observability P2 workstream; make the change there with that owner's review so the evidence ledger (`docs/features/observability/p2-test-coverage.md`) is not invalidated.

### C. Structural duplication in tests

Around a dozen regression files copy the same server boot / `post()` / `get()` helpers. A shared test harness (`tests/helpers/`) would remove hundreds of repeated lines and make fixes like the unique-schema isolation done for NFR-DATA-002 reusable. Optional in this story; do it only after A and B.

## Acceptance criteria

- [ ] **S09-AC1:** Every item in table A has a written verdict: *assertion missing → added*, *assertion exists elsewhere → helper deleted (cite test name)*, or *test mislabeled → renamed*. No helper is deleted before its verdict is recorded.
- [ ] **S09-AC2:** For each *assertion missing* case, a mutation check shows the new assertion fails when the guarded behavior is broken (revert the guarded line locally, observe red, restore). No test passes for the wrong reason.
- [ ] **S09-AC3:** Table B imports are removed; `eslint tests --rule` reports zero `no-unused-vars` under `tests/`.
- [ ] **S09-AC4:** Test counts before/after are reported. Any decrease is explained (duplicate removed) and no assertion count falls without an explicit reason.
- [ ] **S09-AC5:** No weakened assertions, no new `skip`/`only`/`todo`.
- [ ] **S09-AC6:** JSON suite and the PostgreSQL suite pass at baseline totals plus any added tests.

## Implementation tasks

1. Triage table A by reading each test (the verdict list is the main deliverable).
2. Add missing assertions with mutation checks.
3. Remove table B imports; coordinate P2-file edits with the observability owner.
4. (Optional) extract the shared harness.

## Boundaries

Test-only changes plus fixing mislabeled tests; production code changes found along the way become separate bugs. Do not rewrite evidence the QA ledger relies on without updating the ledger.
