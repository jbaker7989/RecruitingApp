# Bug Story: Keep resume content out of parse errors and audit records

**Tracking ID:** NFR-079
**Status:** Complete (QA passed; local only)
**Priority:** High (P1)
**Size:** M (3–6h)
**Created:** 2026-10-22
**Resolved:** 2026-10-27
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

Malformed model output can cause applicant content to be retained in diagnostic audit records and returned in error responses.

## Evidence

`src/chains/resumeParsing.ts` embedded raw model output (up to 500 characters) and the stringified Zod issue list in the thrown message. `src/routes/agents/index.ts` wrote that message into the failure audit record (`details: { error: error.message }`) and returned it in the HTTP response for both resume endpoints. Static tracing confirms the disclosure path; no live applicant data was used. This finding does not establish unauthenticated access to audit records.

Two concrete leak vectors were confirmed by the regression:

- **JSON failure** — the thrown message embedded `Raw content: <first 500 chars of the provider output>`, which is the applicant's resume content as the model saw it.
- **Schema failure** — the thrown message embedded the Zod error string. V8's `JSON.parse` message includes a ~30-character snippet around the fault position, and Zod's issue list includes received values for some issue codes (for example `invalid_enum_value`).

## Acceptance criteria

1. JSON and schema failures produce stable, bounded error codes/messages without raw resume text, model output, schema input values, or provider response bodies.
2. Both file and text parsing endpoints return safe errors; failure audit records contain only approved metadata such as failure category and correlation ID.
3. Logs and exported telemetry do not contain synthetic sensitive markers introduced through malformed output or nested errors.
4. Preserve useful failure classification and safe internal error causality without serializing raw causes to public responses or audit records.
5. Successful parsing behavior is unchanged. Historical data retention/remediation is assessed separately; this story does not delete existing audit data.

## Regression and CI coverage

`tests/regression/NFR-079-resume-error-content-disclosure.test.ts` — 5 tests against the running app. The model is stubbed to return malformed output containing a synthetic marker; the marker must not appear in the HTTP response, the persisted audit record, or captured console output.

- **malformed JSON (text endpoint)** — response carries `failure: 'json_failure'`, no marker, no `Raw content` note; logs are clean.
- **schema-invalid output (text endpoint)** — response carries `failure: 'schema_failure'`, no marker; logs are clean.
- **malformed JSON (file endpoint)** — response and the persisted failure audit record are marker-free; the record carries `failure` and an empty `fields` list and no `error` key.
- **schema-invalid output (file endpoint)** — the record carries the failing field path (for example `email`) but no values.
- **successful parsing** — unchanged; the parsed resume is still returned.

## Estimate rationale

Medium: shared error construction, two HTTP paths, audit/telemetry assertions, and provider mocks. Coordinate with NFR-078 for successful PDF fixture coverage; text-path work can proceed independently. Estimates include implementation and regression coverage, excluding deployment and review waiting time. These are pre-existing defects discovered during warning review, not classified as database-migration regressions.

## Resolution (2026-10-27)

- **Fix:** `src/chains/resumeParsing.ts` gains a `ResumeParseError` carrying a stable `failure` code (`json_failure` | `schema_failure`) and a content-free `message`. The raw provider output and the raw Zod error are dropped at the throw site, so they cannot reach HTTP responses, audit records, or stack traces. Schema failures keep the failing **field paths** (`detail.fields`), which are schema structure rather than applicant content, so the failure stays diagnosable.
- **Route changes (`src/routes/agents/index.ts`):** the file endpoint's failure audit record now stores `{ failure, fields }` instead of `{ error: error.message }`. Both endpoints return `{ error, failure }` with the safe message and the stable code.
- **Telemetry:** unchanged. `traceAIInvocation` already records only `error.type` and `ai.parse_outcome` categories, never the error message, so the parse-outcome classification (`json_failure` / `schema_failure`) is preserved.
- **Tests:** new `tests/regression/NFR-079-resume-error-content-disclosure.test.ts` — 5/5 green.
- **Test update:** `tests/observability-p2-ai.test.ts` asserted the old `/Failed to parse resume JSON/` message; it now asserts the two new safe messages so the JSON and schema outcomes are distinguished.
- **Gates:** `npm run typecheck` ✅ · `npm run lint` 0 errors ✅ · `npm run build` ✅ · `npm test` 406/406 ✅ · `npm run smoke` ✅.

## Out of scope

- **The document-extraction path is unchanged.** `extractTextFromPDF` / `extractTextFromDOCX` still embed the underlying parser error. Verified content-free: `pdf-parse` raises `InvalidPDFException: Invalid PDF structure.` with no document content. The model-output path was the disclosure risk.
- **`POST /api/agents/resume/parse-text` writes no failure audit record.** It never did. Adding one is a new observability behaviour, not a disclosure fix, so it is not part of this story.
- **The unsupported-file-type message still echoes the request's MIME type.** That is caller-supplied request data, not applicant content; the existing XSS/redirect work (NFR-077) covers reflected input elsewhere.
