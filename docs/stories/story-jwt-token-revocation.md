# Story: JWT Token Revocation List

**Status:** Backlog  
**Priority:** Low  
**Parent Story:** [story-production-token-patterns.md](./story-production-token-patterns.md) — Production Token Patterns

## Overview

JWTs are stateless and self-contained — once issued, they are valid until expiry. Without a revocation mechanism, a compromised or unwanted token remains usable until its natural expiry (8 hours for Users, 7 days for Applicants). This story adds a revocation list so that tokens can be invalidated immediately on logout, password change, or account lock.

The revocation list is backed by Redis for O(1) lookup and millisecond-scale invalidation.

## Current Behavior

- JWTs issued per the parent story have an `exp` claim
- No revocation mechanism exists — logout and password changes do not invalidate active tokens
- Token validity is determined solely by signature + expiry

## Desired Behavior

1. On logout, the current token's `jti` (JWT ID) is added to the revocation list with TTL = remaining token lifetime
2. On password change or account lock, all active tokens for that user/applicant are revoked by adding their `jti` values to the revocation list
3. On every authenticated request, the JWT's `jti` is checked against the revocation list before trusting the token
4. Revoked tokens return `401 Unauthorized` even if signature and expiry are valid
5. Revoked entries expire from Redis automatically (TTL-based cleanup) — no manual garbage collection

## Acceptance Criteria

1. `jti` claim is included in all JWTs issued (both User and Applicant tokens)
2. `POST /api/auth/logout` adds the current token's `jti` to the revocation list with TTL = `exp - now`
3. `POST /api/applicants/logout` adds the current token's `jti` to the revocation list with TTL = `exp - now`
4. `PATCH /api/auth/me` (password change) and `PATCH /api/applicants/me` (password change) revoke the current token immediately
5. Token verification middleware checks Redis revocation list before trusting the JWT
6. Revoked token returns `401 { error: "Token has been revoked" }`
7. Redis entries auto-expire — no persistent growth of revocation list
8. If Redis is unavailable, tokens are accepted without revocation check (graceful degradation, logged as a warning) — this prevents Redis single-point-of-failure from locking all users out

## Technical Notes

- Use Redis `SETEX` or `SET key value EX ttl` to add revoked `jti` with TTL
- Use Redis `EXISTS` or `GET` to check revocation status
- `jti`: use `crypto.randomUUID()` or `crypto.randomBytes(16).toString('hex')` when signing
- For bulk revocation (revoke all sessions for a user): maintain a per-user set of active `jti` values, delete the set on bulk revoke — simpler than enumerating tokens from JWT `jti` alone
- Consider adding `iss` (issuer) and `aud` (audience) to JWT claims to prevent cross-service token reuse
- Observability: log each revocation event with `jti`, `userId`/`applicantId`, and reason

## Data Model

### Redis Keys

```
revoked:jti:<jti>                    → "1" (TTL = remaining token lifetime)
active-jti:user:<userId>             → SET of active jti values for this user
active-jti:applicant:<applicantId>  → SET of active jti values for this applicant
```

## Migration Notes

- Existing JWTs without `jti` cannot be revoked — schedule a强制 re-authentication campaign post-launch
- Add `jti` to all new tokens immediately when this story ships
- During the migration window, tokens without `jti` are accepted but not revocable (log a warning on each use)

## Dependencies

- Parent story: [story-production-token-patterns.md](./story-production-token-patterns.md) — JWT infrastructure must issue `jti` claims before revocation is possible
- Redis instance (or Redis-compatible store like Upstash, Valkey)
- `ioredis` or `redis` npm package for Node.js Redis client
- Redis connection configuration via environment variables
