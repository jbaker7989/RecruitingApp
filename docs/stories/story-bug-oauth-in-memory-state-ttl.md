# Story: In-memory OAuth state fallback does not enforce its TTL at validation

**Status:** Open
**Priority:** Medium
**Tracking ID:** NFR-075
**Created:** 2026-10-07 (NFR-071–074 edge-case review)

## Overview

When Redis is unavailable, OAuth state is stored in an in-memory map with a recorded
creation timestamp and a periodic cleanup job. `validateState` currently checks only
that an entry exists; it does not reject an entry whose timestamp is older than the
ten-minute state TTL. A state can therefore remain valid between expiry and the next
cleanup tick (and potentially longer if cleanup execution is delayed).

## Acceptance Criteria

1. In-memory state validation rejects and deletes records older than 600 seconds.
2. A regression test controls time (or injects a clock) and proves an expired state is
   rejected even before the cleanup interval runs.
3. Redis and in-memory state semantics remain equivalent for expiry, provider binding,
   and one-time consumption.

## Scope

- `src/services/oauthService.ts`
- OAuth regression tests
