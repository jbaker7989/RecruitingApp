# Bug Story: Honor requested interview duration

**Tracking ID:** NFR-080
**Status:** Complete (QA passed; local only)
**Priority:** Medium (P2)
**Size:** S (1–3h)
**Created:** 2026-10-22
**Resolved:** 2026-10-27
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

A caller requesting a non-default interview duration receives a scheduling workflow initialized to 60 minutes.

## Evidence

`src/routes/agents/index.ts` destructured `durationMinutes` from the request body but did not pass it to `startInterviewScheduling`. `src/agents/scheduling/agent.ts` `createInitialState` always set `durationMinutes: 60`; the start function had no duration argument. The workflow consumes that state value, so the requested duration was lost.

## Acceptance criteria

1. Pass an optional duration from the HTTP route into workflow initialization without breaking existing callers or the telemetry entry-point argument.
2. A valid requested duration (for example 30 or 90 minutes) is preserved in returned state and all downstream scheduling/calendar inputs that use duration.
3. An omitted duration continues to default to 60 minutes.
4. Reject nonnumeric, nonfinite, fractional, zero, and negative durations with HTTP 400 before invoking the workflow. Document the supported positive-integer-minute contract.
5. Rescheduling retains the selected duration unless an explicit supported change replaces it.

## Regression and CI coverage

`tests/regression/NFR-080-interview-duration-honored.test.ts` — 9 tests:

- **workflow (5)** — `createInitialState` preserves 30 and 90 minutes; an omitted duration defaults to 60; a duration passed through `startInterviewScheduling` survives full workflow execution; `requestReschedule` from `confirmed` preserves the duration (the `reschedule_requested` node returns a partial that omits `durationMinutes`, and the machine merges `{ ...state, ...partial }`).
- **route (4)** — fractional, zero, negative and nonnumeric `durationMinutes` each return HTTP 400 with `durationMinutes must be a positive integer number of minutes`.

No external calendar, LLM or scheduling credentials are required; the workflow's calendar integration is simulated.

## Estimate rationale

Small: parameter plumbing and validation with deterministic workflow tests; real calendar integration is outside scope. Estimates include implementation and regression coverage, excluding deployment and review waiting time. These are pre-existing defects discovered during warning review, not classified as database-migration regressions.

## Resolution (2026-10-27)

- **Fix:** `createInitialState` takes an optional `durationMinutes` (default 60) and uses it for `state.durationMinutes`. `startInterviewScheduling` takes an optional trailing `durationMinutes` **after** `entryPoint`, so the existing positional signature, the telemetry `entryPoint` argument and every existing caller stay unchanged. The route validates the request before invoking the workflow and passes the value through.
- **Validation contract:** `durationMinutes` is a positive integer number of minutes. The route rejects a non-number, a non-integer (which also covers `NaN`, `Infinity` and fractions), zero, and a negative value with HTTP 400 and the message `durationMinutes must be a positive integer number of minutes`. An omitted `durationMinutes` keeps the 60-minute default.
- **Downstream:** `state.durationMinutes` is the only duration consumer, so it feeds the returned state and the `interview_completed` audit entry (`details.duration`). Rescheduling preserves it because the `reschedule_requested` node returns a partial that omits the field and the machine merges over the previous state.
- **Tests:** new `tests/regression/NFR-080-interview-duration-honored.test.ts` — 9/9 green.
- **Gates:** `npm run typecheck` ✅ · `npm run lint` 0 errors ✅ · `npm run build` ✅ · `npm test` 415/415 ✅ · `npm run smoke` ✅.

## Out of scope

- **No upper bound on the duration.** The contract is a positive integer; a 10,000-minute interview is accepted. Add a cap if a policy limit is defined.
- **The calendar integration is simulated.** `sendingInvitesNode` does not yet create a real calendar event, so the duration is not yet written to a calendar API payload. The state value that would feed it is now correct.
