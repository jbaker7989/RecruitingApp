# Story: Dashboard Auth — Login, Cookie Session, Logout

**Status:** Done
**Priority:** High
**Created:** Phase 2

## Overview

Add authentication flow for the dashboard UI. JWT tokens are stored in `httpOnly` cookies. All `/dashboard/*` routes are protected — unauthenticated requests redirect to login.

## Current Behavior

- Existing API endpoints accept JWT via `Authorization: Bearer <token>` header
- No dashboard UI exists

## Desired Behavior

### Login

```
GET /dashboard/login         → 200 Login form (no auth required)
POST /dashboard/login        → authenticate → Set-Cookie → 302 → /dashboard/applications
POST /dashboard/login        → auth failure → 200 Login form + error message
```

Login form submits `{ email, password }` to `POST /dashboard/login`.
Handler calls `POST /api/applicants/login`, extracts JWT from response.
Sets cookie: `Set-Cookie: token=<jwt>; HttpOnly; SameSite=Lax; Path=/`

### Protected Routes

All `GET /dashboard/*` routes (except `/dashboard/login`) check for valid JWT cookie.
If missing or invalid → `302` redirect to `/dashboard/login?next=<originalPath>`.
If valid → render page.

### Logout

```
GET /dashboard/logout        → Clear cookie → 302 → /dashboard/login
```

Cookie cleared via `Set-Cookie: token=; HttpOnly; Max-Age=0`

### Cookie Format

- **Name:** `token`
- **Flags:** `HttpOnly`, `SameSite=Lax`, `Path=/`
- **No `Secure` flag** (works on localhost; add in production if HTTPS)

## Technical Notes

- Cookie parsing: Express built-in `cookie-parser` middleware, or manual `parse` from cookie header
- JWT verification: reuse existing `verifyApplicantToken(tokenService.ts)`
- `req.user` not used by dashboard routes — cookie is the sole auth mechanism

## Acceptance Criteria

1. `GET /dashboard/login` renders login form (email + password fields)
2. Submitting valid credentials → cookie set → redirect to `/dashboard/applications`
3. Submitting invalid credentials → form re-renders with error message
4. `GET /dashboard/applications` (no cookie) → redirects to `/dashboard/login`
5. `GET /dashboard/logout` → cookie cleared → redirects to `/dashboard/login`
6. Subsequent visits after logout → redirected to login

## Dependencies

- `cookie-parser` or manual cookie parsing (Express built-in)
- `src/routes/dashboard.ts` with login/logout handlers
- `views/dashboard/login.ejs` form template
