# OBS-P2-S10: Deliver end-to-end duration and dependency investigation

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Verification / dashboard | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** QA + platform engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 exit
**Decision coverage:** None

## User story and operational question

As the qa + platform engineer, I need evidence that answers: **Can we explain a slow or failed critical journey from the available telemetry?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Provide saved queries and a dependency dashboard connecting route/feature metrics to representative traces and safe logs.

## Acceptance criteria

- [ ] **OBS-P2-S10-AC1:** For critical journeys show request/logical-operation p50/p95/p99, count, failure/degraded rate and dependency latency; explain parallel versus serial time and avoid summing overlapping child spans.
- [ ] **OBS-P2-S10-AC2:** A controlled slow LLM, slow store, Pinecone timeout, malformed model output, and caught fallback can each be localized from telemetry alone; only real calls appear in the trace.
- [ ] **OBS-P2-S10-AC3:** Feature token totals/cost coverage and release comparisons are available; missing/sampled traces or sparse data are clearly identified rather than treated as proof of health.
- [ ] **OBS-P2-S10-AC4:** P2 evidence maps every feature criterion to a story and includes saved query, dataset/deployment revision, expected/observed outcome, and privacy verification.

## Verification and completion evidence

An independent engineer diagnoses the fixture scenarios using the dashboard and records the responsible component and measured duration.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S06: Publish feature usage and estimated-cost reports](story-obs-p2-s06-cost-dashboard.md)
- [OBS-P2-S07: Measure vector-store operations](story-obs-p2-s07-pinecone-spans.md)
- [OBS-P2-S08: Expose store and audit-write latency](story-obs-p2-s08-store-spans.md)
- [OBS-P2-S09: Observe agent steps and business outcomes](story-obs-p2-s09-agent-workflow-spans.md)

## Likely touchpoints

proposed dashboard definitions; docs/runbooks; acceptance fixtures. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
