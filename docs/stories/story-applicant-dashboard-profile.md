# Story: Profile Page

**Status:** Done
**Priority:** High
**Created:** Phase 2

## Overview

Display the authenticated applicant's profile with a completeness score and allow basic profile updates.

## Current Behavior

- `GET /api/applicants/me` returns the full applicant object
- `PATCH /api/applicants/me` accepts profile updates

## Desired Behavior

```
GET /dashboard/profile      → 200 rendered profile.ejs (auth required)
PATCH /dashboard/profile    → update profile → 302 → /dashboard/profile
```

### Page Layout

- **Header:** "My Profile" + applicant name
- **Completeness score bar:** horizontal progress bar (0–100%) with label "Profile completeness: 65% complete"
- **Editable fields:**
  - First Name (text input)
  - Last Name (text input)
  - Email (text input, read-only if OAuth user)
  - Phone (text input)
  - State (text input)
  - ZIP Code (text input)
  - Right to Work (checkbox)
  - Expected Pay (number input)
  - Preferred Contact Method (select: email / sms)
- **Education History:** read-only list (expandable)
- **Employment History:** read-only list (expandable)
- **Save button:** submits `PATCH /dashboard/profile`
- **Success toast:** "Profile updated" on successful save
- **Error handling:** show inline field errors if API returns 400

### Completeness Score

Display the same `calculateCompleteness()` logic used by the API:
- Email: +10
- First Name: +10
- Last Name: +10
- Phone: +10
- Address (state + ZIP): +10
- Education History: +15
- Employment History: +15
- Right to Work: +10

Show the bar filled proportionally. Label each missing item as a hint.

## Technical Notes

- Completeness score computed server-side (reuse `calculateCompleteness()` from `src/routes/applicants.ts`)
- `PATCH` form submits to `/dashboard/profile?_method=PATCH` (method-override) OR separate form action
- Use HTML `<form method="POST" action="/dashboard/profile?_method=PATCH">` with method-override middleware OR direct `<button type="submit">` with JS fetch
- Education/Employment read-only for MVP; add-edit is out of scope

## Acceptance Criteria

1. Page displays all profile fields with current values
2. Completeness progress bar shows correct score (0–100%)
3. Each missing profile section is listed as a hint below the bar
4. Editing a field and saving → `PATCH /api/applicants/me` called → profile updates
5. Save success → page re-renders with updated values
6. Save failure → inline error shown, no data lost
7. OAuth users see email as read-only
8. Page requires auth (redirects to login if no cookie)

## Dependencies

- `src/routes/dashboard.ts` — `GET /dashboard/profile` + `PATCH /dashboard/profile` handlers
- `views/dashboard/profile.ejs` — template
- `public/css/dashboard.css` — form, progress bar, badge styles
- Auth story: [story-applicant-dashboard-auth.md](story-applicant-dashboard-auth.md)
