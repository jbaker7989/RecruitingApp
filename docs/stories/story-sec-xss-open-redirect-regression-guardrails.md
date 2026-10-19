# Story: Regression guardrails for reflected-error XSS and open-redirect `next`

**Status:** Proposed
**Priority:** Low (defense-in-depth)
**Tracking ID:** NFR-077
**Feature:** [SEC-OAUTH-001 OAuth Security Hardening](../features/security/feature-oauth-security-hardening.md) (P3)
**Size:** S (1–3h)
**Created:** 2026-10-15 (security review of `bugs/oauth-login-fixes`)

## Overview

The security review confirmed two reflected-input surfaces are **safe today** but
are not protected by any test, so a future change could silently reintroduce a
vulnerability:

1. **Reflected `?error=` into the login/register templates.** The OAuth failure
   path redirects to `/dashboard/login?error=<message>` and the GET handler passes
   `req.query.error` into the `error` template variable. It is safe only because
   the templates render it with escaping interpolation `<%= error %>`. Switching
   to unescaped `<%- error %>` would create reflected XSS.

2. **`next` redirect target.** `safeApplicantDestination` constrains `next` to
   local `/dashboard` paths (rejecting `https://`, `//`, backslash tricks, and
   non-`/dashboard` paths). Loosening this would create an open redirect, and —
   because `next` is applied by `res.redirect` after login — a login-CSRF landing
   vector.

## Evidence

- Escaped rendering (currently safe): `views/dashboard/login.ejs:242` and
  `views/dashboard/register.ejs:252` — both `<%= error %>`.
- Reflected source: `src/routes/dashboard.ts:671`
  (`error: typeof req.query.error === 'string' ? req.query.error : null`) and the
  OAuth failure helper `redirectToLoginError` in `src/routes/applicants.ts`.
- Redirect validator: `src/services/applicantSession.ts` `safeApplicantDestination`.

## Desired Behavior

Automated tests encode the "safe" invariants so a regression fails CI rather than
shipping.

## Acceptance Criteria

1. A test asserts that requesting
   `/dashboard/login?error=<img src=x onerror=alert(1)>` (and the same on
   `/dashboard/register`) returns a body with the payload HTML-escaped — no raw
   `<img` or `<script` from the injected value appears in the response.
2. A unit test table for `safeApplicantDestination` asserts rejections →
   `/dashboard/applications` for: `https://evil.example`, `//evil.example`,
   `/\evil.example`, `/api/applicants`, `""`, non-string input; and acceptances
   (returned unchanged): `/dashboard`, `/dashboard/jobs`, `/dashboard/jobs?x=1`.
3. Tests live under `tests/regression/` alongside the OAuth flow tests and run in
   the existing `npm test` suite.

## Implementation Notes

- No production code change expected — this story only adds tests. If any
  assertion fails, that is itself a finding to fix before closing.
- Keep the XSS assertion resilient to markup (match on the absence of the
  unescaped payload and the presence of the `&lt;img`/`&lt;script` escaped form).

## Dependencies

- `tests/regression/` (new test file)
- Observes: `views/dashboard/login.ejs`, `views/dashboard/register.ejs`,
  `src/routes/dashboard.ts`, `src/services/applicantSession.ts`
