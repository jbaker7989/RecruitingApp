/**
 * Public barrel for the telemetry foundation. Other modules/tests import from here, not deep files.
 * Contract: docs/features/observability/p1-integration-contract.md
 */
export { loadTelemetryConfig, applyOverrides, isLoopbackHost } from './config.js';
export type { TelemetryConfig, LoadedTelemetryConfig } from './config.js';
export {
  initTelemetry, getTelemetryRuntime, isTelemetryEnabled, getTelemetryStatus, forceFlushTelemetry, shutdownTelemetry,
  getTracer, getMeter, HTTP_DURATION_BUCKETS_SECONDS,
} from './bootstrap.js';
export type { InitOptions, TelemetryRuntime, TelemetryTestHooks } from './bootstrap.js';
export {
  sanitizeAttributes, sanitizeString, sanitizeSpan, sanitizeSpanName, sanitizeScopeName, sanitizeResourceMetrics,
  containsSecretPattern, registerSafeNames,
  ALLOWED_ATTRIBUTE_KEYS, ALLOWED_SPAN_KEYS, ALLOWED_METRIC_KEYS, ALLOWED_RESOURCE_KEYS, ERROR_CATEGORIES,
  classifyError, recordSafeError, isPropagationAllowed, createSafeDiagLogger,
  SanitizingSpanExporter, SanitizingMetricExporter,
} from './privacy.js';
export type { ErrorCategory, Signal } from './privacy.js';
export {
  getRequestContext, runWithRequestContext, setRequestFeature, getTraceCorrelation, generateRequestId,
  parseInboundRequestId, parseInboundTraceparent,
} from './context.js';
export type { RequestContext } from './context.js';
export { telemetryMiddleware, telemetryErrorMiddleware, normalizeRoute } from './http.js';
export { createTestTelemetry, startOtlpSink } from './testing.js';
export type { TestTelemetry, OtlpSink, SinkMode } from './testing.js';
