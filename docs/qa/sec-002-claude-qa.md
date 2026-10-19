# SEC-002 / NFR-075 — Independent QA (Claude)

- **Reviewer:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), review sub-agent; medium effort (explicitly configured by the parent delegation)
- **Date:** 2026-10-16 | **Branch:** `fix/sec-002-oauth-state-ttl` (uncommitted) | **Node:** 24.20.0
- **Implementation under review:** GPT-6.1-Sol (medium)
- **Scope:** SEC-002/NFR-075 only. SEC-003, browser-bound state, and email account linking excluded.

## Verdict: **PASS**

No blocking or non-blocking correctness/security findings. Local commit is acceptable.

## Checks run (independently)
| Check | Result |
|---|---|
| New suite, 9 consecutive runs | 31/31 pass each run, no flakiness |
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 124 warnings (matches baseline claim) |
| `npm test` (CI glob `tests/**/*.test.ts`) | 221/221, 0 skipped |
| Mutation: original `HEAD` oauthService.ts | 10 fail / 21 pass (matches developer claim) |
| Mutation: validation `>=` -> `>` | 6 fail |
| Mutation: cleanup `<=` -> `<` | 1 fail (exact-boundary cleanup test) |
| Production file restored after mutations | verified identical to the reviewed version |

I did not rerun build/smoke; relied on developer evidence for those.

## Review
- **Production diff** (`src/services/oauthService.ts:64-68, 80-84`): the in-memory entry is deleted *before* the age check, so expired and provider-mismatched states are consumed (one-time use preserved). Age `>= 600000` ms rejected, matching the Redis TTL expiry semantics; cleanup now inclusive (`<=`) so the two paths agree. Provider binding unchanged. Callers return null -> existing CSRF error before any provider call. Minimal and correct.
- **Tests** (`tests/regression/NFR-075-oauth-state-ttl.test.ts`): exercise public callbacks for all three providers; boundary ages 599999/600000/600001; clock rewind after rejection proves deletion rather than timestamp rejection; asserts no provider fetches and no store/observability writes on rejection; provider mismatch consumes state and leaves other providers' states intact; younger state survives; cleanup timer captured (never auto-ticked) so rejection is proven independent of cleanup. `Date.now` mocked and restored; env/fetch/temp dir restored in `after`; module instances isolated via query-string import per backend.
- **Redis parity** is a mocked ioredis SETEX/GETDEL contract fake (asserts 600s TTL, key format, atomic delete-on-get, expiry at `clock >= expiresAt`). It checks the app's use of the contract, not Redis itself.
- **Docs/BUGS.md:** accurate and appropriately labelled "implemented; QA pending"; the status wording should be updated to QA-passed on commit (see note).

## Findings
| Sev | Location | Note |
|---|---|---|
| Info | tests `redis-contract` `before` | The test relies on `initRedis()` (un-awaited, async dynamic import + mocked connect) finishing before the first `initiate`; the `redisWrites` assertion would fail loudly if not. Stable in 9/9 runs; theoretical timing sensitivity only. Not blocking. |
| Info | docs/BUGS.md | Statuses still say "QA pending"; update to reflect QA PASS in the commit. Not blocking. |

## Limits
No real Redis, live OAuth provider, hosted CI run, or production testing. Redis behavior is contract-mocked. Build/smoke not rerun by this reviewer. No production/test files were modified by this review (temporary mutations were reverted and verified); nothing committed.

## Commit preparation

The parent updated the story, feature, and BUGS.md to QA-passed status after this
review. No production or test changes were made after the reviewed implementation.
