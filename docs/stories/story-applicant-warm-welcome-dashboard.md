# Story: Warm Welcome Dashboard — Applicant-Facing UI for Management Demo

**Status:** In Progress
**Priority:** High
**Created:** Phase 2

## Overview

Build a server-rendered HTML dashboard (EJS templates) to demonstrate the applicant experience to management. This is the UI representation of the "Warm Welcome Dashboard" direction chosen in `proposal-comparison.html`.

This is a parent story. Sub-stories cover auth, each page, and styling.

## Scope

- **4 pages:** Login, My Applications, Job Browse, Profile
- **Template engine:** EJS, served by Express at `/dashboard/*`
- **Auth:** JWT in `httpOnly` cookie, server-side template rendering
- **No new APIs** — reuses existing `/api/applicants/*` endpoints

## Acceptance Criteria

1. Express serves EJS templates at `/dashboard/*` routes
2. Login page authenticates via existing applicant login API, sets JWT cookie
3. Protected routes redirect to login when cookie is absent/invalid
4. All 4 pages render applicant data with Warm Welcome Dashboard styling
5. Logout clears cookie and redirects to login
6. No new API endpoints introduced

## Dependencies

- `ejs` dependency added to `package.json`
- `views/` directory with EJS templates
- `public/css/dashboard.css` stylesheet
- `src/routes/dashboard.ts` route handlers

## Sub-stories

- [story-applicant-dashboard-auth.md](story-applicant-dashboard-auth.md)
- [story-applicant-dashboard-applications.md](story-applicant-dashboard-applications.md)
- [story-applicant-dashboard-jobs.md](story-applicant-dashboard-jobs.md)
- [story-applicant-dashboard-profile.md](story-applicant-dashboard-profile.md)
- [story-applicant-dashboard-landing-graphic.md](story-applicant-dashboard-landing-graphic.md)
