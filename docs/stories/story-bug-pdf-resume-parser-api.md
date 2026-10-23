# Bug Story: Restore PDF resume parsing with the installed parser API

**Tracking ID:** NFR-078
**Status:** Open
**Priority:** High (P1)
**Size:** S (1–3h)
**Created:** 2026-10-22
**Source:** Lint-warning review of `bd575b8`, database delivery branch
**Backlog:** [BUGS.md](../../BUGS.md)

## User impact

PDF resume uploads fail before text extraction, blocking a supported application input.

## Evidence

`src/chains/resumeParsing.ts:159–161` resolves `(pdfModule as any).default || pdfModule` and calls it as a function. The installed `pdf-parse` exports a `PDFParse` class, not a callable default. A local synthetic-buffer probe reproduced `Failed to extract text from PDF: TypeError: pdfParse is not a function` before content parsing. This is an API mismatch, not evidence that the probe was a valid PDF.

## Acceptance criteria

1. Use the installed parser's supported API to extract text from a valid PDF and release parser resources on both success and failure.
2. A synthetic PDF containing known text reaches the resume parsing stage with that text intact.
3. Corrupt and empty PDFs fail with safe, bounded errors; unsupported types retain their current rejection behavior.
4. DOCX extraction remains functional; no real applicant data or external LLM calls are required in tests.

## Regression and CI coverage

Add a real-library extraction regression using a valid synthetic PDF; mock only the downstream LLM boundary. Cover corrupt/empty documents and resource cleanup. Run the regression in the normal CI test gate alongside typecheck, lint, build, and existing resume tests.

## Estimate rationale

Small: one extraction adapter plus fixtures and focused tests; no dependency upgrade is assumed. Estimates include implementation and regression coverage, excluding deployment and review waiting time. These are pre-existing defects discovered during warning review, not classified as database-migration regressions.
