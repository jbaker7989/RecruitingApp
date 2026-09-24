# Story: Dashboard Login — Make Phone Number Optional

**Status:** Ready
**Priority:** Medium
**Created:** Phase 2

## Overview

The phone number field on the dashboard login page should not be required. Users should be able to log in with just email and password.

## Current Behavior

- `views/dashboard/login.ejs` login form requires phone number (HTML `required` attribute)
- `src/routes/dashboard.ts` POST `/dashboard/login` validates phone presence
- `src/routes/dashboard.ts` POST `/dashboard/register` validates phone presence and creates applicant with phone

## Desired Behavior

### Login Form
- Phone number field **removed entirely** from login form
- Only email and password fields required

### Register Form
- Phone number field **optional** (no `required` attribute, no validation error if empty)
- Applicant created with empty phone string if not provided

### API Alignment
- `POST /api/applicants/login` already only requires email + password ✓
- `POST /api/applicants/register` requires phone — **keep API as-is** (dashboard register will send empty string if omitted)

## Files to Change

| File | Change |
|------|--------|
| `views/dashboard/login.ejs` | Remove phone field from form |
| `views/dashboard/register.ejs` | Remove `required` from phone field; keep field for optional entry |
| `src/routes/dashboard.ts` | Remove phone validation from POST `/login`; make phone optional in POST `/register` |

## Acceptance Criteria

1. `GET /dashboard/login` → form shows only email + password fields
2. `POST /dashboard/login` with valid email/password (no phone) → logs in successfully
3. `GET /dashboard/register` → form shows phone field without red asterisk
4. `POST /dashboard/register` with valid email/password/name (phone empty) → creates account, logs in
4. `POST /dashboard/register` with phone provided → stores phone normally
5. Existing tests pass (may need updates for validation changes)

## Technical Notes

- Login form currently uses `views/dashboard/login.ejs` with inline CSS — just remove the phone form-group block
- Register form in `views/dashboard/register.ejs` — remove `required` attribute, keep field
- Dashboard POST handlers in `src/routes/dashboard.ts` — adjust validation logic
- Applicant model already allows empty phone string

## Dependencies

- None (self-contained UI + route changes)

## Related Stories

| Story | Relationship |
|-------|--------------|
| [story-applicant-dashboard-auth.md](./story-applicant-dashboard-auth.md) | Parent auth flow story |
| [story-applicant-dashboard-landing-graphic.md](./story-applicant-dashboard-landing-graphic.md) | Login page visual context |