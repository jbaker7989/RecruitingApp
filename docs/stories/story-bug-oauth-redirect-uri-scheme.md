# Story: OAuth redirect_uri is derived from req.protocol with no trust-proxy — breaks behind TLS

**Status:** Implemented — pending provider-console registration
**Priority:** Medium
**Tracking ID:** NFR-073
**Created:** 2026-10-07 (OAuth verification)

## Overview

The OAuth `redirect_uri` (and OIDC issuer base) is built from
`${req.protocol}://${req.get('host')}`. The Express app does not set
`trust proxy`, so behind a TLS-terminating proxy or load balancer (the normal
production topology, including Vercel/hosted deployments) `req.protocol` reports
`http` even when the public request was `https`.

The app therefore sends Google/LinkedIn/Facebook an `http://…/callback`
`redirect_uri`, which will **not match** the `https://…/callback` URI registered in
the provider console. Providers reject mismatched redirect URIs, so both the initial
authorization and the token exchange (which must send the identical `redirect_uri`)
fail in production. It works in local `http` dev, which hides the bug until deploy.

## Evidence

- `src/routes/applicants.ts:534,554` (Google), `:566,586` (LinkedIn), `:598,618` (Facebook):
  `const baseUrl = \`${req.protocol}://${req.get('host')}\`;`
- `src/services/oauthService.ts:210,256` etc. build `redirect_uri` from that `baseUrl` and must
  use the **same** value on initiate and token exchange.
- `src/index.ts` has no `app.set('trust proxy', …)`, so `req.protocol` follows the hop from the
  proxy (http) rather than `X-Forwarded-Proto`.

## Current Behavior

- Local dev over `http://localhost` → works.
- Behind an HTTPS proxy → generated `redirect_uri` is `http://…`, provider rejects it
  (`redirect_uri_mismatch`), login fails.

## Desired Behavior

1. The generated `redirect_uri` reflects the real external scheme and host (`https://…` in prod).
2. The same `redirect_uri` is used on initiate and on token exchange.
3. Configuration is explicit and environment-safe (no reliance on an unsanitized `Host` header).

## Acceptance Criteria

1. Behind a proxy that sets `X-Forwarded-Proto: https`, the authorization URL and token-exchange
   request both use an `https://` `redirect_uri` matching the registered value.
2. Local `http` development continues to work unchanged.
3. The host used for `redirect_uri` cannot be spoofed into an attacker-controlled value via the
   `Host`/`X-Forwarded-*` headers (host allow-list or explicit base-URL config).
4. A single source of truth produces the base URL for both initiate and callback.

## Implementation Notes

- Preferred: introduce an explicit `APP_BASE_URL` (or `PUBLIC_ORIGIN`) env var used to build all
  OAuth URLs; fall back to request-derived values only in development.
- If staying request-derived, set `app.set('trust proxy', 1)` (or the correct hop count) in
  `src/index.ts` and read `req.protocol` after that, plus validate `req.get('host')` against an
  allow-list.
- Register the resulting callback URL(s) per environment in each provider console (ties to NFR-072).

## Dependencies

- `src/index.ts` (trust proxy / base-url config)
- `src/routes/applicants.ts`, `src/services/oauthService.ts` (base URL usage)
- NFR-072 (redirect URIs registered per environment)
