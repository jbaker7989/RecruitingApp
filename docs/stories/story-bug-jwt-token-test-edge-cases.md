# Story: JWT Token Test Edge Cases (Bug/Gap List)

**Status:** Open
**Priority:** High (items 1-3 are security-relevant; rest are coverage gaps)
**Created:** 2026-09-24 (test review of `tests/regression/NFR-050-jwt-token-production-patterns.test.ts`)

## Overview

`NFR-050-jwt-token-production-patterns.test.ts` verifies JWT issuance,
claims, and basic signature/migration handling, but a review found several
gaps — including two tests that don't actually test what their names claim.
Each is listed as its own bug below so they can be triaged/fixed
independently.

## Bugs / Gaps

### 1. "Rejects an expired JWT" test doesn't test expiry
The test's own comment admits it substitutes "reject a non-JWT string" for
"reject an expired JWT" because forging an expired token seemed hard. A
validly-signed-but-expired token is never exercised, so real expiry
enforcement in the auth middleware is unverified.

**Acceptance Criteria**
- Forge a token with `exp` in the past using the test's own `JWT_SECRET`
  (the test already sets `process.env.JWT_SECRET`, so it can sign with the
  same library/secret the app uses), and assert the protected endpoint
  returns `401`.
- Remove the misleading test name/comment once real expiry is covered.

### 2. "Rejects a token with invalid signature" test doesn't test tampering
The test computes a `tampered` token (real header + real payload + garbage
signature) into a variable, comments `void tampered; // used below`, then
never uses it — the actual assertion runs against a hardcoded, unrelated
JWT string with a different payload entirely. The real "same
header/payload, corrupted signature" scenario is untested, and there's dead
code (`tampered`, the `void` line) left in the test.

**Acceptance Criteria**
- Replace the hardcoded token in the assertion with the `tampered` value
  actually derived from a real, valid token.
- Remove the now-unnecessary `void tampered;` line.

### 3. No "alg: none" / algorithm-confusion test
A classic JWT vulnerability class: a token with header `{"alg":"none"}` and
no signature. If the verification library or its config doesn't explicitly
reject `none`, an attacker could mint arbitrary claims. This is untested.

**Acceptance Criteria**
- Add a test that crafts an `alg: none` token (base64url header + payload,
  empty signature segment) and asserts the protected endpoint returns
  `401`.
- If it doesn't currently reject it, fix the JWT verification config
  (explicit `algorithms: ['HS256']` allowlist or equivalent) to disallow
  `none`.

### 4. No malformed-`Authorization`-header tests
Missing header entirely, header without the `Bearer ` prefix, and an
empty-string token aren't tested against a protected route.

**Acceptance Criteria**
- Add tests for: no `Authorization` header, `Authorization: <token>` (no
  `Bearer` prefix), and `Authorization: Bearer ` (empty token). Assert
  `401` in each case.

### 5. No test for a token signed with a different valid secret
The existing signature test uses a garbage/non-base64url signature string.
There's no test for a token that is structurally valid and signed correctly
— just with the wrong secret — which is a stronger and more realistic
signature-verification check.

**Acceptance Criteria**
- Sign a token with the same header/payload shape as a real token but a
  different secret, and assert the protected endpoint returns `401`.

### 6. Migration (dual-acceptance) tests only cover the happy path
The opaque-token migration tests only check a freshly-registered
recruiter's and applicant's own id. Not covered: an opaque token for a
deleted/nonexistent user or applicant, or opaque-token migration for other
roles (hiring-manager, member-services).

**Acceptance Criteria**
- Add a test: an opaque token that doesn't match any existing user/applicant
  id returns `401`.
- Add at least one migration test for a non-recruiter role.
