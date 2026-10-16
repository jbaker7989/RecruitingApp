# Security

This directory contains security hardening features — cross-cutting work that
reduces the application's attack surface rather than delivering end-user
functionality. Stories here originate from security reviews (see `BUGS.md`
`NFR-0XX` tracking IDs) and are grouped into features by the subsystem they
harden.

## Available Features

- **[OAuth Security Hardening](./feature-oauth-security-hardening.md)** (`SEC-OAUTH-001`) —
  Close the gaps surfaced by the security review of the applicant social-login
  flow (branch `bugs/oauth-login-fixes`). Covers token verification, state-store
  expiry parity, and regression guardrails for the login/callback surface.

## Sizing legend

T-shirt sizes used across security stories:

| Size | Rough effort | Meaning |
|------|--------------|---------|
| XS | < 1h | One-line / config change, trivially testable |
| S | 1–3h | Localized change + a focused regression test |
| M | 3–6h (½ day) | New dependency/integration wiring + tests across providers |
| L | 1–2 days | Cross-cutting change touching multiple modules + broad tests |

## Priority legend

Aligned with `BUGS.md`: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low/Hygiene.
`P1`–`P3` denote execution order within this feature.
