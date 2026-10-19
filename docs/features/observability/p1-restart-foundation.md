# P1 Restart — Foundation Findings & Evidence

**Agent:** Implementation sub-agent (Sonnet 4.6)
**Branch:** `feature/observability-p1`
**Date:** 2026-10-19
**Scope:** `src/telemetry/` (bootstrap, config, privacy, context, http, init, index, testing); `observability/local`; `scripts/telemetry-local-verify.mjs`; ADRs S01–S05.

---

## Summary

Reviewed all owned telemetry source files. Found and fixed **two defects**; confirmed all other stated invariants hold. The full focused suite passes 72/72.

---

## Defects Fixed

### 1. Metric cardinality bomb — prohibited labels create unbounded series (FIXED)

**File:** `src/telemetry/bootstrap.ts`
**Severity:** Substantive — a caller who accidentally passes a span-only attribute (e.g. `app.request.id`) to a metric instrument silently creates O(unique-values) series inside the SDK, inflating memory and downstream storage indefinitely. The `SanitizingMetricExporter` dropped the label from the exported payload but did not merge the resulting duplicate data points.

**Root cause:** `sanitizeResourceMetrics()` in `privacy.ts` strips disallowed keys per data point after the SDK has already aggregated by the full (dirty) attribute set. By the time the exporter fires, 100 increments with 100 different `app.request.id` values have already been split into 100 series — dropping the key leaves 100 identical series that cannot be re-aggregated.

**Fix:** Added an OTel SDK `View` with `attributesProcessors: [createAllowListAttributesProcessor([...ALLOWED_METRIC_KEYS])]` and `instrumentName: '*'` to the `MeterProvider`. The SDK now strips prohibited keys **before aggregation**, so all increments sharing the same allowed-key set collapse into one series. `SanitizingMetricExporter` is retained as defence-in-depth.

```diff
// bootstrap.ts — MeterProvider constructor
+import { MeterProvider, PeriodicExportingMetricReader, createAllowListAttributesProcessor } from '@opentelemetry/sdk-metrics';
+import { ..., ALLOWED_METRIC_KEYS } from './privacy.js';

 meterProvider = new MeterProvider({
   resource,
   readers: [...],
+  views: [{ instrumentName: '*', attributesProcessors: [createAllowListAttributesProcessor([...ALLOWED_METRIC_KEYS])] }],
 });
```

**Test:** `tests/observability-privacy.test.ts:55` — "S02/S04: 100 untrusted request IDs collapse to one exported metric series" — was RED, now passes.

---

### 2. Dead import: `defaultTextMapSetter` void-suppression (FIXED)

**File:** `src/telemetry/bootstrap.ts`
**Severity:** Cosmetic — `defaultTextMapSetter` was imported as a value from `@opentelemetry/api` and immediately voided (`void defaultTextMapSetter;`) to suppress a lint/unused-import warning. It is not used anywhere. `TextMapSetter` (the type) is kept in the type import.

**Fix:** Removed the value import and the void expression. TypeScript (`strict: true`, no `noUnusedLocals`) compiles cleanly without it.

---

## Invariants Confirmed (No Changes Needed)

| Invariant | Evidence |
|---|---|
| Default OFF — no SDK registered unless `TELEMETRY_ENABLED=true` | `initTelemetry({env:{}})` returns `enabled:false`; no global tracer/meter registered |
| `forceFlushTelemetry` returns `false` on export failure | Inner `forceFlush` throws when `counters.exportFailures > failuresBefore`; outer wraps with `.then(()=>true, ()=>false)`; test "S03/S07: flush returns false for a failed official SDK export" passes |
| OAuth span links default OFF | `currentCorrelation()` returns `undefined` unless `OBS_OAUTH_SPAN_LINKS=true`; no env flag set in tests; confirmed by test "S06: actual LinkedIn callback recovers…" |
| Queue drop diagnostics via exact SDK message | `QUEUE_DROP_RE = /^Dropped (\d{1,9}) spans because maxQueueSize reached$/` in `createSafeDiagLogger`; increments `counters.queueDroppedSpans`; surfaced in `getTelemetryStatus().dropped.queueDroppedSpans` |
| Propagation gate loopback-only | `DestinationGatedPropagator` checks `pendingAllowed` set by `isPropagationAllowed(request.origin, config)` in undici requestHook; only allowlisted destinations receive `traceparent` |
| Bounded bootstrap / flush / shutdown | All three use `withDeadline` / `Promise.race` with `shutdownTimeoutMs`; exporter outage test confirms <2500 ms wall time |
| Sanitizing span exporter | `sanitizeSpan` applies allow-list + per-key validators + secret-pattern detection; test "S04: exported SDK payloads drop prohibited attributes" passes |
| Sanitizing metric exporter | `sanitizeResourceMetrics` validates per-key after SDK View has already stripped prohibited keys; 6 privacy tests pass |
| Safe diag logger | SDK-internal messages classified to fixed codes only; arguments never echoed |

---

## Test Results

**Focused suite (foundation + operations + observability):**

```
tests/telemetry-foundation.test.ts        pass 8 / 8
tests/telemetry-operations.test.ts        pass 7 / 7
tests/observability-bootstrap.test.ts     pass 10 / 10
tests/observability-exporter.test.ts      pass 5 / 5
tests/observability-http.test.ts          pass 7 / 7
tests/observability-oauth.test.ts         pass 11 / 11
tests/observability-operations.test.ts    pass 5 / 5
tests/observability-otlp.test.ts          pass 5 / 5
tests/observability-privacy.test.ts       pass 6 / 6   ← was 5 pass 1 fail
tests/observability-runtime.test.ts       pass 8 / 8
                                          ─────────────
TOTAL                                     pass 72 / 72  fail 0
```

---

## Pending (Outside This Agent's Scope)

- **OBS-P1-S01 / S02** — destination and data-governance policy approvals remain open; no hosted export, no dashboard.
- **Vercel preview integration** — owned by root agent.
- **Full regression suite** (baseline 147 + new tests) — to be run by root agent.
- **Local Jaeger/Prometheus/Loki query proof** — remains from prior agent session.
- **`forceFlushTelemetry` on export failure** — confirmed correct (test green); prior report of bug was already fixed.
- **OAuth span links (`OBS_OAUTH_SPAN_LINKS`)** — default OFF per contract; no policy approval yet.
