# Story: Dashboard Styling — Warm Welcome Design System

**Status:** Open
**Priority:** High
**Created:** Phase 2

## Overview

Define the shared CSS design system for the Warm Welcome Dashboard. Styles apply to all 4 pages (Login, Applications, Jobs, Profile). No external CSS framework — plain CSS.

## Design Direction

Matches the "Warm Welcome Dashboard" prototype in `proposal-comparison.html`:

- **Color palette:**
  - Background: `#F8F9FA` (light gray)
  - Cards: `#FFFFFF`
  - Primary accent: `#4CAF50` (green — progress/success)
  - Secondary accent: `#4A76D4` (blue — pending/info)
  - Warning: `#E08A2A` (orange — reviewed)
  - CTA button: `#FF6B6B` (coral red — browse/apply)
  - Text primary: `#222222`
  - Text secondary: `#888888`
  - Nav background: `#FFFFFF`
  - Nav active: `#4CAF50`

- **Typography:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)

- **Cards:** White background, `border-radius: 12px`, `box-shadow: 0 2px 6px rgba(0,0,0,0.05)`

- **Nav bar:** Top bar with brand name ("New Frontier"), nav links (Jobs, Applications, Profile), avatar placeholder, logout

- **Timeline:** 4 gray segments, filled segments turn `#4CAF50`, rounded `2px` height `4px`

- **Badges:**
  - `pending` → `#E8F0FE` bg, `#4A76D4` text
  - `reviewed` → `#FFF3E0` bg, `#E08A2A` text
  - `interview` → `#E4F7E9` bg, `#2E9E4B` text
  - `accepted` → `#E4F7E9` bg, `#2E9E4B` text
  - `rejected` → `#FDEAEA` bg, `#C62828` text

- **Buttons:** `border-radius: 8px`, bold text, padding `8px 16px`

- **Progress bar:** `height: 8px`, `border-radius: 4px`, fill color `#4CAF50`

- **Avatar:** `border-radius: 50%`, `width: 26px`, `height: 26px`, background `#E8F0FE`

- **Login page:** Centered card on `#F8F9FA` background, email + password inputs, "Sign In" button

## Technical Notes

- Single `public/css/dashboard.css` file, served as static asset
- Nav included in `layout.ejs` (shared across all pages)
- No responsive framework — basic `@media (max-width: 768px)` stacking
- CSS variables for colors: `--color-primary`, `--color-cta`, etc.

## Acceptance Criteria

1. All 4 pages share consistent nav bar (brand + links + logout)
2. Application cards match Warm Welcome styling (company initials, rounded, shadowed)
3. Timeline segments render correctly (filled vs unfilled)
4. Status badges match color spec per status
5. Profile completeness bar renders with correct fill percentage
6. Login page is centered card with Warm Welcome color palette
7. No layout breaking on mobile (basic responsive stacking)

## Dependencies

- `public/css/dashboard.css`
- `views/dashboard/layout.ejs` — shared nav partial
- Page stories:
  - [story-applicant-dashboard-applications.md](story-applicant-dashboard-applications.md)
  - [story-applicant-dashboard-jobs.md](story-applicant-dashboard-jobs.md)
  - [story-applicant-dashboard-profile.md](story-applicant-dashboard-profile.md)
  - [story-applicant-dashboard-auth.md](story-applicant-dashboard-auth.md)
