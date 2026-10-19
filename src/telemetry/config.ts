/**
 * Telemetry configuration (OBS-P1-S03/S04). Pure parsing: no SDK imports, no side effects.
 * Every value is bounded; invalid input falls back to the default and yields a diagnostic
 * containing only the variable NAME and a fixed code — never the offending value.
 */

export interface TelemetryConfig {
  enabled: boolean;
  tracesEndpoint?: string;
  metricsEndpoint?: string;
  allowRemoteExport: boolean;
  serviceName: string;
  environment: string;
  release: string;
  traceSampleRatio: number;
  exportTimeoutMs: number;
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduleDelayMs: number;
  metricIntervalMs: number;
  shutdownTimeoutMs: number;
  trustInboundTrace: boolean;
  propagationAllowlist: string[];
  maxRoutes: number;
  excludeRoutes: string[];
}

export interface LoadedTelemetryConfig {
  config: TelemetryConfig;
  diagnostics: string[];
}

const DEFAULTS = {
  serviceName: 'rec-app',
  traceSampleRatio: 1,
  exportTimeoutMs: 5000,
  maxQueueSize: 512,
  maxExportBatchSize: 128,
  scheduleDelayMs: 2000,
  metricIntervalMs: 15000,
  shutdownTimeoutMs: 2000,
  maxRoutes: 200,
} as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function bool(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

function boundedInt(
  env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number, diag: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    diag.push(`${name}:out_of_range_using_default`);
    return def;
  }
  return n;
}

function token(raw: string | undefined, pattern: RegExp, fallback: string, name: string, diag: string[]): string {
  if (raw === undefined || raw === '') return fallback;
  if (!pattern.test(raw)) {
    diag.push(`${name}:invalid_using_default`);
    return fallback;
  }
  return raw;
}

function list(raw: string | undefined, max = 50): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, max);
}

/** Validate an endpoint; returns the URL string or undefined plus a diagnostic code. */
function endpoint(
  raw: string | undefined, suffix: string, name: string, allowRemote: boolean, diag: string[],
): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    diag.push(`${name}:invalid_url_export_disabled`);
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    diag.push(`${name}:unsupported_scheme_export_disabled`);
    return undefined;
  }
  if (!allowRemote && !isLoopbackHost(u.hostname)) {
    diag.push(`${name}:remote_export_not_allowed`);
    return undefined;
  }
  // Credentials in the URL would leak through exporter logs; refuse.
  if (u.username || u.password) {
    diag.push(`${name}:credentials_in_url_export_disabled`);
    return undefined;
  }
  u.search = '';
  u.hash = '';
  if (suffix && !u.pathname.endsWith(suffix)) {
    u.pathname = `${u.pathname.replace(/\/+$/, '')}${suffix}`;
  }
  return u.toString();
}

export function loadTelemetryConfig(env: NodeJS.ProcessEnv = process.env): LoadedTelemetryConfig {
  const diag: string[] = [];
  const allowRemoteExport = bool(env.TELEMETRY_ALLOW_REMOTE_EXPORT);
  const enabled = bool(env.TELEMETRY_ENABLED);
  const endpointDiag: string[] = [];

  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const tracesEndpoint = endpoint(
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || base, env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ? '' : '/v1/traces',
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ? 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT' : 'OTEL_EXPORTER_OTLP_ENDPOINT',
    allowRemoteExport, endpointDiag,
  );
  const metricsEndpoint = endpoint(
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || base, env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ? '' : '/v1/metrics',
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ? 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT' : 'OTEL_EXPORTER_OTLP_ENDPOINT',
    allowRemoteExport, endpointDiag,
  );
  if (enabled) {
    for (const d of new Set(endpointDiag)) diag.push(d);
    if (!tracesEndpoint && !metricsEndpoint && endpointDiag.length === 0) {
      diag.push('OTEL_EXPORTER_OTLP_ENDPOINT:missing_export_disabled');
    }
  }

  const sha = (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12);
  const maxQueueSize = boundedInt(env, 'TELEMETRY_MAX_QUEUE_SIZE', DEFAULTS.maxQueueSize, 16, 8192, diag);
  let maxExportBatchSize = boundedInt(env, 'TELEMETRY_MAX_EXPORT_BATCH', DEFAULTS.maxExportBatchSize, 1, 8192, diag);
  if (maxExportBatchSize > maxQueueSize) maxExportBatchSize = maxQueueSize;

  let ratio: number = DEFAULTS.traceSampleRatio;
  if (env.TELEMETRY_TRACE_SAMPLE_RATIO !== undefined && env.TELEMETRY_TRACE_SAMPLE_RATIO !== '') {
    const r = Number(env.TELEMETRY_TRACE_SAMPLE_RATIO);
    if (Number.isFinite(r) && r >= 0 && r <= 1) ratio = r;
    else diag.push('TELEMETRY_TRACE_SAMPLE_RATIO:out_of_range_using_default');
  }

  const config: TelemetryConfig = {
    enabled,
    tracesEndpoint,
    metricsEndpoint,
    allowRemoteExport,
    serviceName: token(env.OTEL_SERVICE_NAME, /^[A-Za-z0-9._-]{1,64}$/, DEFAULTS.serviceName, 'OTEL_SERVICE_NAME', diag),
    environment: token(
      env.TELEMETRY_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV, /^[a-z0-9_-]{1,32}$/, 'development',
      'TELEMETRY_ENVIRONMENT', diag,
    ),
    release: token(env.TELEMETRY_RELEASE || sha || undefined, /^[A-Za-z0-9._-]{1,40}$/, 'unknown', 'TELEMETRY_RELEASE', diag),
    traceSampleRatio: ratio,
    exportTimeoutMs: boundedInt(env, 'TELEMETRY_EXPORT_TIMEOUT_MS', DEFAULTS.exportTimeoutMs, 500, 30000, diag),
    maxQueueSize,
    maxExportBatchSize,
    scheduleDelayMs: boundedInt(env, 'TELEMETRY_SCHEDULE_DELAY_MS', DEFAULTS.scheduleDelayMs, 100, 60000, diag),
    metricIntervalMs: boundedInt(env, 'TELEMETRY_METRIC_INTERVAL_MS', DEFAULTS.metricIntervalMs, 1000, 300000, diag),
    shutdownTimeoutMs: boundedInt(env, 'TELEMETRY_SHUTDOWN_TIMEOUT_MS', DEFAULTS.shutdownTimeoutMs, 100, 10000, diag),
    trustInboundTrace: bool(env.TELEMETRY_TRUST_INBOUND_TRACE),
    propagationAllowlist: list(env.TELEMETRY_PROPAGATION_ALLOWLIST).map((s) => s.toLowerCase()),
    maxRoutes: boundedInt(env, 'TELEMETRY_MAX_ROUTES', DEFAULTS.maxRoutes, 10, 1000, diag),
    excludeRoutes: env.TELEMETRY_EXCLUDE_ROUTES === undefined ? ['/health'] : list(env.TELEMETRY_EXCLUDE_ROUTES),
  };
  return { config, diagnostics: diag.slice(0, 20) };
}

/** Re-apply bounds to a partial override (tests/callers). */
export function applyOverrides(base: TelemetryConfig, overrides: Partial<TelemetryConfig> | undefined): TelemetryConfig {
  if (!overrides) return base;
  const out = { ...base, ...overrides };
  out.traceSampleRatio = Math.min(1, Math.max(0, Number.isFinite(out.traceSampleRatio) ? out.traceSampleRatio : 1));
  out.maxQueueSize = Math.min(8192, Math.max(16, Math.trunc(out.maxQueueSize)));
  out.maxExportBatchSize = Math.min(out.maxQueueSize, Math.max(1, Math.trunc(out.maxExportBatchSize)));
  out.exportTimeoutMs = Math.min(30000, Math.max(100, Math.trunc(out.exportTimeoutMs)));
  out.scheduleDelayMs = Math.min(60000, Math.max(10, Math.trunc(out.scheduleDelayMs)));
  out.metricIntervalMs = Math.min(300000, Math.max(100, Math.trunc(out.metricIntervalMs)));
  out.shutdownTimeoutMs = Math.min(10000, Math.max(50, Math.trunc(out.shutdownTimeoutMs)));
  return out;
}
