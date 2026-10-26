# NFR-SLOP-S04: Replace `any` Escape Hatches with Real Types

**Status:** Proposed
**Priority:** Medium (P3)
**Size:** L (1–2 days) — ~130 `any` sites; deliver in route-file slices, each independently shippable
**Tracks:** NFR-027
**Parent:** [Code hygiene remediation](README.md)
**Depends on:** S01 (unused request types), S03 (shared record factories)

## Problem

`tsconfig.json` has `strict: true`, yet `src/` contains about **129 explicit `any`** uses (`: any`, `as any`, `<any>`), concentrated in the request handlers:

| File | `any` uses |
|---|---|
| `src/routes/dashboard.ts` | 30 |
| `src/routes/applications.ts` | 21 |
| `src/routes/agents/index.ts` | 21 |
| `src/routes/applicants.ts` | 16 |
| `src/routes/agents/jdGenerator.ts` | 7 |
| `src/routes/auth.ts` | 6 |
| `src/routes/jobs.ts`, `src/middleware/validation.ts` | 4 each |
| remaining 5 files | 3 each or fewer |

Two patterns account for most of them:

1. **`req: any` — 70 handlers.** `AuthRequest` already exists (`src/middleware/auth.ts:5`) and is used by the middleware, but handlers ignore it, so `req.user`, `req.applicant`, `req.body` and `req.params` are unchecked everywhere. A typo such as `req.user.compnayId` compiles.
2. **Array-callback `(a: any) =>` — 32 sites,** e.g. `store.applicants.find((a: any) => a.id === …)` in `routes/applications.ts:181` even though `store.applicants` is already typed `Applicant[]`. The annotation *removes* type information the compiler already had, and the record built beside it is `const hireRecord: any`.

The unused request interfaces (`GenerateMessageRequest`, `GenerateRequest`, `UpdateDraftRequest`, …; S01) show the typed design was started and abandoned.

## Why it matters here

This service handles applicant PII and authorization decisions. Untyped `req.user` and untyped body access are exactly where role checks, ownership checks and field allow-lists regress. The earlier applicant-PII findings were found by manual review; typed boundaries make a class of them compile errors.

## Acceptance criteria

- [ ] **S04-AC1:** All handlers use `AuthRequest` (or a narrower per-route extension) instead of `req: any`. `grep -rn "req: any" src` returns nothing.
- [ ] **S04-AC2:** `(x: any)` callback annotations are removed where the receiver is already typed; the few that remain have a one-line reason comment.
- [ ] **S04-AC3:** Request bodies for agent routes use the existing request interfaces (revives them), parsed at the boundary: untrusted `req.body` is `unknown` and narrowed by a validator before use.
- [ ] **S04-AC4:** `no-explicit-any` is enabled as an error for `src/**` via S07, with a documented, counted allow-list (target ≤ 10, each justified, e.g. third-party typings).
- [ ] **S04-AC5:** No behavior change; types that reveal a real bug (wrong field, possibly-undefined access) are fixed in a *separate commit with a regression test* and recorded in `BUGS.md`.
- [ ] **S04-AC6:** `npm run typecheck`, JSON and PostgreSQL suites pass; no new `@ts-ignore`/`@ts-expect-error` introduced.

## Implementation tasks

1. Add a `RequestHandler`-style helper type for authenticated routes so each handler signature is one short generic.
2. Convert slices in this order (smallest blast radius first): `mcp.ts`, `jobs.ts`, `companies.ts`, `auth.ts`, `applications.ts`, `applicants.ts`, `agents/*`, `dashboard.ts`. One PR per slice.
3. Fix surfaced errors; for each, decide *typing mistake* vs *real bug*.
4. Turn on the S07 rule once the count is at the target.

## Boundaries

No new runtime validation library (use the existing validators). Do not widen `Store` types to make errors disappear. Do not change response shapes.
