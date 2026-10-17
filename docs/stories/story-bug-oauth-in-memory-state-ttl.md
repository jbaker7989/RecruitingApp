# Story: In-memory OAuth state fallback does not enforce its TTL at validation

**Status:** Complete — independent QA passed; local only, not deployed (2026-10-16)
**Priority:** Medium
**Tracking ID:** NFR-075
**Created:** 2026-10-07 (NFR-071–074 edge-case review)

## Overview

When Redis is unavailable, OAuth state is stored in an in-memory map with a recorded
creation timestamp and a periodic cleanup job. `validateState` previously checked only
that an entry exists; it did not reject an entry whose timestamp is older than the
ten-minute state TTL. A state could therefore remain valid between expiry and the next
cleanup tick (and potentially longer if cleanup execution is delayed).

## Acceptance Criteria

1. In-memory state validation accepts a matching, unused state before 600 seconds
   and rejects and deletes it at age **>= 600 seconds** (600,000ms), independently
   of the periodic cleanup timer.
2. Deterministic regression tests control time and prove acceptance at 599,999ms
   and rejection/deletion at 600,000ms and 600,001ms without running cleanup.
3. Provider binding and one-time consumption remain enforced, including deletion
   on provider mismatch and on expired-state validation. Redis keeps SETEX/GETDEL
   semantics; an offline contract fake checks the same boundary and replay cases.

## Scope

- `src/services/oauthService.ts`
- OAuth regression tests

## Implementation and validation

- `validateState` consumes the in-memory record, then rejects age >=
  `STATE_TTL_SECONDS * 1000` before provider exchange or applicant/session work.
  Cleanup uses the same inclusive expiry boundary.
- `tests/regression/NFR-075-oauth-state-ttl.test.ts`: **31 passing cases** across
  Google, LinkedIn, and Facebook for memory and mocked Redis SETEX/GETDEL behavior.
  Coverage includes the three millisecond boundaries, success/expired/mismatch
  replay, provider isolation, younger-state isolation, and exact-boundary cleanup.
  Rewinding the clock after rejection proves expired records were deleted.
  Rejected callbacks perform no provider requests or applicant/login-log writes.
- Provider responses and signing keys are local test fixtures; Redis is a contract
  fake, **not a real Redis integration test**. No live provider/service is required.
- Regression sensitivity: restoring the previous validation and cleanup logic
  produces **10 failures / 21 passes**; the implemented behavior passes all 31.
- Node **24.20.0**: typecheck, build, and built-artifact smoke passed; lint passed
  with 0 errors and 124 existing warnings (none in the new test); `npm test`
  passed **221/221** with no skips. Existing CI runs `npm test` and its glob
  includes the new regression file; no workflow change is needed.
- Independent QA by Claude Sonnet 5.5 (configured medium effort) **passed** with
  no blocking findings. The reviewer reproduced 221/221 passing tests and ran
  the new suite nine times successfully, plus mutation checks for the original
  bug and both expiry-boundary comparisons. See the [QA report](../qa/sec-002-claude-qa.md).
- This work does not implement SEC-003, browser binding, or email-linking changes.
  Local commit only; no push, merge, hosted CI run, or deployment was performed.
