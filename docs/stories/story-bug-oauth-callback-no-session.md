# Story: OAuth login never signs the applicant into the app — callback returns raw JSON

**Status:** Implemented — pending live IdP verification
**Priority:** Critical
**Tracking ID:** NFR-071
**Created:** 2026-10-07 (OAuth verification)

## Overview

The applicant dashboard login page (`views/dashboard/login.ejs`) and register page
present "Continue with Google / LinkedIn / Facebook" buttons that link to
`/api/applicants/auth/{provider}`. The initiate → provider-consent → callback round
trip is wired correctly, but the **callback does not establish a dashboard session**.
On success it responds with a JSON body `{ token, expiresIn }` and nothing else — it
does **not** set the `token` cookie the dashboard reads, and does **not** redirect to
`/dashboard`.

As a result, an applicant who signs in with a social provider lands on a page showing
a raw JSON token blob and is **not logged into the application**. OAuth is therefore
non-functional as an access path, which defeats the purpose of the social-login
buttons on the applicant login screen.

> Root cause: the OAuth service was built against a token-API model (the original
> `story-applicant-oauth-social-login.md` AC#2/#4 specify returning `{ token, expiresIn }`),
> **before** the cookie-based applicant dashboard existed (`story-applicant-dashboard-auth.md`).
> When the dashboard and its OAuth buttons were added, the callbacks were never updated
> to bridge into the cookie session the dashboard requires.

## Evidence

- `src/routes/applicants.ts:555-556` (Google), `:587-588` (LinkedIn), `:619-620` (Facebook):
  ```
  const result = await handleGoogleCallback(code, state, baseUrl);
  return res.json({ token: result.token, expiresIn: result.expiresIn });
  ```
- Dashboard session is a cookie named `token`, read by `requireApplicant`:
  `src/routes/dashboard.ts:15` → `const token = req.cookies?.token;`
- Normal dashboard login sets exactly that cookie and redirects:
  `src/routes/dashboard.ts:154-155` →
  ```
  res.setHeader('Set-Cookie', `token=${token}; ${COOKIE_OPTS}`);
  res.redirect(destination);
  ```
- The OAuth buttons target the API routes from the dashboard UI:
  `views/dashboard/login.ejs` → `href="/api/applicants/auth/google"` (and linkedin/facebook).

## Current Behavior

```
Applicant clicks "Continue with Google" on /dashboard/login
  → 302 to Google  → consent  → 302 back to /api/applicants/auth/google/callback
  → 200 application/json  { "token": "...", "expiresIn": 604800 }
  → browser displays JSON; no cookie set; user is NOT on the dashboard, NOT logged in
```

## Desired Behavior

A successful OAuth callback logs the applicant into the dashboard exactly as a
password login does:

1. Sign the applicant JWT (already done in `upsertOAuthApplicant`).
2. Set the `token` session cookie using the same options as the dashboard login
   (`HttpOnly`, `SameSite`, `Path=/`, `Max-Age` matching the 7-day applicant token).
3. `302` redirect to the dashboard (honoring a safe `next` target when present —
   see NFR-074), not to a JSON body.
4. On failure, redirect back to `/dashboard/login` with a user-facing error message
   rendered by the login template — never a raw JSON error page.

The pure token-API behavior (returning `{ token, expiresIn }`) may be retained for
non-browser API clients behind a separate path or an `Accept: application/json`
negotiation, but the browser flow from the login page must result in a session + redirect.

## Acceptance Criteria

1. Completing Google OAuth from `/dashboard/login` results in a `Set-Cookie: token=...`
   response and a `302` redirect to `/dashboard` (or the validated `next`).
2. The same is true for LinkedIn and Facebook.
3. After the redirect, the applicant can load `/dashboard/applications`, `/dashboard/jobs`,
   and `/dashboard/profile` without being bounced to the login page.
4. The session cookie uses the same security options as the password-login cookie
   (`HttpOnly`, `SameSite`, `Path`, `Max-Age` = applicant token TTL).
5. A failed callback (bad/expired state, denied consent, token-exchange error) redirects
   to `/dashboard/login` with a rendered error message and sets no cookie.
6. The browser never receives a raw JSON token/error body from the callback.
7. Regression: password login/logout is unchanged.

## Implementation Notes

- Extract the dashboard's cookie-setting into a shared helper so OAuth callbacks and
  password login use identical options (avoid drift). Current options live at
  `src/routes/dashboard.ts` (`COOKIE_OPTS`).
- The three callbacks in `src/routes/applicants.ts` are the only change points plus the
  shared helper; `oauthService.ts` already returns a signed token.
- Consider content negotiation: keep JSON for `Accept: application/json`, cookie+redirect
  for browser navigations (default).

## Dependencies

- `src/routes/applicants.ts` (callback handlers)
- `src/routes/dashboard.ts` (cookie options / shared helper)
- Related: [story-applicant-oauth-social-login.md](./story-applicant-oauth-social-login.md),
  [story-applicant-dashboard-auth.md](./story-applicant-dashboard-auth.md)
- Blocked-by for a working social login: NFR-072 (providers must be configured to test end-to-end)
