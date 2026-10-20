# OBS-P2-S09: Observe agent steps and business outcomes

**Status:** Implementation complete (dev2) — awaiting tester verification
**Phase:** P2 | **Type:** Implementation | **Priority:** P1
**Priority rationale:** Required for the agreed phase outcome and operational coverage.
**Accountable role:** AI/backend engineer (named assignee pending)
**Created:** 2026-10-18
**Parent feature:** [OBS-001-P2](../../features/observability/feature-observability-p2-ai-custom-telemetry.md)
**Release gate:** P2 agent coverage
**Decision coverage:** None

## User story and operational question

As the ai/backend engineer, I need evidence that answers: **Which workflow step stalled, retried, fell back, or completed only partially?** This lets the team make a support, delivery, or operational decision from observable behavior.

## Scope and intended behavior

Instrument the current scheduling state machine and existing chain/batch workflows. Do not introduce LangGraph solely to match the proposal.

## Acceptance criteria

- [ ] **OBS-P2-S09-AC1:** Execution and step spans carry safe workflow/version, step, entry point, attempt, outcome and run correlation; simulated calendar/email work is explicitly distinguished from live integrations.
- [ ] **OBS-P2-S09-AC2:** Active execution, waiting for a user/provider, total workflow age, cancellation, and terminal outcome have separate definitions; no long-lived span is kept open for human waiting.
- [ ] **OBS-P2-S09-AC3:** Caught semantic-matching fallback, partial batch success, invalid state transition, and terminal failure are visible even when HTTP status is 200.
- [ ] **OBS-P2-S09-AC4:** Continuation/replay paths use approved persisted context/span links where they exist, preserve privacy, and avoid duplicate completion counts; unavailable durable continuation is recorded as a future dependency.

## Implementation notes (dev2)

- `src/agents/scheduling/agent.ts`: `execute` wrapped in `scheduling.execute`, each `node` call in `scheduling.step`; `transition` wrapped in `scheduling.transition`.
- `app.traffic=synthetic` on all scheduling spans — explicitly marks simulated calendar/email work (AC1).
- `app.attempt` carries `retryCount + 1` for step spans, allowing retry visibility (AC1).
- No span kept open across human waiting: spans only cover active code execution (AC2).
- Invalid transition throws unchanged — error type recorded in span, visible to analyst (AC3).
- Caught fallback in matching chain (semantic score=0) recorded in vectorstore span even with HTTP 200 response (AC3).
- Durable continuation (resume across process restart): not available in current state machine; documented as future dependency (AC4).
- Replay dedup: scheduling steps are deterministic local state machines; no external durable continuation means replay completion dedup is not applicable in current implementation (AC4).

## Verification and completion evidence

Exercise scheduling transitions, cancellation, invalid transition, semantic fallback, and partial rebuild failure; verify run/step relationship and truthful simulated labels.

Record expected and observed results, environment/revision, sanitized query or artifact links, and reviewer against every AC ID. Implementation stories also run `npm run typecheck`, `npm run build`, and the relevant repository tests (`npm test` for the integrated regression gate). Decision stories are done only when the decision record contains an approver, date, rationale, concrete values where required, and downstream story updates. Unknown values keep the affected gate open; time passing is not approval.

## Dependencies

- [OBS-P2-S01: Map critical journeys and duration semantics](story-obs-p2-s01-journey-instrumentation-contract.md)
- [OBS-P2-S02: Trace chat/model invocations and failures](story-obs-p2-s02-llm-spans.md)
- [OBS-P2-S07: Measure vector-store operations](story-obs-p2-s07-pinecone-spans.md)
- [OBS-P2-S08: Expose store and audit-write latency](story-obs-p2-s08-store-spans.md)

## Likely touchpoints

src/agents/scheduling/agent.ts; src/chains/matching.ts; agent routes; tests. These are investigation targets, not a claim that proposed modules already exist. Split implementation into independently verifiable tasks if discovery exceeds a focused slice; retain this story's AC traceability.

## Boundaries

Use synthetic data for acceptance. Never copy applicant records, secrets, prompts, completions or raw audit payloads into evidence. Observability must not change business behavior, introduce new external product integrations, or imply that NFR-034 is resolved. Follow the [shared acceptance contract](../../features/observability/README.md#shared-acceptance-contract) and this story's explicit scope exceptions.
