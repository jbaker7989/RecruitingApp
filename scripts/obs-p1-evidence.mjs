#!/usr/bin/env node
/**
 * OBS-P1-S07/S10 reproducible local evidence: overhead, fault injection, disable/restore.
 *
 *   node scripts/obs-p1-evidence.mjs [--requests 600] [--concurrency 20] [--out file.json] [--dist]
 *
 * Synthetic data only. Starts the app on loopback with a temporary DATA_DIR and a loopback
 * OTLP sink. No network egress, no paid services, no secrets. Budgets below are PROPOSED and
 * UNAPPROVED (OBS-P1-S07-AC1 still needs an approver); results are measurements, not acceptance.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const REQUESTS = Number(arg('requests', 600));
const CONCURRENCY = Number(arg('concurrency', 20));
const OUT = arg('out', null);
const USE_DIST = argv.includes('--dist');

const PROPOSED_BUDGET = { approved: false, maxP95OverheadRatio: 1.5, maxFaultP95OverheadRatio: 2.0, maxRssGrowthRatio: 1.5, minDeliveryCompleteness: 0.9 };

// Fixed, deterministic request mix → known expected statuses.
const MIX = [
  { path: '/health', expect: 200 },
  { path: '/ready', expect: [200, 401, 404, 503] }, // 401/404 until readiness is wired before authenticate by root
  { path: '/api/jobs', expect: 401 },
  { path: '/no-such-route', expect: 401 }, // global authenticate runs before 404
  { path: '/api/applicants/auth/google', expect: 503 },
];

function freePort() {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

function startSink(mode) {
  const stats = { requests: 0, spans: 0, metricsPosts: 0, bytes: 0 };
  const sockets = new Set();
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      stats.requests += 1;
      const body = Buffer.concat(chunks);
      stats.bytes += body.length;
      if (req.url?.includes('/v1/metrics')) stats.metricsPosts += 1;
      if (req.url?.includes('/v1/traces')) {
        try {
          const j = JSON.parse(body.toString('utf8'));
          for (const rs of j.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) stats.spans += (ss.spans ?? []).length;
        } catch { /* protobuf or compressed: spans stay uncounted */ }
      }
      if (mode === 'hang') return; // never respond
      if (mode === 'http500') { res.statusCode = 500; res.end(); return; }
      if (mode === 'drop') { req.socket.destroy(); return; }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({
    url: `http://127.0.0.1:${server.address().port}`,
    stats,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  })));
}

function rssKb(pid) {
  try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()); } catch { return null; }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

async function workload(base) {
  const lat = [];
  const statuses = {};
  let unexpected = 0;
  let next = 0;
  const started = process.hrtime.bigint();
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= REQUESTS) return;
      const item = MIX[i % MIX.length];
      const t0 = process.hrtime.bigint();
      let status = 0;
      try {
        const r = await fetch(`${base}${item.path}`, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'x-telemetry-synthetic': '1' } });
        status = r.status; await r.arrayBuffer();
      } catch { status = 0; }
      lat.push(Number(process.hrtime.bigint() - t0) / 1e6);
      statuses[status] = (statuses[status] ?? 0) + 1;
      const ok = Array.isArray(item.expect) ? item.expect.includes(status) : item.expect === status;
      if (!ok) unexpected += 1;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  lat.sort((a, b) => a - b);
  return {
    requests: REQUESTS, concurrency: CONCURRENCY, statuses, unexpected_status_count: unexpected,
    throughput_rps: Math.round((REQUESTS / seconds) * 10) / 10,
    latency_ms: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat[lat.length - 1] },
  };
}

async function runScenario(name, { telemetry, sinkMode, endpointOverride }) {
  const sink = sinkMode ? await startSink(sinkMode) : null;
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'obs-p1-evidence-'));
  // Keep fixture traffic isolated even when the developer shell or .env has live credentials.
  // Empty existing values prevent dotenv from loading real provider configuration.
  const env = { PATH: process.env.PATH, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn' };
  for (const key of [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET',
    'FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET', 'REDIS_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'OTEL_EXPORTER_OTLP_HEADERS', 'OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  ]) env[key] = '';
  env.TELEMETRY_ALLOW_REMOTE_EXPORT = 'false';
  env.TELEMETRY_ENVIRONMENT = 'test';
  env.TELEMETRY_RELEASE = 'p1-synthetic';
  env.TELEMETRY_ENABLED = telemetry ? 'true' : 'false';
  if (telemetry) {
    env.OTEL_EXPORTER_OTLP_ENDPOINT = endpointOverride ?? sink?.url ?? '';
    env.TELEMETRY_EXPORT_TIMEOUT_MS = '1000';
    env.TELEMETRY_SCHEDULE_DELAY_MS = '500';
    env.TELEMETRY_METRIC_INTERVAL_MS = '1000';
  }
  const cmd = USE_DIST ? ['dist/index.js'] : ['--import', 'tsx', 'src/index.ts'];
  const child = spawn(process.execPath, cmd, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logTail = '';
  const keep = (c) => { logTail = `${logTail}${c}`.slice(-4000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const base = `http://127.0.0.1:${port}`;
  const result = { scenario: name, telemetry_enabled: telemetry, sink_mode: sinkMode ?? 'none' };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try { up = (await fetch(`${base}/health`)).status === 200; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    if (!up) throw new Error('server did not become healthy');
    await workload(base); // warm-up (not recorded)
    const rssBefore = rssKb(child.pid);
    Object.assign(result, await workload(base));
    result.rss_kb = { before: rssBefore, after: rssKb(child.pid) };
    const ready = await fetch(`${base}/ready`).catch(() => null);
    result.readiness = ready ? { status_code: ready.status, body: await ready.json().catch(() => null) } : null;
    const t0 = Date.now();
    child.kill('SIGTERM');
    await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r(); }, 10000); child.once('exit', () => { clearTimeout(t); r(); }); });
    result.shutdown_ms = Date.now() - t0;
    if (sink) result.sink = { ...sink.stats };
    result.safe_log_tail_has_secret_like_values = /Bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}/.test(logTail);
  } catch (err) {
    result.error = err instanceof Error ? err.message.slice(0, 200) : 'error';
    child.kill('SIGKILL');
  } finally {
    if (sink) await sink.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  return result;
}

const gitRev = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo }).toString().trim(); } catch { return 'unknown'; } })();
const closedPort = await freePort();

const scenarios = [];
scenarios.push(await runScenario('baseline_disabled', { telemetry: false }));
scenarios.push(await runScenario('enabled_sink_ok', { telemetry: true, sinkMode: 'ok' }));
scenarios.push(await runScenario('fault_sink_http500', { telemetry: true, sinkMode: 'http500' }));
scenarios.push(await runScenario('fault_sink_hang', { telemetry: true, sinkMode: 'hang' }));
scenarios.push(await runScenario('fault_sink_connection_drop', { telemetry: true, sinkMode: 'drop' }));
scenarios.push(await runScenario('fault_backend_unreachable', { telemetry: true, endpointOverride: `http://127.0.0.1:${closedPort}` }));
scenarios.push(await runScenario('restore_enabled_sink_ok', { telemetry: true, sinkMode: 'ok' }));

const base = scenarios[0];
const checks = scenarios.slice(1).map((s) => {
  const p95Ratio = s.latency_ms && base.latency_ms ? Math.round((s.latency_ms.p95 / base.latency_ms.p95) * 100) / 100 : null;
  const faulty = s.scenario.startsWith('fault_');
  const rssRatio = s.rss_kb?.after && base.rss_kb?.after ? Math.round((s.rss_kb.after / base.rss_kb.after) * 100) / 100 : null;
  return {
    scenario: s.scenario,
    p95_ratio_vs_disabled: p95Ratio,
    within_proposed_p95_budget: p95Ratio === null ? null : p95Ratio <= (faulty ? PROPOSED_BUDGET.maxFaultP95OverheadRatio : PROPOSED_BUDGET.maxP95OverheadRatio),
    rss_ratio_vs_disabled: rssRatio,
    within_proposed_rss_budget: rssRatio === null ? null : rssRatio <= PROPOSED_BUDGET.maxRssGrowthRatio,
    user_visible_behavior_unchanged: s.unexpected_status_count === 0 && JSON.stringify(s.statuses) === JSON.stringify(base.statuses),
    shutdown_ms: s.shutdown_ms,
    telemetry_reached_sink: s.sink ? s.sink.requests > 0 : null,
    spans_received_by_sink: s.sink?.spans ?? null,
    error: s.error ?? null,
  };
});

const report = {
  generated_at: new Date().toISOString(),
  environment: { kind: 'local-loopback-synthetic', node: process.version, platform: `${process.platform}-${process.arch}`, revision: gitRev, entry: USE_DIST ? 'dist/index.js' : 'tsx src/index.ts' },
  proposed_budget_UNAPPROVED: PROPOSED_BUDGET,
  telemetry_wired_detected: scenarios.some((s) => (s.sink?.requests ?? 0) > 0),
  readiness_wired_detected: scenarios.some((s) => [200, 503].includes(s.readiness?.status_code)),
  limitations: [
    'Local loopback only: says nothing about Vercel cold starts, forced termination loss, or hosted backend delivery (pending).',
    'Budgets are proposals without an approver (OBS-P1-S07-AC1 open); "within" flags are informational, not acceptance.',
    'Delivery completeness is not computed here: span counts depend on sampling/exclusions (/health is excluded by design) and a protobuf sink body is uncounted.',
    'Single short run on a developer machine is noisy; repeat and compare before drawing conclusions.',
  ],
  scenarios,
  checks,
};
const text = JSON.stringify(report, null, 2);
if (OUT) { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(resolve(OUT), `${text}\n`); }
console.log(text);
