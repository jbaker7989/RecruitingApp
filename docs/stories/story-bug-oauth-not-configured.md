# Story: OAuth providers are not configured — every social login returns 503

**Status:** Application implementation complete — external credentials pending
**Priority:** High
**Tracking ID:** NFR-072
**Created:** 2026-10-07 (OAuth verification)

## Overview

No OAuth client credentials are provisioned in any environment. Because every
`initiate*` function throws when its client ID is missing, all three social-login
routes return `503 "… login is not configured"`. Social login is therefore
completely unavailable, independent of the callback-session bug (NFR-071).

This is the configuration/enablement half of making OAuth actually work: even after
NFR-071 is fixed, the flow cannot complete until real credentials exist and each
provider has the correct redirect URI registered.

## Evidence

- Verified at runtime (server started without credentials):
  ```
  GET /api/applicants/auth/google   → HTTP 503 {"error":"Google login is not configured"}
  GET /api/applicants/auth/linkedin → HTTP 503 {"error":"LinkedIn login is not configured"}
  GET /api/applicants/auth/facebook → HTTP 503 {"error":"Facebook login is not configured"}
  ```
- With a dummy `GOOGLE_CLIENT_ID` set, initiate correctly `302`-redirects to Google with
  a well-formed authorization URL and CSRF `state` — confirming only credentials are missing,
  not the initiate logic.
- Guards: `src/services/oauthService.ts:207-208` (`GOOGLE_CLIENT_ID`), `:220-221` (LinkedIn),
  `:233-234` (Facebook). Secrets checked in the callbacks at `:254`, `:284`, `:328`.
- `.env.local` contains **none** of `GOOGLE_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`,
  `FACEBOOK_CLIENT_ID/SECRET`. `.env.example` lists them as placeholders only.

## Current Behavior

- Clicking any social-login button yields a 503 (currently a JSON error page; after NFR-071
  it should render a friendly "social login unavailable" message).

## Desired Behavior

1. Each enabled provider has a real client ID + secret supplied via environment / secrets
   manager (never committed).
2. Each provider's developer console registers the exact redirect URI per environment, e.g.
   `https://<host>/api/applicants/auth/google/callback` (and linkedin/facebook).
3. A provider with no credentials is **hidden or disabled** on the login UI rather than
   presented as a working option that 503s.
4. Documented setup steps so any environment can enable OAuth reproducibly.

## Acceptance Criteria

1. With valid Google credentials configured, a real end-to-end Google login succeeds
   (provider consent → callback → session per NFR-071).
2. Same verified for LinkedIn and Facebook (for whichever providers are in launch scope).
3. Redirect URIs are registered and match the app's generated `redirect_uri` exactly
   (see NFR-073 for the scheme/host correctness behind a proxy).
4. The login page only shows provider buttons for providers that are actually configured.
5. No client secret appears in source, logs, or client-side code.
6. `.env.example` and a short README/runbook section document the required variables and
   the redirect URIs to register.

## Implementation Notes

- Decide the launch provider set (Google is the common minimum; LinkedIn is natural for a
  recruiting product; Facebook optional).
- Add a small "is this provider configured?" check usable by the login view to conditionally
  render buttons.
- Keep credentials in the deployment's secrets store; for local dev use `.env.local` (git-ignored).
- This is a prerequisite to fully validating NFR-071, NFR-073, and NFR-074 against live providers.

## Dependencies

- Provider developer consoles: Google Cloud, LinkedIn Developers, Meta for Developers
- Secrets management per environment
- `.env.example`, `README.md` (setup docs), `views/dashboard/login.ejs` + `register.ejs`
  (conditional button rendering)
- Related: NFR-071 (session), NFR-073 (redirect URI scheme)
