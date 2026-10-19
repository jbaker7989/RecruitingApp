# ADR OBS-P1-S03: Runtime bootstrap (decision D05 resolved by evidence, local)

**Status:** Implemented and locally verified. Preview-deployment evidence (AC1 preview, cold/warm traces) is **pending** the root's Vercel preview run.

## Tested versions (installed 2026-10-19)

Node 24.20.0 (`engines.node: 24`), Express 5.2.x, ESM (`"type":"module"`, TS `module: ESNext`). `@opentelemetry/api` 1.9.1 · `sdk-trace-node`, `sdk-trace-base`, `sdk-metrics`, `resources`, `core` 2.12.0 · `exporter-trace-otlp-http`, `exporter-metrics-otlp-http`, `instrumentation` 0.223.0 · `instrumentation-undici` 0.33.0.

## Decisions

1. **Entrypoint:** the app is `src/index.ts` (exports `app`, starts only when executed directly; Vercel imports the default export). `import './telemetry/init.js'` is its first import, so the SDK is up before other modules evaluate. Default **off**.
2. **Official SDK, manual provider wiring** (`NodeTracerProvider`, `MeterProvider`, OTLP/HTTP JSON exporters) instead of `NodeSDK`: it keeps init/shutdown idempotent and re-runnable in tests (`shutdownTelemetry()` disables the API globals) and lets us wrap every exporter (sanitizer → fail-open wrapper → exporter).
3. **Server span/metrics are created by our Express middleware** (`telemetryMiddleware`), using the OTel API, because ESM auto-instrumentation of `http`/`express` requires an `--import` loader hook that Vercel/`node dist/index.js` do not provide by default.
4. **Outbound fetch** is covered by `@opentelemetry/instrumentation-undici` (uses `diagnostics_channel`, no loader hook). Verified: client span joins the active request context.
5. **Redis (ioredis):** not auto-instrumented (needs the ESM hook). Spans come from agent B's manual `tracedRedisOperation` helper (CLIENT span, operation name only). **Known limitation:** no automatic ioredis coverage; duplicate instrumentation is impossible because there is only one path.
6. **Invalid/missing exporter config:** telemetry disables itself with a one-line diagnostic of variable names and fixed codes (never values); the app starts normally. `OTEL_EXPORTER_OTLP_HEADERS` is read only by the official exporter.
7. **Shutdown/flush:** bounded by `TELEMETRY_SHUTDOWN_TIMEOUT_MS`; `forceFlushTelemetry()` returns `false` on timeout *or* any export failure during the flush and never throws.

## Not done / pending

- Preview deployment cold/warm trace evidence (root).
- Vercel serverless flush-before-freeze strategy is S07 (hosted release).
- Loader-hook (`--import`) based auto-instrumentation: deliberately out of scope; revisit only if manual spans prove insufficient.

## Local evidence

`tests/observability-bootstrap.test.ts`, `tests/telemetry-foundation.test.ts` (idempotent init, default-off, importing the app starts no listener/exporter, request isolation, bounded outage), and `npm run telemetry:verify` against the Docker stack.
