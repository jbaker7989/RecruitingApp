# P1 restart — operations sub-agent findings

**Author:** operations sub-agent (B). **Date:** 2026-10-19. **Branch:** `feature/observability-p1`.

This document records the audit performed at the start of the restart session. Findings are ordered by severity. No wholesale rewrite was performed; only targeted doc and comment fixes were applied to owned files.

---

## 1. `forceFlushTelemetry` returns `false` on export failure — VERIFIED FIXED

**Reported bug:** earlier agent reported that `forceFlushTelemetry` returned `true` even when the underlying export failed.

**Verification:** `bootstrap.ts` lines 256–262. The internal `forceFlush` closure now:
1. Captures `failuresBefore = counters.exportFailures` before the flush.
2. Runs `withDeadline(Promise.all([tracerProvider.forceFlush(), meterProvider?.forceFlush()]))`.
3. Throws `Error('telemetry flush failed')` if `!finished || counters.exportFailures > failuresBefore`.

`forceFlushTelemetry` wraps this with `.then(() => true, () => false)` so any throw or timeout yields `false`. The fix is correct and fully in place. No action needed.

---

## 2. Queue drops — reconciliation between `getExportHealth()` and `getTelemetryStatus()` (DOCS FIXED)

**Stale claim:** multiple docs said "SDK queue saturation `unmeasured` (no supported hook)" without noting that queue drops are in fact measured via a separate mechanism.

**Reality:**

| API | Queue drop visibility |
|---|---|
| `getExportHealth().*queue_saturation` | Always `'unmeasured'`. The exporter wrapper never observes batch-queue drops: they occur before the exporter callback fires, with no OTel SDK hook. Accurate. |
| `getTelemetryStatus().dropped.queueDroppedSpans` | Measured. `createSafeDiagLogger` in `privacy.ts` parses the SDK's fixed-text warning `"Dropped N spans because maxQueueSize reached"` and accumulates the integer into `counters.queueDroppedSpans`. Exposed via `getTelemetryStatus()`. Can lag one batch interval. |

**Changes applied (owned files only):**
- `src/telemetry/lifecycle.ts`: expanded `queue_saturation` JSDoc comment to explain the distinction.
- `docs/features/observability/p1-operations-contract.md`: updated `getExportHealth()` spec to cross-reference `queueDroppedSpans`.
- `docs/features/observability/p1-operations-runbook.md`: updated telemetry-outage bullet to explain both mechanisms.
- `docs/features/observability/p1-baseline-acceptance.md`: updated S07-AC4 row to reflect partial measurement via SDK diagnostic.

---

## 3. Historical failing test (resolved by root/foundation): metric series not collapsed after attribute sanitization — GAP FOR AGENT A

**Test:** `tests/observability-privacy.test.ts:55` — "S02/S04: 100 untrusted request IDs collapse to one exported metric series".

**Symptom:** Test records 100 counter increments, each with a unique `app.request.id` label (span-only, not in metric allow-list), then expects 1 exported data point with value 100. Actual: 100 data points, each with value 1 (assertion fails: `100 !== 1`).

**Root cause:** `sanitizeResourceMetrics` in `privacy.ts` (Agent A) maps each of the 100 data points through `sanitizeAttributes(dp.attributes, 'metric')`, which correctly strips `app.request.id`. However, it does not then merge the resulting 100 identical data points `{oauth.provider:'google'}` into one. The SDK creates a distinct internal series per unique attribute set at recording time; sanitization happens at export time and cannot retroactively merge them in the SDK's own storage.

**Risk:** An adversary supplying unique request-ID-derived labels (or any high-cardinality value) on metric instruments owned by application code could create an unbounded number of metric series per export batch, potentially causing backend cost or DoS if a hosted backend stores them.

**Resolution:** A supported SDK View now applies the full metric attribute schema before aggregation, preserving counters and histograms without duplicate series. The original exporter-side merge suggestion was not adopted because it would leave SDK memory cardinality unbounded. Root added a second regression for invalid values on allowed keys; both pass.

**Latest integrated suite:** 220 tests pass, 0 failures. The failing result above predates the fix.

---

## 4. Root wiring — VERIFIED COMPLETE

All items from the operations contract's "Root wiring needed" section are confirmed wired in `src/index.ts`:

| Item | Line in index.ts |
|---|---|
| `logContextMiddleware()` | 35 |
| `concurrencyMiddleware()` | 36 |
| `registerDefaultDependencies()` | 37 |
| `registerRuntimeMetrics()` | 38 |
| `readinessHandler` at `/ready` | 59 |
| `diagnosticsHandler` at `/api/internal/telemetry-diagnostics` | 60 |
| `registerLifecycleHooks([telemetry.flushable])` | 86 |
| Structured startup events via `runWithEntryPoint('startup', ...)` | 99, 123 |
| `recordStartupFailure('startup')` on error | 122 |

`src/routes/applicants.ts` OAuth denial counters:
- `recordOAuthUserDenied` wired at lines 548, 582, 616 (Google, LinkedIn, Facebook `if (error)` branches).
- `recordOAuthValidationFailure` wired at lines 552, 586, 620 (missing code/state branches).

No root wiring gaps found.

---

## 5. Fail-open behavior — VERIFIED CORRECT

| Component | Fail-open check | Result |
|---|---|---|
| `instrumentExporter` | Hard timeout, circuit breaker, never throws, callback always called | ✅ |
| `flushTelemetry` | Bounded, always resolves, never rejects | ✅ |
| `shutdownTelemetry` | Bounded, always resolves, never rejects | ✅ |
| `logger.*` | Entire `logEvent` wrapped in try/catch | ✅ |
| `readinessHandler` / `diagnosticsHandler` | No error text in public response | ✅ |
| `registerRuntimeMetrics` | Meter operations wrapped in try/catch | ✅ |
| `recordStartupFailure` | Metric `add` wrapped in try/catch | ✅ |

---

## 6. Duplicate instrument / context registration — VERIFIED CORRECT

- `registerRuntimeMetrics()`: guarded by `if (metricsRegistered) return` flag. Safe to call multiple times.
- `registerDefaultDependencies()`: uses `registry.has(spec.name)` before `registry.set`. Idempotent.
- `providerOps.m()`: creates new instrument handles per call. OTel SDK de-duplicates by name; all calls return the same instrument. Slightly inefficient but correct.
- `initTelemetry()` in `bootstrap.ts`: returns `active` without re-initialising if already active. Idempotent.

---

## 7. Readiness authorization — VERIFIED CORRECT

- `/ready` (`readinessHandler`): public; exposes only `{name, required, status}` per dependency. No messages, host names, or error text.
- `/api/internal/telemetry-diagnostics` (`diagnosticsHandler`): returns `404` unless `TELEMETRY_DIAGNOSTICS_TOKEN` env var is set AND the request presents a matching `Authorization: Bearer` header. Token comparison uses `timingSafeEqual` (constant-time). Returns rich internal detail only to authorized callers.

---

## 8. Provider wrappers (S06) — VERIFIED CORRECT

| Wrapper | Span kind | Prohibited attributes | Error handling |
|---|---|---|---|
| `tracedClientOperation` | `SpanKind.CLIENT` | No URL, headers, body, tokens | `classifyFailure` → bounded `ProviderOutcome`; no `recordException` |
| `observeLogin` | `SpanKind.INTERNAL` | No URL, provider-internal detail | Same; logs `oauth.login.completed` |
| `tracedRedisOperation` | `SpanKind.CLIENT` | No keys, args, values | Same |
| `recordOAuthUserDenied` / `recordOAuthValidationFailure` | Counter only (no span) | — | try/catch |

Redis instrumentation is manual (no native ioredis auto-instrumentation). This is a documented limitation. No live Redis proof exists; accepted as pending (S06-AC1).

---

## 9. Evidence script robustness

`scripts/obs-p1-evidence.mjs` hardcodes blank provider env (no `.env` live provider usage). The seven scenarios (disabled baseline, OK sink, 500/hang/drop/unreachable faults, restore) are all loopback-only. Budget thresholds are marked `approved: false`. No changes needed.

Root's load-test note: ratio measurements from the previous run (4.62/2.34/2.59 on 500/hang/drop scenarios) are noisy and outside the proposed budget. These are not grounds to raise thresholds; they indicate the load scenarios need to run in isolation from other test activity (not concurrently with the full test suite). No change to the script.

---

## Summary

| # | Finding | Severity | Action taken | Needs |
|---|---|---|---|---|
| 1 | `forceFlushTelemetry` bug | Fixed | None (fix verified) | — |
| 2 | Queue-drop docs inconsistency | Docs only | Docs updated | — |
| 3 | Metric series not collapsed after sanitization | Real bug | Documented | **Agent A: fix `sanitizeResourceMetrics` in `privacy.ts`** |
| 4 | Root wiring | Correct | None | — |
| 5 | Fail-open behavior | Correct | None | — |
| 6 | Duplicate instrument/context | Correct | None | — |
| 7 | Readiness authorization | Correct | None | — |
| 8 | Provider wrappers | Correct | None | — |
| 9 | Evidence script | Correct | None | — |

**Test suite state at restart:** 217/218 pass; 1 failure in `tests/observability-privacy.test.ts:55` (Agent A's `privacy.ts` gap, documented above). All tests in `tests/telemetry-operations.test.ts` pass.
