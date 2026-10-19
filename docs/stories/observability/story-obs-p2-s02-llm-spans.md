# OBS-P2-S02: Trace chat/model invocations and failures

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** AI engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 AI coverage
**Decision coverage:** None

## User story and operational question

As the ai engineer, I need evidence that answers: **Which model call or retry consumed time or failed?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Instrument actual chat invocation boundaries across all active chains, using safe provider/model/task attributes and preserving original application behavior.

## Acceptance criteria

- [ ] **OBS-P2-S02-AC1:** Each logical LLM operation has correlated attempt spans with duration, actual provider/model, operation, feature, and bounded outcome; successes, errors, aborts, and timeouts always end spans.
- [ ] **OBS-P2-S02-AC2:** SDK-internal retries are measured where exposed; any unobservable retry behavior is documented rather than inventing attempt counts.
- [ ] **OBS-P2-S02-AC3:** Provider success followed by JSON/schema validation failure is distinguishable from provider failure; request root reflects the final application outcome.
- [ ] **OBS-P2-S02-AC4:** No prompt, completion, resume text, model-returned PII, or raw exception content appears in exported events; instrumentation never swallows or replaces application exceptions.

## Verification and completion evidence

Use fake successful, delayed, retrying, malformed-output, rejected, and aborted model responses; verify span parentage/status/lifetime and unchanged caller results.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md)

## Likely touchpoints

src/services/llm/index.ts; src/chains/resumeParsing.ts; other active chains; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
