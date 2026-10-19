# OBS-P1-S01: Choose and prove a telemetry destination

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Decision / spike | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Platform lead + budget owner (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** Before shared or production telemetry export
**Decision coverage:** D01 backend, D02 budget/ownership

**Implementation status (2026-10-19):** local option A stack + proof script delivered; ADR [adr-s01](../../features/observability/adr/adr-s01-telemetry-destination.md) lists proposed options. **AC1 (approver/plan/region), AC3 (cap), AC4 (approval) are PENDING and require named humans; AC2 is satisfied only for the local synthetic stack, not a hosted destination.** Story remains Blocked for hosted export.

## User story and operational question

As the platform lead + budget owner, I need evidence that answers: **Where can authorized engineers query each required signal, at an approved cost?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Evaluate one primary backend and any necessary companion services against traces, metrics, searchable logs, dashboards, SLO alerts, outside-in monitoring, and customer status needs. Vendor selection is unknown; an integration being available is not evidence of an account, entitlement, or approval.

Isolated synthetic proof-of-capability exports are permitted during this spike under the shared safety contract; they do not authorize applicant data, ongoing paid ingestion, or shared/production rollout.

## Acceptance criteria

- [ ] **OBS-P1-S01-AC1:** Record an ADR comparing viable options with exact plan/region, supported signal ingest and query paths, OTLP transport/authentication, retention, RBAC, alert integrations, quotas, and gaps; select an accountable service owner and approver.
- [ ] **OBS-P1-S01-AC2:** Using synthetic data only, demonstrate one trace, one histogram query, and one structured log lookup in the proposed destination; record whether metrics/logs require separate exporters or services.
- [ ] **OBS-P1-S01-AC3:** Estimate monthly ingestion, storage, query, egress, synthetic-check, and status-page charges at expected and 10x traffic; identify input assumptions and a numerical approved monthly cap with warning thresholds.
- [ ] **OBS-P1-S01-AC4:** Approval records selected destination(s), funding, provisioning owner, fallback/export strategy, and a review date; absent approval the story remains Blocked and shared/production export remains disabled.

## Verification and completion evidence

Attach ADR, sanitized proof-of-query evidence, and cost worksheet; another engineer reproduces the three queries.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

None; can start immediately.

## Likely touchpoints

package.json; deployment settings; proposed telemetry configuration. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
