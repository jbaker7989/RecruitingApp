# OBS-P1-S06: Trace outbound HTTP, OAuth, and Redis

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** Backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 complete baseline coverage
**Decision coverage:** None

## User story and operational question

As the backend engineer, I need evidence that answers: **Is login failing in our code, OAuth token exchange, userinfo, or state storage?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Instrument existing provider operations and distinguish local failures from remote failures; a client span does not expose a third party’s internal execution.

## Acceptance criteria

- [ ] **OBS-P1-S06-AC1:** Token exchange and userinfo have separate safe operation names and client spans under the initiating server trace; Redis operations have duration/outcome without keys, arguments, or values.
- [ ] **OBS-P1-S06-AC2:** Provider metrics distinguish timeout, DNS/connect/TLS failure, 429, 5xx, invalid configuration, user cancellation, invalid state, and application validation using a bounded taxonomy.
- [ ] **OBS-P1-S06-AC3:** Logical login outcome and each outbound attempt are counted separately; retries and eventual recovery are visible without classifying recovered attempts as separate failed user logins.
- [ ] **OBS-P1-S06-AC4:** Redis unavailable/in-memory fallback and expired/missing OAuth state are visible as operational outcomes; no change to existing security/fallback behavior is implied.
- [ ] **OBS-P1-S06-AC5:** An OAuth redirect/callback is not falsely represented as one uninterrupted server request; approved opaque correlation or span links connect the journey without storing OAuth state or tokens.

## Verification and completion evidence

Exercise successful login, user denial, invalid state, Redis outage, provider timeout, and 429 with stubs; inspect one permitted real preview provider exchange.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S03: Initialize telemetry in every supported runtime](story-obs-p1-s03-runtime-bootstrap.md)
- [OBS-P1-S05: Measure request rate, errors, and duration](story-obs-p1-s05-http-red-metrics.md)

## Likely touchpoints

src/services/oauthService.ts; OAuth routes; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
