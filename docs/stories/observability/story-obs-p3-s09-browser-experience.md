# OBS-P3-S09: Deliver approved browser experience and error visibility

**Status:** Proposed — not implemented
**Phase:** P3 | **Type:** Implementation / conditional | **Priority:** P2
**Priority rationale:** Planned enhancement or roadmap decision; conditional delivery is stated explicitly.
**Accountable role:** Frontend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P3](../../features/observability/feature-observability-p3-operational-readiness.md)
**Release gate:** RUM decision closure; implementation required if approved
**Decision coverage:** None

## User story and operational question

As the frontend engineer, I need evidence that answers: **Are real browsers experiencing failures or slowness that server duration cannot explain?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

If RUM is approved, implement privacy-safe navigation/performance and frontend-error measurement. Otherwise record the decision and rely on mandatory synthetic browser monitoring, with a future review date.

## Acceptance criteria

- [ ] **OBS-P3-S09-AC1:** An approved RUM path measures defined navigation/rendering responsiveness and JS/network errors by bounded page template, environment and release, with explicit sampling/consent rules.
- [ ] **OBS-P3-S09-AC2:** No form values, DOM contents, replay recordings, resume text, full URLs, identifiers, or credentials are captured; cross-origin trace correlation is limited to trusted application endpoints.
- [ ] **OBS-P3-S09-AC3:** Document client-versus-server timing, browser support and missing/blocked measurements; dashboards do not equate absent RUM with zero errors.
- [ ] **OBS-P3-S09-AC4:** Test client error, slow resource, blocked collector, consent refusal, and client-to-server correlation; if RUM is declined, attach approved rationale, synthetic coverage and revisit trigger rather than pretending it was implemented.

## Verification and completion evidence

Validate browser fixtures and exported payloads if approved; otherwise validate the signed decision and linked alternative evidence.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P3-S07: Specify browser, uptime, and customer-status monitoring](story-obs-p3-s07-external-monitoring-decision.md)
- [OBS-P1-S04: Enforce safe attributes and propagation boundaries](story-obs-p1-s04-safe-telemetry-schema.md)

## Likely touchpoints

views; public browser assets; proposed frontend telemetry; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
