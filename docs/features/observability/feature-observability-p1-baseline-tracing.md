# OBS-001-P1: Baseline tracing and operational signals

**Status:** Local implementation and tests complete for review; policy, performance and hosted acceptance remain open
**Created:** 2026-10-18 | **Parent initiative:** [OBS-001](feature-opentelemetry-integration.md)
**Accountability:** Engineering delivery; Product approves objectives; Platform/Operations owns acceptance. Named assignments are decision-story outputs.
**Priority:** Required initiative phase; individual stories carry P0/P1/P2 priority and gate rationale.

## Objective and scope

Give engineers a safe, searchable baseline for request duration, failures, outbound dependencies and runtime health in a real preview deployment. Establish evidence that the telemetry pipeline works before expanding instrumentation.

Node/Express bootstrap, HTTP/fetch/Redis coverage, request metrics, structured operational logs, runtime health, privacy and export reliability. Includes backend, funding and data-policy decisions. Does not require waiting for AI wrappers or durable audit migration.

## Architecture and signal flow

```text
Request → trusted context / request ID → Express handler → outbound HTTP / Redis
                         ↓ spans + RED metrics + safe logs
                  bounded exporters → approved backend → baseline dashboard
```

Backend/transport implementation remains a decision with proof requirements. This feature specifies behavior rather than assuming package defaults or a vendor plan.

## Feature acceptance criteria and story traceability

- [ ] **OBS-001-P1-AC1:** A real preview request has a correctly parented Express server span and outbound HTTP/Redis spans where those calls actually occur; cold/warm and concurrent requests remain isolated.
  Evidence supplied by: [OBS-P1-S03](../../stories/observability/story-obs-p1-s03-runtime-bootstrap.md), [OBS-P1-S06](../../stories/observability/story-obs-p1-s06-outbound-oauth-redis.md).

- [ ] **OBS-001-P1-AC2:** Request rate, error rate and p50/p95/p99 duration are queryable from an explicit full-population metrics pipeline with bounded dimensions and documented exclusions.
  Evidence supplied by: [OBS-P1-S05](../../stories/observability/story-obs-p1-s05-http-red-metrics.md).

- [ ] **OBS-001-P1-AC3:** Hosted telemetry has approved destination, cost owner, retention/residency and access policy; sensitive canary payloads are absent from every exported signal.
  Evidence supplied by: [OBS-P1-S01](../../stories/observability/story-obs-p1-s01-backend-decision.md), [OBS-P1-S02](../../stories/observability/story-obs-p1-s02-data-governance-decision.md), [OBS-P1-S04](../../stories/observability/story-obs-p1-s04-safe-telemetry-schema.md).

- [ ] **OBS-001-P1-AC4:** Exporter failure is bounded and does not break user traffic; preview measurements meet approved numerical overhead/delivery budgets and expose loss or stale signals.
  Evidence supplied by: [OBS-P1-S07](../../stories/observability/story-obs-p1-s07-export-reliability.md).

- [ ] **OBS-001-P1-AC5:** An engineer can find a failed request in structured logs, distinguish readiness/dependency/runtime pressure from telemetry outage, and filter by environment/release.
  Evidence supplied by: [OBS-P1-S08](../../stories/observability/story-obs-p1-s08-operational-logs.md), [OBS-P1-S09](../../stories/observability/story-obs-p1-s09-health-runtime.md).

- [ ] **OBS-001-P1-AC6:** A reproducible baseline evidence packet covers every criterion, actual instrumentation inventory and unsupported paths without claiming automatic universal coverage.
  Evidence supplied by: [OBS-P1-S10](../../stories/observability/story-obs-p1-s10-baseline-acceptance.md).

## Prioritized stories

| Story | Priority | Type | Release gate |
|---|---|---|---|
| [OBS-P1-S01](../../stories/observability/story-obs-p1-s01-backend-decision.md): Choose and prove a telemetry destination | P0 | Decision / spike | Before shared or production telemetry export |
| [OBS-P1-S02](../../stories/observability/story-obs-p1-s02-data-governance-decision.md): Approve privacy, access, retention, and residency | P0 | Decision | Before any applicant or production data can enter telemetry |
| [OBS-P1-S03](../../stories/observability/story-obs-p1-s03-runtime-bootstrap.md): Initialize telemetry in every supported runtime | P0 | Implementation | P1 preview acceptance |
| [OBS-P1-S04](../../stories/observability/story-obs-p1-s04-safe-telemetry-schema.md): Enforce safe attributes and propagation boundaries | P0 | Implementation | Before the first exported span/log/metric |
| [OBS-P1-S05](../../stories/observability/story-obs-p1-s05-http-red-metrics.md): Measure request rate, errors, and duration | P0 | Implementation | P1 preview acceptance |
| [OBS-P1-S06](../../stories/observability/story-obs-p1-s06-outbound-oauth-redis.md): Trace outbound HTTP, OAuth, and Redis | P1 | Implementation | P1 complete baseline coverage |
| [OBS-P1-S07](../../stories/observability/story-obs-p1-s07-export-reliability.md): Prove serverless export and fail-open behavior | P0 | Implementation / verification | P1 hosted release |
| [OBS-P1-S08](../../stories/observability/story-obs-p1-s08-operational-logs.md): Create structured operational logs with context | P1 | Implementation | P1 diagnosability |
| [OBS-P1-S09](../../stories/observability/story-obs-p1-s09-health-runtime.md): Observe health and runtime resource pressure | P1 | Implementation | P1 operational dashboard |
| [OBS-P1-S10](../../stories/observability/story-obs-p1-s10-baseline-acceptance.md): Accept the baseline with reproducible evidence | P1 | Verification | P1 exit |

## Delivery order and dependencies

Start S01 and S02; implement S04 before export; S03 then S05; complete S06–S09 and S10 acceptance. Decision work for later phases may start early when evidence is sufficient.

Priorities do not override prerequisites. Independent later-phase decision stories may be resolved early. Local/synthetic development can proceed while business approval is outstanding, but the affected release gate cannot close. NFR-034 independently blocks production mutation traffic and durable audit acceptance; no phase's telemetry evidence removes that blocker.

## API and configuration impact

Service/environment/release identity; per-signal endpoint/transport/authentication; feature enable/disable; exporter timeout/buffer/retry settings; approved privacy/propagation schema; temporary sampling configuration with measured coverage. Secrets reside in deployment secret management, never these documents.

Existing application APIs retain their business contracts. Any added readiness/status integration must document its authentication and response contract in its implementing story; public status exposes only approved summaries. Internal telemetry query access is authorized through the selected backend.

## Verification and exit gate

Every feature AC above must map to passing story AC evidence: exact environment/revision, fixture/workload, expected and observed result, query or sanitized screenshot, and reviewer. Decision approvals must be recorded before dependent rollout. The [shared acceptance contract](README.md#shared-acceptance-contract) applies to all stories. Merging code or seeing one trace is insufficient evidence for metrics, privacy, alerts or outside-in coverage.

For application changes run `npm run typecheck`, `npm run build`, focused tests and `npm test` at the integrated phase gate. Test real preview delivery with synthetic data; no production applicant traffic is needed to validate a phase. Where a platform metric or integration is unavailable, record the limitation and remediation rather than manufacturing evidence.

## Boundaries and future work

No AI cost estimates yet; no promise of third-party internal spans; no production audit durability claim; no arbitrary new public metrics endpoint.

Future capabilities are owned by [OBS-P3-S12](../../stories/observability/story-obs-p3-s12-future-capabilities-decision.md); additional requirements discovered in delivery must receive a prioritized story and AC mapping before the scope is considered complete.

## Sizing

Estimate at story/task level after the blocking decisions and compatibility spike. The original 2–3 day estimate is not a commitment for this expanded scope. Separate active engineering effort, approval/provisioning lead time, baseline collection and operational validation. Split large implementation stories into focused tasks while preserving their AC IDs.
