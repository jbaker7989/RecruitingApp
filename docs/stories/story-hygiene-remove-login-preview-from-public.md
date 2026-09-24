# Story: Remove `login-preview.html` from `public/` Before Shipping (Hygiene)

**Status:** Open
**Priority:** Low (hygiene — not a security vulnerability; no secrets/PII involved)
**Created:** 2026-09-24 (security review of `fix/NFR-048-static-file-serving`)

## Overview

The NFR-048 fix mounts `express.static()` on the `public/` directory to
finally serve dashboard CSS/images (`docs/stories` and `BUGS.md` NFR-048).
A security review of that change found no vulnerabilities, but noted in
passing that `public/login-preview.html` — an internal design-comparison
mockup used to compare two login-page illustration options during the
dashboard UX work — is not linked from any application flow and will now
become publicly reachable at `/login-preview.html` once the static mount
ships.

The file itself contains no secrets, credentials, or PII (inline SVG art,
CSS, and a login form with empty placeholder values) — this is not a
security issue. It's a design artifact that doesn't belong in the
production static-asset directory.

## Current Behavior

`public/login-preview.html` sits alongside real production assets
(`public/css/dashboard.css`, `public/images/*.svg`) and, once
`express.static()` is mounted, is served publicly and unauthenticated at
`/login-preview.html` with no link to it from anywhere in the app.

## Desired Behavior

`public/` contains only assets actually referenced by shipped templates.
The design-comparison mockup either moves out of `public/` entirely (e.g.
into a `design/` or `docs/` location not covered by the static mount, or
is deleted if the design decision it documents is already finalized and no
longer needed for reference).

## Acceptance Criteria

1. `public/login-preview.html` is no longer served at any public URL.
2. If the file has ongoing reference value (e.g. documenting why one
   illustration option was chosen over another), it's relocated somewhere
   outside `public/` rather than deleted outright.
3. No template or route references `/login-preview.html`, so removing it
   doesn't break anything (confirm via `grep -rn "login-preview" views/ src/`).

## Notes

Filed as a follow-up from the security review of `fix/NFR-048-static-file-serving`
rather than folded into that fix, since it's unrelated cleanup and not a
blocking issue for the static-serving bug itself.
