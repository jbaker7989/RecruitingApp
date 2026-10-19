# Story: OAuth flow hardening — provider-specific params, state→provider binding, next preservation

**Status:** Implemented — pending live IdP verification
**Priority:** Medium
**Tracking ID:** NFR-074
**Created:** 2026-10-07 (OAuth verification)

## Overview

Three smaller correctness/UX/security gaps in the OAuth flow, grouped because they
share the initiate/callback code paths:

1. **Google-only parameters sent to every provider.** `buildAuthorizationUrl` always
   appends `access_type=offline` and `prompt=consent`. These are Google concepts.
   LinkedIn ignores `access_type`; Facebook does not use either and can reject or
   mishandle unexpected authorization params. The authorization URL should carry only
   the parameters each provider expects.

2. **State is not bound to its provider.** `storeState` records the provider alongside
   the CSRF state, but `validateState` only checks existence and deletes it — it never
   confirms the state was issued for the provider whose callback is handling it. A state
   minted on the Google initiate could be replayed against the LinkedIn/Facebook callback.

3. **`next` redirect target is not preserved through OAuth.** The dashboard password
   login supports a `next` parameter to return the user to their intended page; the
   social-login buttons and the OAuth round trip drop it, so OAuth users always land on
   the default destination. (Pairs with NFR-071, which introduces the post-login redirect.)

## Evidence

- Shared builder adds Google params for all providers:
  `src/services/oauthService.ts:133-144` (`access_type: 'offline', prompt: 'consent'`).
- State stored with provider but validated without it:
  `src/services/oauthService.ts:44-50` (`storeState` keeps `provider`) vs.
  `:52-62` (`validateState` ignores provider).
- Login buttons carry no `next`: `views/dashboard/login.ejs`
  (`href="/api/applicants/auth/google"` — no query), and the callbacks don't read a `next`.

## Current Behavior

- Facebook/LinkedIn authorization URLs include irrelevant Google params.
- A valid unexpired `state` is accepted by any provider's callback.
- OAuth always redirects to the default post-login page regardless of where the user started.

## Desired Behavior

1. Each provider's authorization URL contains only the parameters it supports
   (Google may keep `access_type`/`prompt`; LinkedIn/Facebook omit them).
2. `validateState` confirms the state exists **and** was issued for the same provider as
   the callback; a provider mismatch fails the CSRF check.
3. A safe, same-origin `next` target is carried from the login page through the state and
   applied on the post-login redirect (works with NFR-071).

## Acceptance Criteria

1. The Facebook and LinkedIn authorization URLs do not include `access_type`/`prompt`
   (or only provider-supported params); Google's behavior is unchanged.
2. A state issued for provider A is rejected (`401`/CSRF failure) when presented to
   provider B's callback.
3. Logging in via OAuth with a `next=/dashboard/jobs` intent returns the user to
   `/dashboard/jobs` after the session is set; unsafe/off-site `next` values are ignored
   and fall back to the default destination.
4. Existing passing behavior (valid same-provider state round trip) still succeeds.

## Implementation Notes

- Make per-provider param sets explicit in each `*Config`/initiate, or pass an
  `extraParams` map into `buildAuthorizationUrl`.
- Change `validateState(state, provider)` to compare the stored provider (Redis value or
  in-memory entry already carries it) and only consume on match.
- Carry `next` by binding it to the state record (store `{ provider, next }`) rather than a
  query param on the callback, so it is tamper-resistant; validate it is a local path.

## Dependencies

- `src/services/oauthService.ts` (builder, state store/validate)
- `src/routes/applicants.ts` (callbacks), `views/dashboard/login.ejs` + `register.ejs` (next on buttons)
- Pairs with NFR-071 (post-login redirect is where `next` is applied)
