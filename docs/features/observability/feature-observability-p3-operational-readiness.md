# OBS-001-P3: Correlation, SLOs, governance and external operational visibility

**Status:** Proposed — detailed backlog, not implemented
**Created:** 2026-10-18 | **Parent initiative:** [OBS-001](feature-opentelemetry-integration.md)
**Accountability:** Engineering delivery; Product approves objectives; Platform/Operations owns acceptance. Named assignments are decision-story outputs.
**Priority:** Required initiative phase; individual stories carry P0/P1/P2 priority and gate rationale.

## Objective and scope

Enable accountable detection, diagnosis, customer communication and recovery, with audit correlation, at least three approved SLOs, controlled telemetry cost and independent external visibility.

Audit-to-trace lookup; approved SLOs and alert routing; sampling/access/retention controls; external uptime and browser journeys; customer-facing status; release comparisons; incident drills and future capability decisions. Browser RUM is a policy decision; synthetic browser coverage and public status are required.

## Architecture and signal flow

```text
Full-population metrics → SLO evaluation → alert + owner + runbook
Audit event → retained trace / unavailable explanation → safe logs
Independent uptime + browser probes → incident review → public status service
All signals → privacy / retention / sampling / budget controls → readiness evidence
```

Backend/transport implementation remains a decision with proof requirements. This feature specifies behavior rather than assuming package defaults or a vendor plan.

## Feature acceptance criteria and story traceability

- [ ] **OBS-001-P3-AC1:** Existing audit entries are safely enriched with active details.trace_id; retained traces resolve for authorized users and missing/expired/unsampled traces have honest fallback behavior.
  Evidence supplied by: [OBS-P3-S01](../../stories/observability/story-obs-p3-s01-audit-correlation.md).

- [ ] **OBS-001-P3-AC2:** At least three approved, measurable SLOs have dashboards and tested actionable alerts, numerical targets/windows, owners and runbooks; all critical journeys have explicit coverage/disposition.
  Evidence supplied by: [OBS-P3-S02](../../stories/observability/story-obs-p3-s02-slo-decision.md), [OBS-P3-S03](../../stories/observability/story-obs-p3-s03-oncall-decision.md), [OBS-P3-S06](../../stories/observability/story-obs-p3-s06-slo-alerts.md).

- [ ] **OBS-001-P3-AC3:** Approved sampling, retention, access and signal-budget controls are enforced and tested, with coverage/drop/freshness visibility and no promise to recover head-dropped traces.
  Evidence supplied by: [OBS-P3-S04](../../stories/observability/story-obs-p3-s04-sampling-decision.md), [OBS-P3-S05](../../stories/observability/story-obs-p3-s05-sampling-governance.md).

- [ ] **OBS-001-P3-AC4:** Independent uptime and browser probes cover approved critical journeys and distinguish network/edge, application and telemetry failures using safe synthetic data.
  Evidence supplied by: [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md), [OBS-P3-S08](../../stories/observability/story-obs-p3-s08-outside-in-monitoring.md).

- [ ] **OBS-001-P3-AC5:** A customer-facing status service remains accessible during application outages, reports approved components/incidents/freshness and supports authorized incident/maintenance publishing with history.
  Evidence supplied by: [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md), [OBS-P3-S10](../../stories/observability/story-obs-p3-s10-customer-status.md).

- [ ] **OBS-001-P3-AC6:** Browser RUM has an explicit policy decision and either verified safe implementation or documented deferral with mandatory synthetic coverage and review trigger.
  Evidence supplied by: [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md), [OBS-P3-S09](../../stories/observability/story-obs-p3-s09-browser-experience.md).

- [ ] **OBS-001-P3-AC7:** Release comparisons expose latency/error/usage changes with adequate-data checks and a tested manual rollback investigation path.
  Evidence supplied by: [OBS-P3-S11](../../stories/observability/story-obs-p3-s11-release-regressions.md).

- [ ] **OBS-001-P3-AC8:** Future capability decisions have owners/revisit triggers and require concrete child stories before adoption; a game-day packet proves detection, diagnosis, communication and recovery without concealing open gates.
  Evidence supplied by: [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md), [OBS-P3-S13](../../stories/observability/story-obs-p3-s13-operational-game-day.md).

## Prioritized stories

| Story | Priority | Type | Release gate |
|---|---|---|---|
| [OBS-P3-S01](../../stories/observability/story-obs-p3-s01-audit-correlation.md): Link audit events to retained traces safely | P1 | Implementation | P3 audit correlation |
| [OBS-P3-S02](../../stories/observability/story-obs-p3-s02-slo-decision.md): Approve journey SLIs, SLOs, and error budgets | P1 | Decision | Before SLO/alert activation |
| [OBS-P3-S03](../../stories/observability/story-obs-p3-s03-oncall-decision.md): Assign operational ownership and escalation | P0 | Decision | Before production pages or public incident publishing |
| [OBS-P3-S04](../../stories/observability/story-obs-p3-s04-sampling-decision.md): Approve sampling, capacity, and signal budgets | P1 | Decision | Before steady-state production sampling is finalized |
| [OBS-P3-S05](../../stories/observability/story-obs-p3-s05-sampling-governance.md): Enforce sampling, access, retention, and cost controls | P1 | Implementation | P3 governance acceptance |
| [OBS-P3-S06](../../stories/observability/story-obs-p3-s06-slo-alerts.md): Implement SLO dashboards and actionable alerts | P1 | Implementation | P3 actionable SLOs |
| [OBS-P3-S07](../../stories/observability/story-obs-p3-s07-external-monitoring-decision.md): Specify browser, uptime, and customer-status monitoring | P1 | Decision | Before external checks or browser collection launch |
| [OBS-P3-S08](../../stories/observability/story-obs-p3-s08-outside-in-monitoring.md): Run independent uptime and browser journey probes | P1 | Implementation | P3 external visibility |
| [OBS-P3-S09](../../stories/observability/story-obs-p3-s09-browser-experience.md): Deliver approved browser experience and error visibility | P2 | Implementation / conditional | RUM decision closure; implementation required if approved |
| [OBS-P3-S10](../../stories/observability/story-obs-p3-s10-customer-status.md): Publish an independent customer-facing status service | P1 | Implementation | P3 customer visibility |
| [OBS-P3-S11](../../stories/observability/story-obs-p3-s11-release-regressions.md): Compare releases and guide rollback decisions | P1 | Implementation | P3 deploy safety |
| [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md): Track future observability capabilities and adoption triggers | P2 | Decision / backlog governance | P3 roadmap closure; does not block unrelated implementation |
| [OBS-P3-S13](../../stories/observability/story-obs-p3-s13-operational-game-day.md): Prove incident response and close acceptance | P1 | Verification | P3 exit / operational readiness |

## Delivery order and dependencies

Begin ownership and policy decisions early. After P2, resolve S02/S04; implement S01/S05/S06. S07 enables S08/S09/S10. Complete S11 and the S12 roadmap decisions; S13 validates all P3 outcomes.

Priorities do not override prerequisites. Independent later-phase decision stories may be resolved early. Local/synthetic development can proceed while business approval is outstanding, but the affected release gate cannot close. NFR-034 independently blocks production mutation traffic and durable audit acceptance; no phase's telemetry evidence removes that blocker.

## API and configuration impact

SLO definitions/windows/targets; paging routes and coverage hours; sampling/retention/RBAC; cost limits; probe regions/cadence/accounts; public-status components and approval rules; browser collection/consent; deployment markers. Keep integration secrets outside source control.

Existing application APIs retain their business contracts. Any added readiness/status integration must document its authentication and response contract in its implementing story; public status exposes only approved summaries. Internal telemetry query access is authorized through the selected backend.

## Verification and exit gate

Every feature AC above must map to passing story AC evidence: exact environment/revision, fixture/workload, expected and observed result, query or sanitized screenshot, and reviewer. Decision approvals must be recorded before dependent rollout. The [shared acceptance contract](README.md#shared-acceptance-contract) applies to all stories. Merging code or seeing one trace is insufficient evidence for metrics, privacy, alerts or outside-in coverage.

For application changes run `npm run typecheck`, `npm run build`, focused tests and `npm test` at the integrated phase gate. Test real preview delivery with synthetic data; no production applicant traffic is needed to validate a phase. Where a platform metric or integration is unavailable, record the limitation and remediation rather than manufacturing evidence.

## Boundaries and future work

No telemetry replacement for the business audit trail, no automatic production rollback, no required RUM without privacy approval, no guarantee of complete trace retention, and no real public incident publication during acceptance tests.

Future capabilities are owned by [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md); additional requirements discovered in delivery must receive a prioritized story and AC mapping before the scope is considered complete.

## Sizing

Estimate at story/task level after the blocking decisions and compatibility spike. The original 2–3 day estimate is not a commitment for this expanded scope. Separate active engineering effort, approval/provisioning lead time, baseline collection and operational validation. Split large implementation stories into focused tasks while preserving their AC IDs.
