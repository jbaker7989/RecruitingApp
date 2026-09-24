# Story: Static File Serving Edge Cases (Bug/Gap List)

**Status:** Open
**Priority:** High (dashboard is currently visually broken — CSS and every image 404)
**Created:** 2026-09-24 (review of `BUGS.md` NFR-048/NFR-049/NFR-050)
**Related:** `BUGS.md` lines 50-56 (NFR-048/049/050, malformed table entries — see bug 0 below)

## Overview

`BUGS.md` flags that the Express app never mounts `express.static()`, so
`/css/dashboard.css` and every `/images/*.svg` reference in `views/dashboard/*.ejs`
404s in the browser. Confirmed still true: `grep -n "static" src/index.ts`
returns nothing, and no dashboard route serves `public/` any other way.
Fixing the missing middleware is necessary but not sufficient — a review
found additional edge cases the existing bug entries don't account for.
Each is listed as its own bug below so they can be triaged/fixed
independently.

## Bugs / Gaps

### 0. `BUGS.md` NFR-048/049/050 entries are malformed and untracked
The table rows for NFR-048, NFR-049, and NFR-050 have stray
`| --- | --- | --- |` separators injected mid-table (only one separator row
belongs, right after the header), and NFR-050's "title" column actually
contains "**Root Cause:** ..." prose, with "**Impact:** ..." spilling into
its own broken row outside any column — this will not render correctly.
Additionally, unlike every other entry in the file, 048/049/050 have no
`### N. [NFR-0XX] Title` body section (Where/Symptom/Evidence/Impact/Status),
no `Required fix/tests` note, no `Status: OPEN` line, and are absent from
both the "Suggested fix order" list and the "Verification summary" table at
the bottom of the file.

There is also an ID collision: `NFR-048` is independently used by
`tests/regression/NFR-048-duplicate-application-prevention.test.ts` and
`tests/regression/NFR-048-duplicate-application-edge-cases.test.ts` for the
unrelated duplicate-application-prevention feature.

**Acceptance Criteria**
- Rewrite the NFR-048/049/050 block in `BUGS.md` as a proper `###` body
  section matching the rest of the document's format (single entry or three
  clearly separated entries, whichever the team prefers), with `Status`,
  `Required fix/tests`, and an entry in the tracking index/fix-order/
  verification-summary tables.
- Resolve the ID collision with the duplicate-application NFR-048 tests —
  either renumber one of the two, or explicitly document in both places that
  the ID is reused for unrelated features (not recommended).

### 1. `express.static()` is missing entirely — confirmed still open
No route in `src/index.ts` serves `public/`. Every dashboard page
(`/dashboard/login`, `/dashboard/applications`, `/dashboard/jobs`,
`/dashboard/profile`) references `/css/dashboard.css` and
`/images/favicon.svg`; `login.ejs` additionally references
`/images/frontier-illustration.svg`. All currently 404.

**Acceptance Criteria**
- Add `app.use(express.static('public'))` (or equivalent) in `src/index.ts`.
- Add a regression test that requests `/css/dashboard.css` and
  `/images/frontier-illustration.svg` directly and asserts `200` with the
  correct `Content-Type`.

### 2. `/images/favicon.svg` is referenced but does not exist on disk
`views/dashboard/layout.ejs` and `views/dashboard/login.ejs` both link
`<link rel="icon" ... href="/images/favicon.svg"/>`, but `public/images/`
only contains `frontier-illustration.svg` and `illustrated-hero.svg`. Fixing
bug 1 alone will not fix this — it changes from "everything 404s" to "one
specific file still 404s."

**Acceptance Criteria**
- Add a `public/images/favicon.svg` file (or update the templates to point
  at an asset that actually exists).
- Add a regression test asserting `/images/favicon.svg` returns `200` once
  static serving is fixed.

### 3. `illustrated-hero.svg` is an orphaned/unreferenced asset
`public/images/illustrated-hero.svg` exists on disk but nothing under
`views/` references it. Not a functional bug, but worth flagging so it
isn't assumed "wired up" once static serving is fixed — a reader could
reasonably expect every shipped image asset to be in use somewhere.

**Acceptance Criteria**
- Either wire `illustrated-hero.svg` into a template it was intended for, or
  remove it if it's leftover from an earlier design iteration. Document
  which, so it doesn't reappear as a false positive in a future asset audit.

### 4. No security review of what mounting `public/` exposes
`public/` also contains `public/login-preview.html`. Mounting
`express.static('public')` at the root will serve that file (and anything
else later dropped into `public/`) at a predictable public URL with no
access control. The bug entries don't say whether that's intended.

**Acceptance Criteria**
- Decide whether `login-preview.html` (and any future non-asset files under
  `public/`) should be publicly reachable. If not, either move static assets
  into a dedicated subdirectory (e.g. `public/assets/`) and mount only that,
  or exclude non-asset files from the mount.
- Add a test asserting the intended access boundary (e.g. `login-preview.html`
  is/isn't reachable, per the decision above).
