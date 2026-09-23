# Story: Applicant Email Verification on Registration

**Status:** Phase 2  
**Priority:** Medium  
**Created:** Phase 2 candidate

## Overview

Currently applicants register with an email address but there is no verification that they own/control that email. An email verification step should be added after applicant registration to confirm email ownership before the applicant can apply to jobs.

## Current Behavior

- Applicant registers with `email` in the request body
- No confirmation email is sent
- Applicant can immediately apply to jobs with `emailConfirmed: false` (the field exists but is not enforced)

## Desired Behavior

1. Applicant registers → account created with `emailVerified: false`
2. System sends a verification email with a time-limited token link
3. Applicant clicks link → `GET /api/applicants/verify?token=...` → `emailVerified: true`
4. Applicant cannot apply to any job until `emailVerified: true`
5. If token expires, applicant can request a new verification email

## Acceptance Criteria

1. `Applicant` model gains `emailVerified: boolean` (default `false`) and `verificationToken: string | null`
2. Registration flow generates a signed token (e.g. JWT or crypto token) and sends email
3. Verification endpoint validates token and sets `emailVerified: true`
4. `POST /api/applications` returns `403 Forbidden` with message "Email must be verified before applying" when `emailVerified === false`
5. Verification token expires after configurable window (default: 24 hours)
6. Resend verification endpoint: `POST /api/applicants/resend-verification` (token required)

## Technical Notes

- Email sending: use existing notification infrastructure or integrate with SendGrid/SES
- Token generation: `crypto.randomBytes(32).toString('hex')` with expiry timestamp
- Store token + expiry in Applicant record: `verificationToken`, `verificationTokenExpiry`

## Dependencies

- Email service provider (SendGrid, AWS SES, or nodemailer stub for dev)
- Token storage in Applicant model
- New endpoint: `GET /api/applicants/verify`
- New endpoint: `POST /api/applicants/resend-verification`
- Update: `POST /api/applications` → check `emailVerified` before creating application
