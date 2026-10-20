#!/usr/bin/env node
/**
 * P2 local backend query verification (OBS-P2-S10-AC2/AC3/AC4).
 *
 * Runs the P2 fixture driver as a child process with OTLP export enabled,
 * waits for spans to arrive at the local collector stack, then queries
 * Jaeger and Prometheus to assert the expected P2 telemetry.
 *
 * Prerequisites:
 *   docker compose -f observability/local/docker-compose.yml up -d
 *   (Jaeger at :16686, Prometheus at :9090, OTLP collector at :4318)
 *
 * CI command (exact):
 *   node --import tsx scripts/observability-p2-verify.mjs
 *
 * This script does NOT start or stop Docker containers; that is the orchestrator's
 * responsibility. It uses bounded timeouts and exits non-zero on any assertion failure.
 *
 * Authorization: synthetic only. No production data, credentials, or provider calls.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root       = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep      = (ms) => new Promise((r) => setTimeout(r, ms));
const results    = [];

const JAEGER_BASE      = process.env.JAEGER_URL      ?? 'http://127.0.0.1:16686';
const PROMETHEUS_BASE  = process.env.PROMETHEUS_URL  ?? 'http://127.0.0.1:9090';
const OTLP_ENDPOINT    = process.env.OTLP_ENDPOINT   ?? 'http://127.0.0.1:4318';

// Unique service name per verifier run so Jaeger/Prometheus queries cannot
// accidentally match stale traces from previous runs.
const runId      = `p2-verify-${randomUUID().slice(0, 8)}`;
const P2_SERVICE = `rec-app-p2-${runId}`;

function check(name, ok, detail = '') {
  results.push({ name, ok });
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${status} ${name}${suffix}`);
}

// ─── Step 1: probe backends ───────────────────────────────────────────────────

console.log('=== P2 Backend Query Verifier ===');
console.log(`RunId: ${runId}`);
console.log(`Service: ${P2_SERVICE}`);
console.log(`Jaeger: ${JAEGER_BASE}  Prometheus: ${PROMETHEUS_BASE}  OTLP: ${OTLP_ENDPOINT}`);

async function probeBackend(label, url, timeoutMs = 3000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

const jaegerAlive    = await probeBackend('Jaeger',    `${JAEGER_BASE}/api/services`);
const prometheusAlive = await probeBackend('Prometheus', `${PROMETHEUS_BASE}/-/ready`);

if (!jaegerAlive || !prometheusAlive) {
  console.error('[verify] Backends not available — start the local stack first:');
  console.error('  docker compose -f observability/local/docker-compose.yml up -d');
  console.error(`  Jaeger alive: ${jaegerAlive}  Prometheus alive: ${prometheusAlive}`);
  process.exit(1);
}
console.log('Backends: Jaeger OK, Prometheus OK\n');

// ─── Step 2: run fixture driver with OTLP export ──────────────────────────────

console.log('[verify] Running P2 fixture driver (all scenarios)...');
const fixtureExitCode = await new Promise((resolve_) => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/observability-p2-fixtures.mjs'],
    {
      cwd: root,
      // Pass unique service name so the driver exports under the same unique service.
      // The driver honors OTEL_SERVICE_NAME if set to something other than the static default.
      env: {
        ...process.env,
        TELEMETRY_ENABLED:  'true',
        OTLP_ENDPOINT,
        OTEL_SERVICE_NAME:  P2_SERVICE,
        TELEMETRY_RELEASE:  runId,
        TELEMETRY_ENVIRONMENT: 'local',
        TELEMETRY_ALLOW_REMOTE_EXPORT: 'false',
        APP_TRAFFIC: 'synthetic',
        // Credentials stripped unconditionally in the fixture driver; set safe env here too.
        OPENAI_API_KEY:   'sk-verify-fake-0000000000000000000000000000000000000000000000000000',
        ANTHROPIC_API_KEY: 'sk-ant-verify-fake-0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        PINECONE_API_KEY: 'pcsk-verify-fake-0000000000000000000000000000000000000000000000000000000000',
      },
      stdio: 'inherit',
    },
  );
  // Bounded timeout: fixture driver should finish well under 60 s.
  const killTimer = setTimeout(() => {
    child.kill('SIGKILL');
    resolve_(1);
  }, 60_000);
  child.on('close', (code) => {
    clearTimeout(killTimer);
    resolve_(code ?? 1);
  });
  child.on('error', (err) => {
    clearTimeout(killTimer);
    console.error('[verify] Failed to spawn fixture driver:', err.message);
    resolve_(1);
  });
});

if (fixtureExitCode !== 0) {
  console.error(`[verify] Fixture driver exited with code ${fixtureExitCode}`);
  process.exit(1);
}

// ─── Step 3: poll for span ingestion ─────────────────────────────────────────
// Bounded polling: try up to 5 × 2 s = 10 s before asserting.

console.log('\n[verify] Waiting for spans to arrive at collector...');
let traces = [];
for (let attempt = 0; attempt < 5; attempt++) {
  await sleep(2000);
  traces = await fetchJaegerTraces(P2_SERVICE, 50);
  if (traces.length > 0) break;
  console.log(`  [poll ${attempt + 1}/5] no traces yet...`);
}

// ─── Step 4: Jaeger assertions ────────────────────────────────────────────────

console.log('\n=== Jaeger span assertions ===');

async function fetchJaegerTraces(service, limit = 50) {
  const q = `${JAEGER_BASE}/api/traces?service=${encodeURIComponent(service)}&limit=${limit}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(q, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await resp.json();
    return body.data ?? [];
  } catch {
    return [];
  }
}

// Flatten all spans from all traces.
const allSpans = traces.flatMap((t) => t.spans ?? []);
const spanOpNames = allSpans.map((s) => s.operationName);

const expectSpans = [
  'store.read',
  'pinecone.query',
  'pinecone.fetch',
  'vectorstore.similarity_search',
  'scheduling.execute',
  'scheduling.step',
  'ai.chat',
  'ai.chat.attempt',
];

check('Jaeger: fixture run produced traces', traces.length > 0, `${traces.length} traces`);
for (const name of expectSpans) {
  check(`Jaeger: span "${name}" present`, spanOpNames.includes(name),
    spanOpNames.includes(name) ? 'found' : 'missing');
}

// Check specific outcomes via span tags.
function findSpanTag(spans, opName, tagKey, tagValue) {
  return spans.some((s) => s.operationName === opName &&
    (s.tags ?? []).some((t) => t.key === tagKey && t.value === tagValue));
}

// pinecone.query with timeout should have error.type=timeout
check(
  'Jaeger: pinecone.query has timeout span',
  findSpanTag(allSpans, 'pinecone.query', 'error.type', 'timeout'),
  'error.type=timeout',
);

// store.read should have outcome=success
check(
  'Jaeger: store.read outcome=success',
  findSpanTag(allSpans, 'store.read', 'app.outcome', 'success'),
  'app.outcome=success',
);

// ai.chat with malformed_model scenario should have ai.parse_outcome=json_failure
check(
  'Jaeger: ai.chat has json_failure parse outcome',
  findSpanTag(allSpans, 'ai.chat', 'ai.parse_outcome', 'json_failure'),
  'ai.parse_outcome=json_failure',
);

// ai.chat.attempt with slow_llm scenario should have outcome=success
check(
  'Jaeger: ai.chat.attempt has success span',
  findSpanTag(allSpans, 'ai.chat.attempt', 'app.outcome', 'success'),
  'app.outcome=success',
);

// scheduling.transition should have an error (invalid transition scenario)
const transitionSpans = allSpans.filter((s) => s.operationName === 'scheduling.transition');
check(
  'Jaeger: scheduling.transition error span present',
  transitionSpans.some((s) => (s.tags ?? []).some((t) => (t.key === 'otel.status_code' && t.value === 'ERROR') || (t.key === 'app.outcome' && ['unknown', 'invalid_state', 'error'].includes(t.value)))),
  transitionSpans.length > 0 ? 'found' : 'no transition spans',
);

// ─── Step 5: Prometheus metric assertions ─────────────────────────────────────

console.log('\n=== Prometheus metric assertions ===');

async function promQuery(query) {
  const q = `${PROMETHEUS_BASE}/api/v1/query?query=${encodeURIComponent(query)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(q, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await resp.json();
    return body.status === 'success' ? (body.data?.result ?? []) : [];
  } catch {
    return [];
  }
}

// P2 pinecone operation counter (any outcome).
const pineconeCountResult = await promQuery(
  `sum(app_pinecone_operation_count_total{job="${P2_SERVICE}"})`,
);
const pineconeCount = Number(pineconeCountResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.pinecone.operation.count > 0',
  pineconeCount > 0,
  `count=${pineconeCount}`,
);

// P2 store operation counter.
const storeCountResult = await promQuery(
  `sum(app_store_operation_count_total{job="${P2_SERVICE}"})`,
);
const storeCount = Number(storeCountResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.store.operation.count > 0',
  storeCount > 0,
  `count=${storeCount}`,
);

// P2 scheduling execution counter.
const schedCountResult = await promQuery(
  `sum(app_scheduling_execution_count_total{job="${P2_SERVICE}"})`,
);
const schedCount = Number(schedCountResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.scheduling.execution.count > 0',
  schedCount > 0,
  `count=${schedCount}`,
);

// P2 AI invocation counter (slow_llm + malformed_model scenarios produce 2 logical invocations).
const aiCountResult = await promQuery(
  `sum(app_ai_invocation_count_total{job="${P2_SERVICE}"})`,
);
const aiCount = Number(aiCountResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.ai.invocation.count > 0 (LLM scenarios)',
  aiCount === 3,
  `count=${aiCount}`,
);

// P2 AI attempt counter (one attempt per logical invocation).
const aiAttemptResult = await promQuery(
  `sum(app_ai_attempt_count_total{job="${P2_SERVICE}"})`,
);
const aiAttemptCount = Number(aiAttemptResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.ai.attempt.count > 0',
  aiAttemptCount === 3,
  `count=${aiAttemptCount}`,
);

// Exact fixture accounting must survive the entire SDK → collector → query path.
for (const [metric, expected] of [
  ['app_ai_tokens_total', 36], ['app_ai_usage_known_count_total', 2],
  ['app_ai_usage_unknown_count_total', 1],
]) {
  const points = await promQuery(`sum(${metric}{job="${P2_SERVICE}"})`);
  const observed = Number(points[0]?.value?.[1] ?? NaN);
  check(`Prometheus: exact ${metric}`, observed === expected, `expected=${expected} observed=${observed}`);
}
const durationUs = span => span.duration ?? 0;
check('Jaeger: controlled slow model localized', allSpans.some(span => span.operationName === 'ai.chat.attempt' && durationUs(span) >= 45_000));
check('Jaeger: controlled slow store localized', allSpans.some(span => span.operationName === 'store.read' && durationUs(span) >= 75_000));
check('Jaeger: caught matching timeout localized', findSpanTag(allSpans, 'vectorstore.semantic_similarity', 'error.type', 'timeout'));
check('Jaeger: fixture canary absent from exported telemetry', !JSON.stringify(traces).includes('SYNTHETIC_P2_PRIVATE_CANARY_48291'));

// P2 vectorstore operation counter.
const vsCountResult = await promQuery(
  `sum(app_vectorstore_operation_count_total{job="${P2_SERVICE}"})`,
);
const vsCount = Number(vsCountResult[0]?.value?.[1] ?? 0);
check(
  'Prometheus: app.vectorstore.operation.count > 0',
  vsCount > 0,
  `count=${vsCount}`,
);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n=== P2 Verify Summary ===');
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed checks:');
  results.filter((r) => !r.ok).forEach((r) => console.log(`  FAIL ${r.name}`));
}

// ─── Notes ────────────────────────────────────────────────────────────────────

console.log('\n[NOTE] Saved PromQL queries for investigation (each is a separate executable query):');
const promqlQueries = [
  {
    name: 'pinecone duration p50',
    query: `histogram_quantile(0.50, sum by (le, app_operation) (app_pinecone_operation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
  {
    name: 'pinecone duration p95',
    query: `histogram_quantile(0.95, sum by (le, app_operation) (app_pinecone_operation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
  {
    name: 'pinecone duration p99',
    query: `histogram_quantile(0.99, sum by (le, app_operation) (app_pinecone_operation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
  {
    name: 'store duration p95',
    query: `histogram_quantile(0.95, sum by (le, app_operation) (app_store_operation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
  {
    name: 'scheduling error rate',
    query: `rate(app_scheduling_execution_count_total{job="${P2_SERVICE}", app_outcome!="success"}[5m])`
  },
  {
    name: 'dependency duration by feature (p95)',
    query: `histogram_quantile(0.95, sum by (le, app_dependency, app_feature) (app_pinecone_operation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
  {
    name: 'AI invocation duration p95',
    query: `histogram_quantile(0.95, sum by (le, ai_model) (app_ai_invocation_duration_seconds_bucket{job="${P2_SERVICE}"}))`
  },
];
for (const q of promqlQueries) {
  console.log(`  [${q.name}]`);
  console.log(`    ${q.query}`);
}

console.log('\n[NOTE] Sparse data caveat: P2 scenarios run once; p95/p99 may equal p50 with < 20 data points.');
console.log('[NOTE] Overlapping duration explanation: parent span active duration may be LESS than the');
console.log('  arithmetic sum of overlapping concurrent child spans. Use parent wall-clock for end-to-end');
console.log('  duration; sum children only for serial (non-overlapping) execution breakdown.');
console.log('[NOTE] "empty"/"not_found"/"error"/"cancelled" outcomes now in privacy.ts OUTCOMES (P2 integration).');
console.log('[NOTE] Provider reconciliation: no real provider invoice to compare against (OBS-P2-S05 pending).');

process.exit(failed > 0 ? 1 : 0);
