# Story: Job Browse Page

**Status:** Done
**Priority:** High
**Created:** Phase 2

## Overview

Display active job listings with a `hasApplied` indicator per job. Allows applicants to see which jobs they've already applied to and browse new ones.

## Current Behavior

- `GET /api/applicants/me/jobs` returns active jobs enriched with `hasApplied: boolean` and `applicationId: string | null`

## Desired Behavior

```
GET /dashboard/jobs         → 200 rendered jobs.ejs (auth required)
```

### Page Layout

- **Header:** "Browse Jobs" + subtitle "Find your next opportunity"
- **Job cards:** one per active job
  - Company name + location
  - Job title (bold)
  - Pay range (if available, e.g., "$50k – $80k")
  - Required skills (tags, max 3 shown)
  - **Apply / Applied badge:**
    - If `hasApplied: true` → "Applied" badge (green, non-clickable)
    - If `hasApplied: false` → "Apply Now" button → `POST /api/applications` (or link to job detail — out of scope for MVP)
  - Match score (if available, e.g., "78% match")
- **Empty state:** if no active jobs → "No open positions right now. Check back soon!"

### Interaction

- "Apply Now" submits to `POST /api/applications` with `{ jobPostingId: job.id }`
- On success: page re-renders with that job now showing "Applied" badge
- On failure (e.g., duplicate): show inline error toast

## Technical Notes

- Data fetched **server-side** inside `GET /dashboard/jobs` handler via `readStore()` — reuse existing logic from `/api/applicants/me/jobs`
- "Apply Now" action: HTML form POST or client-side fetch (form POST is simpler for MVP)
- Pay range: display `$min – $max` if both > 0

## Acceptance Criteria

1. Page lists all active jobs with company name, title, pay range, skills
2. Jobs with `hasApplied: true` show green "Applied" badge
3. Jobs with `hasApplied: false` show "Apply Now" button
4. Clicking "Apply Now" creates application and updates badge to "Applied"
5. Duplicate application attempt shows error message (not crash)
6. Page requires auth (redirects to login if no cookie)

## Dependencies

- `src/routes/dashboard.ts` — `GET /dashboard/jobs` + `POST /dashboard/jobs/apply` handlers
- `views/dashboard/jobs.ejs` — template
- `public/css/dashboard.css` — job card, badge, button styles
- Auth story: [story-applicant-dashboard-auth.md](story-applicant-dashboard-auth.md)
