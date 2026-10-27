# Bug Story: Restore PDF resume parsing with the installed parser API

**Tracking ID:** NFR-078
**Status:** Complete (QA passed; local only)
**Priority:** High (P1)
**Size:** S (1–3h)
**Created:** 2026-10-22
**Resolved:** 2026-10-27
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

PDF resume uploads fail before text extraction, blocking a supported application input.

## Evidence

`src/chains/resumeParsing.ts` resolved `(pdfModule as any).default || pdfModule` and called it as a function. The installed `pdf-parse` v2 exports a `PDFParse` class, not a callable default. A local synthetic-buffer probe reproduced `Failed to extract text from PDF: TypeError: pdfParse is not a function` before content parsing. This is an API mismatch, not evidence that the probe was a valid PDF.

## Acceptance criteria

1. Use the installed parser's supported API to extract text from a valid PDF and release parser resources on both success and failure.
2. A synthetic PDF containing known text reaches the resume parsing stage with that text intact.
3. Corrupt and empty PDFs fail with safe, bounded errors; unsupported types retain their current rejection behavior.
4. DOCX extraction remains functional; no real applicant data or external LLM calls are required in tests.

## Regression and CI coverage

Five focused regression tests in `tests/regression/NFR-078-pdf-resume-parser-api.test.ts`:

- **valid PDF** — hand-built one-page PDF with a marker string; marker reaches the parser prompt intact, schema validates.
- **corrupt PDF** — malformed buffer produces a bounded `Failed to extract text from PDF` error; the legacy `pdfParse is not a function` failure cannot recur.
- **empty PDF** — PDF with a blank text object produces only the library's page marker; with `pageJoiner: ''` the marker is suppressed and the existing `No text could be extracted` guard fires.
- **unsupported type** — `text/plain` retains the existing `Unsupported file type` rejection.
- **DOCX regression** — hand-built `.docx` ZIP with `word/document.xml` extracts the marker through the unchanged mammoth path.

All tests use the real pdf-parse and mammoth libraries and stub only the downstream `ChatOpenAI.prototype.invoke`. Run under the normal CI gate alongside typecheck, lint, build, smoke, and the existing tests.

## Estimate rationale

Small: one extraction adapter, two hand-built file fixtures (no library dependency added), and five focused tests. No dependency upgrade was required.

## Resolution (2026-10-27)

- **Fix:** `extractTextFromPDF` now uses the supported `PDFParse` API. A `parser` is constructed with `new PDFParse({ data: new Uint8Array(buffer) })`, `getText({ pageJoiner: '' })` is awaited, and `parser.destroy()` runs in a `finally` so worker resources are released on both success and failure paths. `pageJoiner: ''` suppresses the default `-- page_number of total_number --` boundary marker so the existing empty-text guard can fire and so the marker is not injected into the LLM prompt.
- **Tests:** new `tests/regression/NFR-078-pdf-resume-parser-api.test.ts` — 5/5 green.
- **Gates:** `npm run typecheck` ✅ · `npm run lint` 0 errors ✅ · `npm run build` ✅ · `npm test` 399/399 ✅ · `npm run smoke` ✅.
- **Out of scope:** DOCX path is unchanged; the regression proves it still works against a hand-built `.docx` fixture.
