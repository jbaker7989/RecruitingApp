# Story: Stop leaking applicant password hashes and PII on GET/PUT /api/applicants/:id

**Status:** Open  
**Priority:** Critical  
**Created:** Phase 2 (security review)

## Overview

The public applicant lookup route returns the **entire applicant record, including `passwordHash`**, to any caller with no authentication. The legacy `PUT /:id` and `POST /` routes additionally allow **mass assignment of `passwordHash`** (and any other field) by blindly spreading `req.body` onto the record. This goes beyond the generic "no ownership check" gap — it is a direct credential + PII disclosure on a read path and a credential-injection/write path.

> Discovered in the 2026-09 review: `src/routes/applicants.ts:331-338` (`GET /:id` → `res.json({ ...applicant, hires })`), `src/routes/applicants.ts:341-347` (`PUT /:id` → `{ ...existing, ...req.body }`), `src/routes/applicants.ts:293` (`POST /` → `passwordHash: req.body.passwordHash || null`). The committed `data/store.json` even contains user accounts with `passwordHash: "encrypted_password123"`.

## Current Behavior

```
GET /api/applicants/:id (no auth) → 200 { id, firstName, ..., passwordHash: "sha256...", ...hires }
PUT /api/applicants/:id (no auth) → { ...existing, ...req.body }  // passwordHash injectable
POST /api/applicants (no auth)   → passwordHash: req.body.passwordHash   // injectable
```

## Desired Behavior

- `GET /api/applicants/:id` returns a **sanitized** public view only — `passwordHash`, `oauthProviderId`, and any reset/credential material are never serialized.
- `GET /:id` is authenticated and ownership-checked (requester is the applicant or an authorized staff member); otherwise 401/403.
- `PUT /:id` and `POST /` never accept `passwordHash` from the request body — passwords can only be set through the dedicated register/login/password-reset flows.
- A single explicit field allow-list is enforced on all applicant writes.

## Acceptance Criteria

1. `GET /api/applicants/:id` response omits `passwordHash` (and `oauthProviderId`) — verified by asserting the key is absent for both own and other applicant lookups.
2. `PUT /api/applicants/:id` with a body containing `passwordHash` returns `400` and does **not** persist it.
3. `POST /api/applicants` with a body containing `passwordHash` is either rejected (`400`) or ignored (hash generated server-side only).
4. Unauthenticated `GET /api/applicants/:id` returns `401`.
5. A cross-applicant (or staff member not authorized for that applicant) `GET /:id` returns `403`.

## Implementation Notes

- Define a `sanitizeApplicant(applicant)` / `publicApplicantView` helper and reuse it on every read path.
- Adopt an explicit writable-field allow-list for `PUT`/`POST` rather than free spread.
- This is closely related to NFR-011 ("no authorization/ownership checks on applicants"); this story narrows the scope to the credential/PII **disclosure** specifically.

## Dependencies

- `src/routes/applicants.ts`
- An allow-list helper (new or from `src/middleware/validation.ts`)
