# OBS-P2-S04: Measure token usage without false precision

**Status:** Proposed — not implemented
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** AI engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 usage acceptance
**Decision coverage:** None

## User story and operational question

As the ai engineer, I need evidence that answers: **How many tokens did each feature use, and how complete is that measurement?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Normalize provider-reported input/output/cache/reasoning categories where supported, keeping non-equivalent categories explicit.

## Acceptance criteria

- [ ] **OBS-P2-S04-AC1:** Publish token counters by bounded feature/provider/model/token category and usage source; document units and provider-specific category overlap to avoid double counting.
- [ ] **OBS-P2-S04-AC2:** Metrics count reported usage independently of trace sampling and count each observed billed attempt once, including failed/retried calls when usage is supplied.
- [ ] **OBS-P2-S04-AC3:** Missing usage increments a separate coverage/unknown counter; reports show known totals and coverage rather than converting unknown values to zero.
- [ ] **OBS-P2-S04-AC4:** Known synthetic provider responses reconcile exactly to token totals; tool/chain hooks cannot report the same call twice; current non-streaming paths are covered and streaming is tracked in the future-capability decision.

## Verification and completion evidence

Reconcile deterministic OpenAI/Anthropic/embedding usage fixtures including absent usage and overlapping cache categories, with traces sampled and unsampled.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S02: Trace chat/model invocations and failures](story-obs-p2-s02-llm-spans.md)
- [OBS-P2-S03: Observe embedding operations](story-obs-p2-s03-embedding-usage.md)

## Likely touchpoints

proposed usage normalizer; AI invocation wrappers; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.

## Local synthetic delivery status (2026-10-20)

Implementation and evidence are tracked in [P2 coverage](../../features/observability/p2-test-coverage.md) and [execution plan](../../../tasks/observability-p2-plan.md). Local implementation does not close decision approval or live-provider/hosted gates.
