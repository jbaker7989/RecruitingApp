# SEC-OAUTH-001: OAuth Security Hardening

**Status:** Partially complete (SEC-001 QA passed) | **Story:** REC-TBD | **Type:** Security Hardening
**Created:** 2026-10-15 | **Source:** Security review of `bugs/oauth-login-fixes` (NFR-071–075)

Close the security gaps surfaced by the review of the applicant social-login
flow. The reviewed PR (`fix: complete applicant OAuth dashboard flow`) was itself
net-positive for security — it added state→provider binding, an explicit
`APP_BASE_URL` to stop `Host`-header spoofing of `redirect_uri`, a `Secure`
session cookie in production, an open-redirect-safe `next` validator, and
HTML-escaped error rendering. **No finding in the review was a confirmed,
trivially remote-exploitable vulnerability.** The items below are the residual
hardening and spec-compliance gaps worth tracking, prioritized.

## Review outcome recap

| Review candidate | Verdict | Carried forward as |
|---|---|---|
| Reflected XSS via `?error=` | Not exploitable — `<%= error %>` auto-escapes (login.ejs:242, register.ejs:252) | SEC-003 (regression guardrail only) |
| Open redirect via `next` | Not exploitable — `safeApplicantDestination` enforces local `/dashboard` paths | SEC-003 (regression guardrail only) |
| `Host`-header injection in `redirect_uri` | Fixed by this PR (`resolveOAuthBaseUrl`) | — |
| Cross-provider state replay | Fixed by this PR (`validateState(state, provider)`) | — |
| In-memory state TTL not enforced (NFR-075) | Below exploit threshold; real correctness gap | **SEC-002** |
| `id_token` claims used without signature verification | Out of PR scope; genuine spec/defense-in-depth gap | **SEC-001** |

## Prioritized stories

| Order | ID | Severity | Story | Size | Status |
|---|---|---|---|---|---|
| P1 | SEC-001 (NFR-076) | 🟠 High | Verify OAuth `id_token` signature + claims instead of unverified decode | **M** | Complete; QA passed — [story](../../stories/story-sec-oauth-idtoken-verification.md) |
| P2 | SEC-002 (NFR-075) | 🟡 Medium | Enforce in-memory OAuth state TTL at validation (parity with Redis) | **S** | Open — [story](../../stories/story-bug-oauth-in-memory-state-ttl.md) |
| P3 | SEC-003 (NFR-077) | 🔵 Low | Lock in XSS-safe error rendering + open-redirect `next` validation with regression tests | **S** | Proposed — [story](../../stories/story-sec-xss-open-redirect-regression-guardrails.md) |

**Why this order:** SEC-001 is the only item touching an authentication trust
boundary (account linking derives identity from `id_token` claims), so it leads
despite not being trivially exploitable today. SEC-002 is a concrete correctness
gap in a security control (CSRF state) that is quick to close. SEC-003 is a
guardrail that converts the review's "verified safe today" conclusion into a
durable invariant; lowest risk, so last.

**Current delivery scope:** SEC-001 and its CI regression coverage only. SEC-002
and SEC-003 remain open/proposed. No merge or production deployment is authorized.
See the SEC-001 story for exact issuer, claim-validation, and QA requirements.

**Total feature size:** ~M + S + S ≈ 1 working day.

---

## P1 — SEC-001 (NFR-076): Verify OAuth `id_token` signature + claims

- **Severity:** 🟠 High (identity trust boundary; spec-compliance / defense-in-depth)
- **Size:** **M** (3–6h) — JWKS verification wired per provider + claim checks + tests
- **Where:** `src/services/oauthService.ts:183` (`decodeJwtPayload`), used at `:293` (Google), `:325` (LinkedIn); Facebook profile path at `:368`.

**Finding.** `decodeJwtPayload` base64url-decodes the JWT payload *without
verifying the RS256 signature*, and the resulting `email` / `sub` claims are used
to upsert and link the applicant account and to mint the app session JWT. No
`iss`, `aud`, or `exp` validation is performed.

**Exploitability / why High not Critical.** The `id_token` is obtained over the
server-to-provider TLS back-channel (`exchangeCodeForTokens` POSTs to the
hardcoded HTTPS `config.tokenURL`), so an attacker cannot trivially substitute a
forged token without breaking that TLS channel or the token-endpoint URL. It is
therefore a hardening / OIDC-compliance gap rather than a confirmed remote
exploit — but identity is derived from unverified claims, which is exactly the
application hardening control. OIDC Core §3.1.3.7 permits TLS server validation
in place of signature checking for direct token-endpoint responses; the missing
claim validation remains a compliance gap.

**Acceptance criteria.**
1. Google and LinkedIn `id_token`s are verified against the provider JWKS
   (`jose` `createRemoteJWKSet` + `jwtVerify`, with key-set caching).
2. `iss` matches the provider issuer, `aud` matches the configured client ID,
   and `exp`/`iat` are enforced (with small clock skew).
3. Facebook (no `id_token`) verifies the access token server-side before trusting
   profile claims (e.g. `appsecret_proof` on the Graph call, or the token-debug
   endpoint), not just a bearer fetch.
4. A verification failure rejects the callback with the existing CSRF-style error
   path (no session cookie, redirect to `/dashboard/login?error=...`).
5. Regression tests cover: valid token succeeds; wrong `aud` rejected; expired
   token rejected; bad signature rejected. The existing fake-signature test in
   `tests/regression/NFR-071-074-oauth-dashboard-flow.test.ts` is updated to mint
   a properly signed token (local test keypair) instead of `"signature"`.

**Notes / dependencies.** `jose` is already a dependency. Expect to add a tiny
per-provider JWKS URL config and a verification helper replacing `decodeJwtPayload`
for the trusted-claims path.

---

## P2 — SEC-002 (NFR-075): Enforce in-memory OAuth state TTL at validation

- **Severity:** 🟡 Medium
- **Size:** **S** (1–3h)
- **Where:** `src/services/oauthService.ts` — in-memory branch of `validateState`.
- **Story:** [story-bug-oauth-in-memory-state-ttl.md](../../stories/story-bug-oauth-in-memory-state-ttl.md) (already exists, status Open).

**Finding.** When Redis is unavailable, `validateState` accepts an in-memory state
entry on existence + provider match but does not reject entries older than
`STATE_TTL_SECONDS` (600s); expired states stay valid until the periodic cleanup
tick. Redis already enforces TTL via `setex`, so the two backends are not
equivalent. Below the exploit threshold (state is unguessable and single-use) but
a real parity/correctness gap in a security control.

**Acceptance criteria** (carried from existing story):
1. In-memory validation rejects and deletes records older than 600s.
2. A time-controlled regression test proves an expired state is rejected before
   the cleanup interval runs.
3. Redis and in-memory semantics are equivalent for expiry, provider binding, and
   one-time consumption.

---

## P3 — SEC-003 (NFR-077): Regression guardrails for login/callback surface

- **Severity:** 🔵 Low (defense-in-depth; prevents regression of a currently-safe control)
- **Size:** **S** (1–3h)
- **Where:** `views/dashboard/login.ejs:242`, `register.ejs:252` (error rendering);
  `src/services/applicantSession.ts:safeApplicantDestination` (redirect validation).
- **Story:** [story-sec-xss-open-redirect-regression-guardrails.md](../../stories/story-sec-xss-open-redirect-regression-guardrails.md)

**Finding.** The review confirmed the reflected `error`/`next` params are safe
*today* because the templates use escaping interpolation (`<%= %>`) and
`safeApplicantDestination` constrains `next` to local `/dashboard` paths. There is
no test locking this in, so a future change to `<%- %>` or a loosened validator
would silently reintroduce reflected XSS / open redirect.

**Acceptance criteria.**
1. A test asserts a crafted `?error=<img src=x onerror=...>` renders escaped (no
   raw `<img` / `<script` in the response body) on both `/dashboard/login` and
   `/dashboard/register`.
2. A unit test table covers `safeApplicantDestination` rejections:
   `https://evil`, `//evil`, `/\evil`, `/api/applicants`, non-string — each →
   `/dashboard/applications`; and acceptances: `/dashboard`, `/dashboard/jobs?x=1`.
3. Tests live alongside existing OAuth regression tests and run in CI.

---

## Out of scope for this feature

- Full OIDC `nonce` binding (initiate→callback) — worth a follow-up but not raised
  by this review.
- CSRF tokens on dashboard state-changing POSTs — not surfaced by the review
  (`SameSite=Lax` session cookie is in place); track separately if desired.

## Dependencies

- `src/services/oauthService.ts`, `src/services/applicantSession.ts`
- `views/dashboard/login.ejs`, `views/dashboard/register.ejs`
- `tests/regression/NFR-071-074-oauth-dashboard-flow.test.ts`
- `jose` (already installed) for JWKS verification
