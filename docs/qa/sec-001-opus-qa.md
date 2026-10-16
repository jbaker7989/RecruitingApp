# SEC-001 / NFR-076 — Independent QA Report

- **Reviewer model / effort:** Claude Opus 4.8, medium (independent review sub-agent)
- **Date:** 2026-10-15
- **Branch:** `docs/sec-oauth-hardening`
- **Verdict:** ✅ **PASS**
- **Scope:** SEC-001 OAuth ID-token verification + CI/regression coverage only. Reviewed the uncommitted diff in `src/services/oauthService.ts`, `tests/helpers/oauthTokens.ts`, `tests/regression/NFR-053-applicant-oauth-social-login.test.ts`, `tests/regression/NFR-071-074-oauth-dashboard-flow.test.ts`, `tests/regression/NFR-076-oauth-idtoken-verification.test.ts`, and the feature/story docs. No production/test code was modified; no commit, push, or deploy performed. Pre-existing changes in `data/*.json` and untracked demo/seed scripts were left untouched.

## Validation results (independent re-run, Node v24.20.0)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS (exit 0) |
| `npm run build` | PASS |
| `npm run lint` | PASS — 0 errors, 124 warnings (matches Astra) |
| `npm test` | PASS — **190 passing, 0 failing**, 12 suites |
| NFR-076 suite alone | **38 tests, 38 pass** (confirms "38 new security cases") |
| `npm run smoke` | PASS (`smoke-health=ok`) |

All of Astra's reported results reproduced exactly. CI (`.github/workflows/ci.yml`) runs typecheck → lint → build → test → smoke on push/PR, and the new NFR-076 test is picked up by the `tests/**/*.test.ts` glob, so the security coverage is wired into CI.

## Security assessment — in scope

Verified against the SEC-001 brief; all requirements met:

- **Signature verification via cached remote JWKS** — `verifyIdToken` builds `createRemoteJWKSet` per provider `jwksURL`, cached in a module-level `Map` so keys are reused across callbacks and rotation is handled by jose. JWKS URLs come only from static provider config, never token headers/requests. Test confirms second login reuses cached JWKS (no additional fetch).
- **RS256 enforced** (`algorithms: ['RS256']`) — `alg:none` and unknown-`kid` tokens rejected (tested).
- **Mandatory claims** `iss/aud/sub/exp/iat` via `requiredClaims`, plus manual checks: non-empty string `sub`, finite numeric `iat`/`exp`, `exp > iat`, and future-`iat` rejected beyond 30s tolerance. All exercised by the invalid-claims matrix.
- **Issuer/audience** validated by jose; multi-audience tokens additionally require `azp === clientId`, and any present `azp` must equal `clientId` (tested, including the accept case for matching `azp` with multi-`aud`).
- **Clock tolerance 30s** applied consistently to exp and future-iat (tested with +10s skew accepted).
- **Fail-closed when JWKS unavailable** — 503 from JWKS → generic rejection, no mutation (tested for Google and LinkedIn).
- **Facebook** — Graph profile call authenticated with `appsecret_proof` (HMAC-SHA256 of access token with app secret) and `Bearer` token; non-empty `id` required; denied proof/token and missing subject rejected with no mutation (tested).
- **LinkedIn UserInfo** — subject cross-checked against the verified ID token; on mismatch or fetch failure it falls back to the verified ID-token names rather than trusting UserInfo (tested).
- **Generic verification errors** — identity failures surface only `OAuth identity verification failed`; no provider/JWKS/token diagnostics leaked on the verification path.
- **No account mutation / session issuance before verification** — `assertRejected` asserts byte-identical `store.json` and `observability.json` and absence of any `set-cookie` on every rejection path.
- **Browser + JSON flows preserved** — 302 + session cookie for browser, 200 + token JSON for `Accept: application/json`, 401/redirect-with-error on failure. NFR-053/071-074 regressions updated to use real signed fixtures and still pass.
- **Offline signed fixtures** — `tests/helpers/oauthTokens.ts` generates a process-local RS256 keypair and serves a matching JWKS, enabling real signature verification with no network or provider credentials. LinkedIn issuer handling (`https://www.linkedin.com` + `https://www.linkedin.com/oauth`) and Google variant (`accounts.google.com`) are both covered.

## Findings

No blocking findings.

### LOW (non-blocking, out of strict scope) — token-exchange error reflection
`oauthService.ts:179` and `:420` throw `Token exchange failed: ${status} ${body}` with the raw provider response body, and the route handler (`applicants.ts:571/602/633`) reflects `err.message` to the client. A failed OAuth **code exchange** (not ID-token verification) can therefore echo the provider's error body to the caller. This is **pre-existing** code unchanged by this diff and sits on the token-transport path rather than the ID-token verification path the brief scoped to generic errors. The actual verification failures are correctly generic. Recommend (follow-up, not required for SEC-001 sign-off) genericizing these two messages to match the "do not reflect provider responses" posture.

## Known excluded risks (explicitly out of scope, separately tracked)

- **SEC-002** in-memory OAuth state TTL enforcement — not implemented here.
- **SEC-003** XSS guardrails — not implemented here.
- Browser-bound state (state is provider-scoped but not bound to the browser/session; in-memory expiry enforcement remains SEC-002) — tracked separately.
- **Email-based account linking redesign** — `upsertOAuthApplicant` still links accounts by email and does not consult `email_verified`; a provider that returns an unverified email could link to an existing account. This is the separately-tracked account-linking risk, not a SEC-001 regression.

## Conclusion

SEC-001 / NFR-076 is correctly and robustly implemented with strong, offline, CI-integrated regression coverage. All Astra validation results independently reproduced. **PASS** — no changes requested within scope.
