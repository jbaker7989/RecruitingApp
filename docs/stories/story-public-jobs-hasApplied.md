# Story: Add `hasApplied` to Public Jobs Browse Endpoint

**Status:** Open  
**Priority:** Medium  
**Created:** Phase 1 (backlog gap review)

## Overview

The authenticated jobs browse endpoint (`GET /api/applicants/me/jobs`) already returns `hasApplied: true/false` and `applicationId` per job. The public unauthenticated jobs browse endpoint (`GET /api/jobs`) does not. For a cohesive UX where applicants can browse jobs whether logged in or not, the public endpoint should also include these fields when called by an authenticated applicant.

## Current Behavior

```
GET /api/jobs (unauthenticated) → plain JobPosting[]
GET /api/applicants/me/jobs    → JobPosting[] + hasApplied + applicationId
```

## Desired Behavior

```
GET /api/jobs (authenticated applicant) → JobPosting[] + hasApplied + applicationId
GET /api/jobs (unauthenticated)         → plain JobPosting[] (no change)
```

This requires the `/api/jobs` route to check for an `Authorization` header and, if it contains a valid applicant token, enrich the response with `hasApplied` and `applicationId`.

## Acceptance Criteria

1. `GET /api/jobs` with `Authorization: Bearer <applicant.id>` header returns each job with `hasApplied: boolean` and `applicationId: string | null`
2. `GET /api/jobs` without auth header returns plain job listings (no change to existing behavior)
3. Credential-less applicants (legacy `email === null`) are treated as unauthenticated (no enrichment)
4. Observability log is not required for browse events (avoid log noise)

## Implementation Notes

- Reuse the same logic from `GET /api/applicants/me/jobs` in the jobs route
- Consider extracting the enrichment logic into a shared utility to avoid duplication
- The existing `authenticateApplicant` middleware can be reused, but the route should not require auth — it should be optional

## Dependencies

- `authenticateApplicant` middleware (already exists)
- Potential shared utility: `enrichJobsWithApplicationStatus(jobs, applicantId, applications)`
