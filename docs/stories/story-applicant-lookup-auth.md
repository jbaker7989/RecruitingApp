# Story: Recruiter Auth Required for Applicant Lookup

**Status:** Open  
**Priority:** Medium  
**Created:** Phase 2 candidate

## Overview

Currently `GET /api/applicants/:id` is publicly accessible. This is a security concern — applicant PII (personal information, employment history, education) should not be retrievable by anonymous or unauthenticated users.

## Current Behavior

```
GET /api/applicants/:id  → 200 OK with full applicant profile (no auth required)
```

## Desired Behavior

```
GET /api/applicants/:id  → 401/403 unless requester is authenticated recruiter, hiring-manager, or member-services
```

## Acceptance Criteria

1. `GET /api/applicants/:id` returns `401 Unauthorized` when no token is provided
2. `GET /api/applicants/:id` returns `403 Forbidden` when the token belongs to a User with role `applicant`
3. `GET /api/applicants/:id` returns `200 OK` with full profile when requester is `recruiter`, `hiring-manager`, or `member-services`
4. Observability log entry is created on each lookup

## Notes

- Keep the public `/api/applicants/register` and `/api/applicants/login` endpoints open (they only expose non-sensitive registration/login flows)
- The `/api/applicants/me` endpoint (authenticated applicant self-lookup) remains accessible only to the owning applicant
