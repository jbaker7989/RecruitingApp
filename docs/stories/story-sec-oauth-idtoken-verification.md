# Story: OAuth `id_token` claims are trusted without signature or claim verification

**Status:** Proposed
**Priority:** High
**Tracking ID:** NFR-076
**Feature:** [SEC-OAUTH-001 OAuth Security Hardening](../features/security/feature-oauth-security-hardening.md) (P1)
**Size:** M (3–6h)
**Created:** 2026-10-15 (security review of `bugs/oauth-login-fixes`)

## Overview

The OAuth callbacks extract identity claims from the provider `id_token` using
`decodeJwtPayload`, which base64url-decodes the JWT payload **without verifying
the signature** and without checking `iss`, `aud`, or `exp`. Those claims
(`email`, `sub`, `given_name`/`family_name`) are then used to upsert/link the
applicant account and to issue the application session JWT.

This is the OIDC control that establishes *who the user is*. Decoding without
verification means the server trusts the token's contents rather than proving the
token was issued by the provider for this application.

## Evidence

- `src/services/oauthService.ts:183-189` — `decodeJwtPayload` comment literally
  states "Decode a base64url JWT payload without verification (for extracting
  claims only)".
- Used for trusted identity claims:
  - `:293` Google — `const claims = decodeJwtPayload(idToken);`
  - `:325` LinkedIn — `const idClaims = decodeJwtPayload(idToken);`
  - `:368` Facebook — profile fetched via access-token bearer call with no
    server-side token validation (`appsecret_proof` / token debug).
- Claims flow into account linking: `upsertOAuthApplicant` matches/creates by
  `email` and records `providerId` from `sub`.
- The regression test `tests/regression/NFR-071-074-oauth-dashboard-flow.test.ts`
  mints an `id_token` ending in the literal string `signature` and the callback
  still succeeds — demonstrating signatures are not checked.

## Exploitability assessment

The `id_token` is obtained over the server-to-provider TLS back-channel
(`exchangeCodeForTokens` POSTs to the hardcoded HTTPS `config.tokenURL`), so a
forged token cannot be trivially injected without compromising that TLS channel
or the token-endpoint configuration. This keeps it **High (hardening /
spec-compliance)** rather than a confirmed remote-exploitable Critical — but it
is a trust boundary and should be verified per the OIDC spec regardless.

## Desired Behavior

1. Verify provider `id_token`s against the provider JWKS before trusting any claim.
2. Enforce `iss` (provider issuer), `aud` (configured client ID), and `exp`/`iat`
   (with small clock skew).
3. For Facebook (no `id_token`), validate the access token server-side before
   trusting profile claims.
4. On any verification failure, reject via the existing error path (no cookie,
   redirect to `/dashboard/login?error=...`).

## Acceptance Criteria

1. Google and LinkedIn `id_token`s are verified with `jose`
   (`createRemoteJWKSet` + `jwtVerify`) with key-set caching; unverified decode is
   no longer on the trusted-claims path.
2. `iss`, `aud`, and `exp`/`iat` are validated; a wrong-`aud`, expired, or
   bad-signature token is rejected.
3. Facebook verifies the access token server-side (`appsecret_proof` on the Graph
   call, or the debug_token endpoint) before using profile fields.
4. Regression tests cover: valid signed token succeeds; wrong `aud` rejected;
   expired token rejected; bad signature rejected. The existing fake-signature
   test is updated to sign with a local test keypair.
5. No regression to the NFR-071–074 browser callback flow (cookie + redirect).

## Implementation Notes

- `jose` is already a dependency; add per-provider issuer + JWKS URL to each
  `*Config` and a `verifyIdToken(config, token)` helper to replace
  `decodeJwtPayload` on the trusted path. Keep `decodeJwtPayload` only if still
  needed for non-security display fields.
- Cache the remote JWKS (`createRemoteJWKSet` does this) to avoid a fetch per login.

## Dependencies

- `src/services/oauthService.ts` (verification helper, provider config, callbacks)
- `tests/regression/NFR-071-074-oauth-dashboard-flow.test.ts` (signed-token fixtures)
- Related: NFR-074 (state→provider binding), NFR-075 (state TTL)
