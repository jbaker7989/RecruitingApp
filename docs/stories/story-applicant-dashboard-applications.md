# Story: My Applications Page

**Status:** Done
**Priority:** High
**Created:** Phase 2

## Overview

Display an authenticated applicant's submitted applications with a progress timeline and status badge per application. Matches the "Warm Welcome Dashboard" prototype in `proposal-comparison.html`.

## Current Behavior

- `GET /api/applicants/me/applications` returns JSON with application objects enriched with job + company info

## Desired Behavior

```
GET /dashboard/applications  → 200 rendered applications.ejs (auth required)
```

### Page Layout

- **Header:** "My Applications" + subtitle "Here's where things stand — keep going!"
- **Application cards:** one per application
  - Company initials avatar (colored circle)
  - Job title
  - "Applied [date]"
  - **4-segment progress timeline:** Applied → Reviewed → Interview (if scheduled) → Hired
  - **Status badge:** `Pending` (blue), `Reviewed` (orange), `Interview` (green), `Accepted` (green), `Rejected` (red)
  - Timeline segments filled based on status
- **"Browse more jobs" CTA:** link to `/dashboard/jobs`
- **Empty state:** if no applications → "You haven't applied to any jobs yet." + CTA to browse

### Status → Timeline Mapping

| Status | Timeline |
|---|---|
| `pending` | 1 of 4 filled |
| `reviewed` | 2 of 4 filled |
| `interview scheduled` | 3 of 4 filled |
| `accepted` | 4 of 4 filled |
| `rejected` | 4 of 4 filled (red tint) |

## Technical Notes

- Data fetched **server-side** inside `GET /dashboard/applications` handler via `readStore()` and `store.applications.filter(...)`, enriched with job + company — same logic as existing `/api/applicants/me/applications` but inline
- Pass `applications[]` as EJS template variable
- Format dates as "MMM D" (e.g., "Sep 3") using `Intl.DateTimeFormat`

## Acceptance Criteria

1. Page renders a card per application with company initials, job title, date applied
2. Progress timeline shows correct number of filled segments per status
3. Status badge displays correct color per status
4. "Browse more jobs" CTA links to `/dashboard/jobs`
5. Empty state shown when applicant has no applications
6. Page requires auth (redirects to login if no cookie)

## Dependencies

- `src/routes/dashboard.ts` — `GET /dashboard/applications` handler
- `views/dashboard/applications.ejs` — template
- `public/css/dashboard.css` — card, timeline, badge styles
- Auth story: [story-applicant-dashboard-auth.md](story-applicant-dashboard-auth.md)
