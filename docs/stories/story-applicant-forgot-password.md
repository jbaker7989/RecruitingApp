# Story: Applicant Password Reset / Forgot Password

**Status:** Phase 2  
**Priority:** Medium  
**Created:** Phase 1 (backlog gap review)

## Overview

Currently, if an applicant forgets their password there is no recovery path — they would need to create a new account. A password reset flow (forgot password → email with reset link → set new password) must be added.

## Current Behavior

- Applicant registers via `POST /api/applicants/register` with email + password
- No password recovery mechanism exists

## Desired Behavior

1. Applicant visits `/api/applicants/forgot-password` with `{ email }`
2. If email exists and has credentials, generate a time-limited reset token and send it via email
3. Applicant clicks reset link → `GET /api/applicants/reset-password?token=...` verifies token validity
4. Applicant submits new password → `POST /api/applicants/reset-password` with `{ token, newPassword }` → password updated
5. Token expires after configurable window (default: 1 hour)
6. Token is single-use — consuming it invalidates it immediately
7. If token is expired or already used, return `400 Bad Request` with helpful message

## Acceptance Criteria

1. `Applicant` model gains `resetToken: string | null` and `resetTokenExpiry: string | null`
2. `POST /api/applicants/forgot-password` — accepts `{ email }`, returns `200 OK` (always, to prevent email enumeration)
3. When email matches a credentialed applicant, generate token and send email
4. `POST /api/applicants/reset-password` — accepts `{ token, newPassword }`, validates token + expiry, updates `passwordHash`, clears token fields
5. Token is stored hashed (not plaintext) in the applicant record
6. Used / expired tokens are rejected with appropriate error message
7. Observability log entries for: token generation, token consumption, failed reset attempts

## Technical Notes

- Email sending: integrate with existing notification infrastructure or SendGrid/SES stub
- Token: `crypto.randomBytes(32).toString('hex')` stored hashed
- No email enumeration: always return `200 OK` even if email not found, to avoid leaking registered emails

## Dependencies

- Email service provider
- `Applicant` model fields: `resetToken`, `resetTokenExpiry`
- New endpoints: `POST /api/applicants/forgot-password`, `POST /api/applicants/reset-password`
