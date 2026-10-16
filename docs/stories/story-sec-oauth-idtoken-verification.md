# SEC-001 / NFR-076: Verify provider identity before issuing applicant sessions

**Status:** Complete — independent QA passed; not deployed
**Priority:** High
**Tracking ID:** NFR-076
**Feature:** [SEC-OAUTH-001 OAuth Security Hardening](../features/security/feature-oauth-security-hardening.md) (P1)
**Created:** 2026-10-15

## Scope

Google and LinkedIn callbacks previously decoded ID tokens without checking their
signatures or identity claims. This story requires verification before applicant
creation/linking or session issuance, plus authenticated Facebook profile requests.
Existing email-based account linking and browser/state binding are separate work;
SEC-002 and SEC-003 are not included in this implementation.

## Security rationale

Tokens arrive directly from configured provider token endpoints over TLS. OIDC
Core §3.1.3.7 permits TLS server validation in place of signature checking in this
flow; signature verification is an explicit application hardening requirement.
Issuer, audience, expiration, and subject checks remain necessary. This is not a
claim of a demonstrated remotely exploitable signature-substitution attack.

## Acceptance criteria and implementation

1. Google and LinkedIn ID tokens use `jose` `createRemoteJWKSet` and `jwtVerify`.
   Only RS256 is accepted. A process-wide resolver per fixed JWKS URL retains
   jose's key cache/rotation behavior; network retrieval times out after 5 seconds.
   Token-supplied key URLs are never used, and verification failures never fall
   back to decoding claims.
2. Require `iss`, `aud`, `sub`, `exp`, and `iat`. Audience must include the configured
   client ID; subject must be a nonempty string; timestamps must be finite numbers;
   expiration must follow issuance. Enforce expiration and reject issuance more
   than 30 seconds in the future, with 30 seconds of clock tolerance. If `azp` is
   present it must match the client; multiple audiences require matching `azp`.
3. Use explicitly trusted provider values:
   - Google issuers: `https://accounts.google.com`, `accounts.google.com`;
     JWKS: `https://www.googleapis.com/oauth2/v3/certs`.
   - LinkedIn issuers: `https://www.linkedin.com` (integration guide) and
     `https://www.linkedin.com/oauth` (live discovery);
     JWKS: `https://www.linkedin.com/oauth/openid/jwks`.
   - LinkedIn optional UserInfo claims are used only if `sub` matches the verified
     ID token; otherwise retain the signed name claims.
4. Facebook Graph profile requests include `appsecret_proof`, the HMAC-SHA256 of
   the access token keyed with the app secret. A failed Graph response or missing
   profile subject rejects authentication before account mutation.
5. Verification failures issue no session cookie, create/update no applicant, and
   record no successful login. Browsers return to the login error page; JSON
   clients receive HTTP 401. The error is generic and contains no provider/token
   diagnostics.
6. Valid callbacks preserve seven-day sessions, the state-bound destination, and
   the existing JSON response. Existing NFR-053 and NFR-071–074 tests use local
   signed-token fixtures and mocked fixed provider JWKS endpoints.

## CI/CD testing and QA

`tests/regression/NFR-076-oauth-idtoken-verification.test.ts` covers both OIDC
providers: valid signatures, issuer variants, cached JWKS, unavailable JWKS, wrong
issuer/audience/signature, absent claims, invalid subject, unknown key, unsigned
tokens, expiration, future issuance, clock skew, authorized party, and rejection
without account/session side effects. It also covers LinkedIn subject matching
and Facebook proof generation and failure handling.

All provider calls are mocked; tests require no OAuth credentials or live provider
availability. Existing `.github/workflows/ci.yml` runs these tests through
`npm test`, alongside typecheck, lint, build, and built-artifact smoke checks.
No deployment or merge is authorized for this work. Independent QA by Claude
Opus 4.8 at medium effort passed with no blocking findings. On Node v24.20.0,
typecheck, build, lint (0 errors, 124 warnings), all 190 tests (including 38 NFR-076
cases), and the built-artifact smoke check passed in both development and QA.
See the [QA report](../qa/sec-001-opus-qa.md) for evidence and the non-blocking
follow-up. Hosted CI and live-provider testing were not run; no push or deployment
was performed.

## References

- [OIDC ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)
- [Google ID token validation](https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken)
- [Google discovery](https://accounts.google.com/.well-known/openid-configuration)
- [LinkedIn integration guide](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
- [LinkedIn discovery](https://www.linkedin.com/oauth/.well-known/openid-configuration)
- [Meta secure requests](https://developers.facebook.com/docs/graph-api/securing-requests/)
