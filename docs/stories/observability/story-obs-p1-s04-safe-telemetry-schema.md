# OBS-P1-S04: Enforce safe attributes and propagation boundaries

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Implementation | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Platform engineer + security reviewer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** Before the first exported span/log/metric
**Decision coverage:** None

**Implementation status (2026-10-19):** sanitizing exporters + schema implemented; see [adr-s04](../../features/observability/adr/adr-s04-safe-schema.md). Canary tests cover spans, links/tracestate, scope, resource, metrics, diagnostics. **AC1 'approved' allow-list is PENDING S02 approval.**

## User story and operational question

As the platform engineer + security reviewer, I need evidence that answers: **Can instrumentation leak applicant content or credentials?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Apply privacy controls before P1 export; P3 expands governance and verifies it continuously. Cover automatic instrumentation as well as manual wrappers.

## Acceptance criteria

- [ ] **OBS-P1-S04-AC1:** Implement the approved allow-list, bounded lengths, route templates, controlled error categories, and resource attributes; filter auto-captured URLs, headers, exceptions, and Redis commands before export.
- [ ] **OBS-P1-S04-AC2:** Canary resumes, emails, tokens, OAuth codes/state, raw URLs, and model output are absent from every exported signal and exporter diagnostic in success and failure fixtures.
- [ ] **OBS-P1-S04-AC3:** Validate inbound trace/request context and bound its size; document trusted-parent policy and prevent arbitrary client input from forcing unlimited sampling or becoming an unbounded metric label.
- [ ] **OBS-P1-S04-AC4:** Outbound context propagation is allow-listed by destination; strip baggage and sensitive headers at untrusted boundaries while retaining local client spans for visibility.
- [ ] **OBS-P1-S04-AC5:** Raw exception content is never exported merely because a span records an exception; specifically cover resume parsing errors that embed model output in src/chains/resumeParsing.ts.

## Verification and completion evidence

Inspect captured exporter payloads using adversarial canaries, malformed trace headers, and denied destinations; zero prohibited values is the pass condition.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P1-S02: Approve privacy, access, retention, and residency](story-obs-p1-s02-data-governance-decision.md)

## Likely touchpoints

proposed src/telemetry schema/filtering; src/chains/resumeParsing.ts; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
