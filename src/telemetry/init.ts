/**
 * Side-effect import: must be the FIRST import in src/index.ts so the SDK and undici instrumentation
 * are active before other modules load. Idempotent; a no-op unless TELEMETRY_ENABLED=true.
 * Failure is swallowed (fail-open) after a sanitized diagnostic.
 */
import { initTelemetry } from './bootstrap.js';

try {
  initTelemetry();
} catch {
  console.warn('[telemetry] init:failed_telemetry_disabled');
}
