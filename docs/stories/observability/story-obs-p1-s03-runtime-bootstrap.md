# OBS-P1-S03: Initialize telemetry in every supported runtime

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** P1 preview acceptance
**Decision coverage:** D05 runtime integration resolved by evidence

**Implementation status (2026-10-19):** implemented (`src/telemetry/*`, `src/index.ts`); see [adr-s03](../../features/observability/adr/adr-s03-runtime-bootstrap.md). Verified locally: versions, single init, request isolation, bounded failure/disable. **Preview-deployment parts of AC1–AC3 (cold/warm traces on Vercel) are PENDING**; automatic ioredis instrumentation is an explicit limitation (manual spans by S06).

## User story and operational question

As the platform engineer, I need evidence that answers: **Do we instrument the actual Node/Express entrypoint before dependencies load?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

The repository is Node 24, ESM, Express 5, with src/index.ts exporting app and a separate direct-execution guard. Validate compatibility rather than assuming a Next.js instrumentation convention applies.

## Acceptance criteria

- [ ] **OBS-P1-S03-AC1:** Record tested SDK/instrumentation versions and actual Vercel entrypoint; initialize once before Express, outbound HTTP/fetch, and ioredis modules in development, compiled Node startup, and preview deployment.
- [ ] **OBS-P1-S03-AC2:** An isolated request creates one server span with correct service, environment, release, and route template; outgoing fetch and Redis operations join its context without duplicate instrumentation.
- [ ] **OBS-P1-S03-AC3:** Cold and warm invocations preserve request isolation under concurrent load; importing app for tests does not start a listener or duplicate exporters.
- [ ] **OBS-P1-S03-AC4:** Missing/invalid exporter configuration yields a bounded sanitized diagnostic and documented disable behavior; initialization and shutdown do not hang application startup or request completion.

## Verification and completion evidence

Run npm run typecheck, npm run build, and focused bootstrap/concurrency tests; capture cold/warm preview traces and exact runtime/version evidence.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S01: Choose and prove a telemetry destination](story-obs-p1-s01-backend-decision.md)
- [OBS-P1-S02: Approve privacy, access, retention, and residency](story-obs-p1-s02-data-governance-decision.md)
- [OBS-P1-S04: Enforce safe attributes and propagation boundaries](story-obs-p1-s04-safe-telemetry-schema.md)

## Likely touchpoints

src/index.ts; package.json; proposed src/telemetry bootstrap; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
