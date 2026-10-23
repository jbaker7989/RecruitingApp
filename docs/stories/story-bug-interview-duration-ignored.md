# Bug Story: Honor requested interview duration

**Tracking ID:** NFR-080
**Status:** Open
**Priority:** Medium (P2)
**Size:** S (1–3h)
**Created:** 2026-10-22
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

A caller requesting a non-default interview duration receives a scheduling workflow initialized to 60 minutes.

## Evidence

`src/routes/agents/index.ts:260` destructures `durationMinutes` but does not pass it to `startInterviewScheduling`. `src/agents/scheduling/agent.ts:79` always initializes duration to 60; the start function has no duration argument. The workflow consumes that state value, so the requested duration is lost.

## Acceptance criteria

1. Pass an optional duration from the HTTP route into workflow initialization without breaking existing callers or the telemetry entry-point argument.
2. A valid requested duration (for example 30 or 90 minutes) is preserved in returned state and all downstream scheduling/calendar inputs that use duration.
3. An omitted duration continues to default to 60 minutes.
4. Reject nonnumeric, nonfinite, fractional, zero, and negative durations with HTTP 400 before invoking the workflow. Document the supported positive-integer-minute contract.
5. Rescheduling retains the selected duration unless an explicit supported change replaces it.

## Regression and CI coverage

Add route-to-workflow regression tests for 30/90 minutes, the omitted default, and invalid inputs. Assert downstream duration with mocked external scheduling/calendar/LLM dependencies, including rescheduling. Run in normal CI with no external credentials.

## Estimate rationale

Small: parameter plumbing and validation with deterministic workflow tests; real calendar integration is outside scope. Estimates include implementation and regression coverage, excluding deployment and review waiting time. These are pre-existing defects discovered during warning review, not classified as database-migration regressions.
