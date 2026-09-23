# Story: Production Token Patterns — JWT for Authenticated Flows

**Status:** Done — implemented NFR-050 (10/10 tests passing)

> Implementation: `src/services/tokenService.ts`, `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/routes/applicants.ts`
> Not yet implemented: asymmetric signing (RS256), refresh tokens, token revocation list, OAuth/social login, Applicant magic-link email  
**Priority:** High  
**Created:** Phase 1 gap review

## Overview

Currently both Users and Applicants authenticate using a simple opaque string token (`Bearer <id>`) — the raw `id` from the store, with no expiry, no signature, and no claims. This is acceptable for a prototype but introduces serious security and operational gaps for production:

- **No expiry** — tokens never expire, cannot be revoked without a store mutation
- **No signature** — any client can forge a token by guessing/cycling IDs
- **No role claims** — the server must re-read the store on every request to determine identity and role
- **No audience separation** — the same token format is used for Users and Applicants, making it easy to confuse the two
- **No refresh mechanism** — active sessions cannot be extended silently

The fix is to replace opaque tokens with signed JWTs, with different configurations per audience.

## Current Behavior

Both `POST /api/auth/login` and `POST /api/applicants/login` return a simple token:

```json
{ "token": "abc123" }
```

The token is the raw `user.id` or `applicant.id` (an 8-char alphanumeric string).  
Every protected endpoint reads the token, queries the store, and attaches the entity — no cryptographic verification occurs.

## Desired Behavior

### Users (Recruiters, Hiring Managers, Member Services, Admins)

```
POST /api/auth/login
  → { "token": "<jwt>", "expiresIn": 28800 }   // 8-hour JWT, RS256/ES256 signed
```

- Short-lived (8 hours), stored in `HttpOnly` cookie or memory
- Contains `sub` (user.id), `role`, `companyId`, `iat`, `exp`
- Signed with asymmetric key (RS256) or HMAC (HS256 with rotated secret)
- Refresh token (opaque, 30-day) optionally issued for "remember me"
- Token revocation list stored in Redis or DB for immediate logout

### Applicants (External Job Seekers)

```
POST /api/applicants/login
  → { "token": "<jwt>", "expiresIn": 604800 }  // 7-day JWT

POST /api/applicants/register
  → { "token": "<jwt>", "expiresIn": 604800 }  // auto-login after registration
```

- Longer-lived (7 days) — applicants browse, apply, return days later
- Contains `sub` (applicant.id), `hasCredentials`, no role
- Optionally supports refresh tokens for session persistence
- Social login (Google, LinkedIn) via OAuth 2.0 / OIDC — JWT issued by IdP or exchanged for app JWT
- Magic-link email login for applicants without social credentials

### Token Comparison

| Property | Users | Applicants |
|---|---|---|
| Format | JWT | JWT |
| Signing | RS256 (asymmetric) | HS256 (symmetric, per-app secret) |
| Expiry | 8 hours | 7 days |
| Refresh | Opaque 30-day refresh token | Optional refresh token |
| Claims | `sub`, `role`, `companyId` | `sub`, `hasCredentials` |
| Storage | `HttpOnly` cookie | Memory or `localStorage` |
| Revocation | Revocation list | Revocation list (optional) |

## Acceptance Criteria

1. **Users** receive a short-lived JWT on login, signed with an asymmetric key or rotated HMAC secret
2. **Applicants** receive a longer-lived JWT on login or register, with `hasCredentials` claim
3. JWT signature is verified on every protected request — invalid/expired tokens return `401`
4. Both audiences can be identified from a decoded token without a store lookup (identity) or with one store lookup (authorization/role)
5. Expired tokens are rejected, even if the ID is valid
6. Token revocation invalidates a token before its natural expiry (e.g., logout, password change, account lock)
7. Observability: token issued, token verified (success), token rejected (reason logged)

## Migration Path

To avoid a hard cutover that invalidates all existing sessions:

1. Introduce JWT as a new token format; accept both old and new during a migration window
2. After migration window, deprecate and remove the old opaque token format
3. All existing sessions will need to re-authenticate post-migration

## Technical Notes

- Use `jose` (Node.js stdlib-compatible) or `jsonwebtoken` for signing/verification
- Key management: store signing keys in environment variables or a secrets manager (AWS Secrets Manager, Vault)
- Rotate signing keys annually or immediately on suspected compromise
- JWT expiry (`exp`) must be enforced, not just checked at the application layer
- Do not store sensitive data (PII, password hash) in JWT payload — it is readable on the client
- Consider short-lived access tokens + longer-lived refresh tokens for Users (OAuth 2.0 pattern)

## Dependencies

- `jose` or `jsonwebtoken` package
- Secrets manager or secure env var injection for signing keys
- Optional: Redis for token revocation list
- Optional: OAuth 2.0 / OIDC integration for Applicant social login (Google, LinkedIn)
