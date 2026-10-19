// Local, synthetic-only proof (OBS-P1-S01/S03/S05 local evidence): runs the app with telemetry exporting to the
// local collector stack, sends deterministic traffic, then queries Jaeger (trace), Prometheus (histogram) and
// Loki (structured log). Prerequisite: docker compose -f observability/local/docker-compose.yml up -d
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runId = `v-${randomUUID().slice(0, 8)}`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, 'observability/local/logs');
mkdirSync(logDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const logFile = createWriteStream(join(logDir, 'app.log'), { flags: 'a' });

const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
    FACEBOOK_CLIENT_ID: '', FACEBOOK_CLIENT_SECRET: '', REDIS_URL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '',
    OTEL_EXPORTER_OTLP_HEADERS: '', OTEL_EXPORTER_OTLP_TRACES_HEADERS: '', OTEL_EXPORTER_OTLP_METRICS_HEADERS: '',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '',
    TELEMETRY_ALLOW_REMOTE_EXPORT: 'false', OTEL_SERVICE_NAME: runId,
    PORT: String(port), DATA_DIR: mkdtempSync(join(tmpdir(), 'rec-app-otel-')),
    TELEMETRY_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    TELEMETRY_ENVIRONMENT: 'local', TELEMETRY_RELEASE: runId, RELEASE_ID: runId, TELEMETRY_METRIC_INTERVAL_MS: '1000', TELEMETRY_SCHEDULE_DELAY_MS: '500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(logFile, { end: false });
child.stderr.pipe(logFile, { end: false });

const base = `http://127.0.0.1:${port}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
try {
  for (let i = 0; i < 50; i += 1) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ } await sleep(200); }
  // Six deterministic unauthenticated requests; global authentication returns 401.
  for (let i = 0; i < 3; i += 1) await fetch(`${base}/`);
  for (let i = 0; i < 2; i += 1) await fetch(`${base}/api/jobs`);
  await fetch(`${base}/no/such/route/${Date.now()}`);
  await sleep(4000); // batch + metric interval + collector

  const jt = await (await fetch(`http://127.0.0.1:16686/api/traces?service=${runId}&limit=20`)).json();
  check('Jaeger: traces from this verification run', Array.isArray(jt.data) && jt.data.length > 0, `${jt.data?.length ?? 0} traces`);

  const q = encodeURIComponent(`sum(http_server_request_duration_seconds_count{job="${runId}"})`);
  const pm = await (await fetch(`http://127.0.0.1:9090/api/v1/query?query=${q}`)).json();
  const total = Number(pm.data?.result?.[0]?.value?.[1] ?? 0);
  check('Prometheus: histogram count covers the 6 eligible requests', total === 6, `count=${total}`);
  const p95 = encodeURIComponent(`histogram_quantile(0.95, sum by (le) (http_server_request_duration_seconds_bucket{job="${runId}"}))`);
  const pq = await (await fetch(`http://127.0.0.1:9090/api/v1/query?query=${p95}`)).json();
  check('Prometheus: p95 query executes', pq.status === 'success' && pq.data?.result?.length > 0 && Number.isFinite(Number(pq.data.result[0].value[1])));

  const end = Date.now() * 1e6;
  const lq = encodeURIComponent(`{service_name="rec-app"} | json | release="${runId}"`);
  const lk = await (await fetch(`http://127.0.0.1:3100/loki/api/v1/query_range?query=${lq}&limit=20&start=${end - 3600e9}&end=${end}`)).json();
  const lines = (lk.data?.result ?? []).reduce((n, s) => n + s.values.length, 0);
  check('Loki: structured app log lines searchable', lines > 0, `${lines} lines`);
} catch (err) {
  check('verification run', false, err instanceof Error ? err.name : 'error');
} finally {
  child.kill('SIGTERM');
  await sleep(500);
  logFile.end();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
