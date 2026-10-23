# Bug Story: Keep resume content out of parse errors and audit records

**Tracking ID:** NFR-079
**Status:** Open
**Priority:** High (P1)
**Size:** M (3–6h)
**Created:** 2026-10-22
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

Malformed model output can cause applicant content to be retained in diagnostic audit records and returned in error responses.

## Evidence

`src/chains/resumeParsing.ts:117,124` embeds raw model output (up to 500 characters) and stringified parse/schema errors in thrown messages. `src/routes/agents/index.ts:91,95,126` writes or returns those messages. Static tracing confirms the disclosure path; no live applicant data was used. This finding does not establish unauthenticated access to audit records.

## Acceptance criteria

1. JSON and schema failures produce stable, bounded error codes/messages without raw resume text, model output, schema input values, or provider response bodies.
2. Both file and text parsing endpoints return safe errors; failure audit records contain only approved metadata such as failure category and correlation ID.
3. Logs and exported telemetry do not contain synthetic sensitive markers introduced through malformed output or nested errors.
4. Preserve useful failure classification and safe internal error causality without serializing raw causes to public responses or audit records.
5. Successful parsing behavior is unchanged. Historical data retention/remediation is assessed separately; this story does not delete existing audit data.

## Regression and CI coverage

Inject malformed JSON and schema-invalid model responses containing synthetic email/name markers. Assert markers and raw output are absent from HTTP responses, persisted failure audit records, captured logs, and exported telemetry. Use deterministic provider mocks; run under normal CI without credentials. Cover both file and text endpoints and successful parsing.

## Estimate rationale

Medium: shared error construction, two HTTP paths, audit/telemetry assertions, and provider mocks. Coordinate with NFR-078 for successful PDF fixture coverage; text-path work can proceed independently. Estimates include implementation and regression coverage, excluding deployment and review waiting time. These are pre-existing defects discovered during warning review, not classified as database-migration regressions.
