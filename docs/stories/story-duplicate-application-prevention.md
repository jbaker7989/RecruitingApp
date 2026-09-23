# Story: Prevent Duplicate Applications

**Status:** Open  
**Priority:** Critical  
**Created:** Phase 1 (entity review)

## Overview

An applicant can currently submit multiple applications to the same job posting. The system has no guard against this — the same `(applicantId, jobPostingId)` pair can appear in the `applications` table unlimited times. This creates data integrity issues, skews application counts, and produces a poor UX.

## Current Behavior

```
POST /api/applications
{
  "applicantId": "uuid-123",
  "jobPostingId": "uuid-456"
}
→ 201 Created (every time, no uniqueness check)
```

## Desired Behavior

- A single applicant may have **at most one** application per job posting
- A second POST with the same `(applicantId, jobPostingId)` pair returns `409 Conflict` with the existing application ID
- The UI can use this to show "Already applied" instead of an "Apply" button
- The `hasApplied` / `applicationId` fields on `GET /me/jobs` already expose this data — this story enforces the uniqueness constraint at the API layer

## Acceptance Criteria

1. `POST /api/applications` checks for existing application with same `applicantId` + `jobPostingId`
2. If found, returns `409 Conflict` with `{ error: 'Already applied to this job', applicationId: '...' }`
3. Observability log records the duplicate attempt with `outcome: 'failure'`
4. Legacy endpoint `POST /api/applicants/:id/apply` also receives the duplicate check
5. `GET /me/jobs` continues to return `hasApplied: true` for already-applied jobs (already implemented)

## Implementation Notes

- Uniqueness check happens in the service / route layer — JSON file store has no schema enforcement
- The existing `hasApplied` + `applicationId` fields on `GET /me/jobs` already provide the UI data needed; this story closes the enforcement gap
