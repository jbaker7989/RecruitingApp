# OBS-P1-S02: Approve privacy, access, retention, and residency

**Status:** Proposed — not implemented
**Phase:** P1 | **Type:** Decision | **Priority:** P0
**Priority rationale:** Blocks safe collection, trustworthy delivery, or accountable production operation.
**Accountable role:** Security/privacy owner + platform lead (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P1](../../features/observability/feature-observability-p1-baseline-tracing.md)
**Release gate:** Before any applicant or production data can enter telemetry
**Decision coverage:** D03 data policy, D04 access and residency

**Implementation status (2026-10-19):** proposed allow-list/prohibited list/identifier policy and verification checklist in [adr-s02](../../features/observability/adr/adr-s02-data-governance.md). **AC2 (retention, region, RBAC, approver) and approval for AC1/AC3 are PENDING.** Production/applicant data stays blocked.

## User story and operational question

As the security/privacy owner + platform lead, I need evidence that answers: **Who may see telemetry, where may it live, and for how long?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Define telemetry data classes separately from the business audit trail. This is a policy decision, not a declaration of legal compliance.

## Acceptance criteria

- [ ] **OBS-P1-S02-AC1:** Approve a field allow-list and prohibited-content list covering resumes, prompts/responses, emails, credentials, cookies, OAuth code/state, query strings, Redis keys/values, and exception text/stack content.
- [ ] **OBS-P1-S02-AC2:** Record numerical retention and deletion periods per signal, export region and backup/subprocessor boundaries, permitted environments, and role-based read/admin permissions; assign a named approver.
- [ ] **OBS-P1-S02-AC3:** Define request/run/trace identifiers, any permitted pseudonymous lookup, access auditing, deletion/incident handling, and cross-boundary header/baggage policy; prohibit applicant identifiers in metric labels.
- [ ] **OBS-P1-S02-AC4:** Create a verification checklist for access denial, retention expiry, and PII canaries; if decisions are unresolved, only synthetic isolated development data is allowed and production export is blocked.

## Verification and completion evidence

Review a sample schema and synthetic payload against policy; attach approval and testable policy values.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

None; can start immediately.

## Likely touchpoints

proposed telemetry schema; backend access settings. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
