# Story: Applicant OAuth 2.0 / OIDC Social Login

**Status:** Backlog  
**Priority:** Medium  
**Parent Story:** [story-production-token-patterns.md](./story-production-token-patterns.md) — Production Token Patterns

## Overview

Currently applicants register with an email + password. Many job seekers prefer social login (Google, LinkedIn) to avoid creating yet another password. This story adds OAuth 2.0 / OIDC support so applicants can authenticate with an external identity provider and receive a JWT on success.

This story is the external IdP integration layer that sits on top of the JWT infrastructure established in the parent story.

## Current Behavior

- Applicant registers via `POST /api/applicants/register` with email + password
- Applicant logs in via `POST /api/applicants/login` with email + password
- No OAuth / OIDC flow exists

## Desired Behavior

1. Frontend exposes "Sign in with Google" and "Sign in with LinkedIn" buttons on the applicant login page
2. Applicant clicks a social login button → redirected to the IdP's authorization endpoint
3. Applicant grants consent → IdP redirects back with an authorization code
4. Backend exchanges code for tokens with the IdP
5. Backend extracts or creates the applicant record (email from IdP `id_token` claims)
6. Backend issues a JWT (per the parent story's applicant token spec) and returns it to the frontend
7. If no applicant record exists for that email, create one automatically (social-first registration)
8. Applicants who previously registered with email/password can link their social account (future story — out of scope here)

## Acceptance Criteria

1. `GET /api/applicants/auth/google` initiates Google OAuth 2.0 authorization code flow
2. `GET /api/applicants/auth/google/callback` handles the IdP callback, exchanges code, and returns `{ token, expiresIn }` JWT
3. `GET /api/applicants/auth/linkedin` initiates LinkedIn OAuth 2.0 authorization code flow
4. `GET /api/applicants/auth/linkedin/callback` handles the LinkedIn callback and returns `{ token, expiresIn }` JWT
5. First social login for an email auto-creates the applicant record (email + name from IdP claims, no password)
6. Subsequent social login for the same email returns the existing applicant record (no duplicates)
7. JWT returned matches the applicant token spec from the parent story: 7-day expiry, `sub` = applicant.id, `hasCredentials` = `false`
8. IdP client secrets are never exposed in frontend code or client-side logs
9. OAuth state parameter is validated to prevent CSRF on the callback

## Technical Notes

- Use `jose` or `openid-client` for OIDC discovery and token exchange
- Store IdP client IDs and secrets in environment variables / secrets manager (never in source code)
- Support multiple IdPs: Google (Google OAuth 2.0), LinkedIn (LinkedIn OAuth 2.0)
- State parameter: generate random CSRF token, store in short-lived HttpOnly cookie, validate on callback
- IdP `id_token` claims used: `email`, `given_name`, `family_name`, `picture`
- If applicant already has a password-based account with the same email, the social login still succeeds and logs them in (no merge conflict)
- Rate-limit callback endpoints to prevent authorization code injection attempts

## Dependencies

- Parent story: [story-production-token-patterns.md](./story-production-token-patterns.md) — JWT infrastructure must be in place first
- OAuth 2.0 / OIDC credentials from Google and LinkedIn developer consoles
- Environment / secrets management for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- Optional: redirect URI configuration per deployment environment
