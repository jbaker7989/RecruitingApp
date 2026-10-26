# NFR-SLOP-S05: Normalize Error Handling and Replace Ad-hoc `console.*` Logging

**Status:** Proposed
**Priority:** Medium–High (P2) — overlaps an open security finding
**Size:** M (3–6h) for the mechanical/logging part; the client-disclosure part is owned by NFR-031 and sized there
**Tracks:** NFR-031, NFR-079, NFR-027
**Parent:** [Code hygiene remediation](README.md)

## Problem

Observability P1/P2 introduced a sanitizing structured logger (`src/telemetry/logger.ts`) with allow-listed attributes, rate limiting and PII-safe error handling. The application code mostly does not use it. About **45 `console.*` calls** remain in request paths, written before the telemetry layer existed:

| File | Calls |
|---|---|
| `src/routes/agents/jdGenerator.ts` | 9 |
| `src/routes/dashboard.ts` | 7 |
| `src/routes/agents/candidateCommunication.ts` | 5 |
| `src/chains/matching.ts` | 5 |
| `src/services/vectorStore/pinecone.ts` | 4 (startup chatter `[Pinecone] Creating index…`) |
| `src/services/revocationService.ts` | 3 (**swallows** the error and logs a fixed string) |
| others | 1–2 each |

### Specific defects

1. **Raw error objects are logged.** `console.error('[dashboard] Register error:', err)` and the LLM routes serialize the full `err` (message, stack, provider response bodies, request context). On the registration, profile and LLM paths those can contain applicant email addresses, resume text or prompt content. This bypasses the privacy layer built for exactly this reason and contradicts the README's PII-safe-observability claim.
2. **Error middleware is sloppy and leaky.** `errorHandler` (`src/middleware/auth.ts:118`) is registered globally, logs `err.stack`, returns `err.message` to the client, and declares `req`/`next` unused. (Client disclosure is **NFR-031**; do not duplicate it — implement the hygiene part and link.)
3. **Silent degradation.** `revocationService.ts:58,70,124` catch, `console.warn` a constant string, and **return `false` from `isRevoked` on failure** ("graceful degradation"). A failing revocation store therefore treats revoked tokens as valid with no metric, no span and no alert. This is a fail-open decision made in a log message; it needs an explicit decision record and a counter.
4. **`preserve-caught-error` (6 warnings).** `chains/candidateCommunication.ts:185`, `chains/jobDescription.ts:264`, and four sites in `chains/resumeParsing.ts` rethrow without `{ cause }`. The `resumeParsing.ts:117,124` sites are NFR-079 (and must *not* add raw output to the message); the others should attach `cause` internally while keeping public messages generic.
5. **Per-handler try/catch copy-paste.** Each route repeats `try { … } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : '…' }) }` (48 sites, see NFR-031). Express 5 forwards rejected promises to the error middleware, so one correct handler can replace them.
6. **Switch lexical declarations.** `src/services/llm/index.ts:59,63` declare `const` inside `case` without a block (`no-case-declarations`).

## Acceptance criteria

- [ ] **S05-AC1:** No `console.*` call remains under `src/` outside process-startup scripts and `src/telemetry/bootstrap.ts` fallbacks (those use a documented local sink). Request-path failures use the telemetry logger with allow-listed fields (`operation`, `outcome`, error class), never the raw error object.
- [ ] **S05-AC2:** A test injects a synthetic email and resume marker into a thrown error on the dashboard register, JD-generate and message-generate paths and proves the marker appears in neither captured logs nor the HTTP response.
- [ ] **S05-AC3:** One error-handling middleware maps known error classes to status codes, logs through the telemetry logger, uses `_req`/`_next` correctly, and returns a generic 500 body. Duplicated `try/catch` blocks are removed slice-by-slice only where the middleware demonstrably handles the same cases (coordinate with NFR-031 so the client-facing change ships once).
- [ ] **S05-AC4:** `revocationService` degradation emits a metric/log event and the fail-open vs fail-closed choice is recorded (decision: owner + date) in the file header and the security docs; a test covers revocation-store failure behavior.
- [ ] **S05-AC5:** `preserve-caught-error` and `no-case-declarations` warnings are zero for these files; `{ cause }` is attached internally and stripped from public messages.
- [ ] **S05-AC6:** Pinecone startup `console.log` lines become debug-level structured events (or are removed); no secret, index name with tenant data or API key is logged.

## Implementation tasks

1. Write the marker-leak tests first (they should fail today on the dashboard/LLM paths).
2. Introduce a `logError(scope, err)` helper over the telemetry logger; replace calls by file.
3. Implement the shared middleware with NFR-031 and delete the per-route boilerplate in small slices.
4. Record the revocation fail-open decision and add the counter.
5. Fix `llm/index.ts` case blocks and add `cause`.

## Boundaries

No new logging dependency. No change to telemetry attribute allow-lists without the P1 privacy review. Do not change HTTP status codes except as NFR-031 specifies.
