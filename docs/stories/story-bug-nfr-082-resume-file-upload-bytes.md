# Bug Story: File resume upload never reaches the parser with its bytes

**Tracking ID:** NFR-082
**Status:** Complete (QA passed; local only)
**Priority:** High (P1) — feature completely non-functional
**Size:** S (1–3h)
**Created:** 2026-10-27
**Resolved:** 2026-10-27
**Source:** Found while writing the NFR-079 file-endpoint regression
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

`POST /api/agents/resume/parse` has never parsed an uploaded resume. Every PDF or DOCX upload is rejected with `InvalidPDFException: The PDF file is empty, i.e. its size is zero bytes` (surfaced as a 500), because the upload bytes are never handed to the parser. Uploading a resume — a headline flow in the resume-parsing feature — does not work.

## Evidence

`src/middleware/fileUpload.ts` configures `express-fileupload` with `useTempFiles: true`:

```ts
fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 },
  abortOnLimit: true,
  useTempFiles: true,
  tempFileDir: '/tmp/',
})(req, res, next);
```

With `useTempFiles: true`, `express-fileupload` streams the upload to a temporary file and does **not** accumulate the in-memory buffer. Its `tempFileHandler.complete()` returns no buffer, so `fileFactory` produces `data: <empty buffer>` and `tempFilePath: <path on disk>` (`node_modules/express-fileupload/lib/tempFileHandler.js:46`, `lib/fileFactory.js:47`).

`src/routes/agents/index.ts` read `file.data` directly, so the parser received a zero-length buffer. Confirmed live against the running app: the file object arrived with `data.length === 0`, `size === 596` (correct), and `tempFilePath === '/tmp/tmp-1-…'`, and the parser rejected the upload as empty.

## Acceptance criteria

1. A valid PDF or DOCX upload reaches the parser with its full contents and is parsed successfully.
2. An upload that cannot be read produces a graceful 4xx response, not an unhandled parser crash.
3. The `useTempFiles: true` configuration is preserved — the fix must not buffer unbounded uploads in memory.
4. No real applicant data or external LLM calls are required in tests.

## Regression and CI coverage

`tests/regression/NFR-082-resume-file-upload-bytes.test.ts` — 2 tests against the running app:

- **successful upload** — a hand-built PDF is posted as multipart form data; the response is 200, `success: true`, and the parsed resume comes back.
- **malformed upload** — a truncated PDF yields a 4xx/5xx JSON response and never the legacy `pdfParse is not a function` TypeError.

Run under the normal CI gate alongside typecheck, lint, build, smoke, and the existing tests.

## Estimate rationale

Small: one route-handler change that selects the temp file when the in-memory buffer is empty. No dependency change and no configuration change.

## Resolution (2026-10-27)

- **Fix:** `src/routes/agents/index.ts` now resolves the upload bytes as `file.data?.length ? file.data : await readFile(file.tempFilePath)` and returns `400 Uploaded file could not be read` when neither yields bytes. `useTempFiles: true` is unchanged, so uploads are still streamed to disk rather than buffered in memory.
- **Tests:** new `tests/regression/NFR-082-resume-file-upload-bytes.test.ts` — 2/2 green.
- **Gates:** `npm run typecheck` ✅ · `npm run lint` 0 errors ✅ · `npm run build` ✅ · `npm test` 406/406 ✅ · `npm run smoke` ✅.

## Out of scope

- Temporary-file cleanup. `express-fileupload` does not remove the temp file on the success path; the uploaded bytes are left in `/tmp`. Tracked as a follow-up.
- The `abortOnLimit` / 10MB size-limit behaviour is unchanged and is not covered by a dedicated test.
