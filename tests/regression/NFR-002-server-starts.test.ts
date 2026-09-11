/**
 * NFR-002: Server never starts — start() is defined and exported in
 * src/index.ts but never invoked; no entrypoint guard exists.
 *
 * Bug evidence (BUGS.md):
 *   - `npx tsx src/index.ts` exits silently; no "server running" banner; no listener
 *   - curl http://localhost:3000/health → connection refused
 *
 * These tests spawn the actual entrypoint (node --import tsx src/index.ts)
 * as a child process against an isolated temp DATA_DIR and assert that:
 *   1. /health responds 200
 *   2. the startup observability entry is written (proves start() executed)
 *   3. the process stays alive and prints the startup banner
 * All three fail pre-fix (start() is never called) and must pass post-fix.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

let dataDir: string;
let port: number;
let child: ChildProcess | null = null;
let childOutput = '';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, () => {
      const p = (s.address() as any).port as number;
      s.close(() => res(p));
    });
  });
}

async function startEntrypoint() {
  childOutput = '';
  const c = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout?.on('data', (d) => { childOutput += d.toString(); });
  c.stderr?.on('data', (d) => { childOutput += d.toString(); });
  child = c;
  return c;
}

async function stopEntrypoint() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(300);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  child = null;
}

async function waitForHealth(maxMs = 25000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false; // process died — stop polling early
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(400);
  }
  return false;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr002-'));
  port = await freePort();
});

after(async () => {
  await stopEntrypoint();
  rmSync(dataDir, { recursive: true, force: true });
});

test('NFR-002: running the entrypoint serves GET /health with 200', { timeout: 40000 }, async () => {
  await startEntrypoint();
  try {
    const healthy = await waitForHealth();
    assert.ok(healthy, `entrypoint did not serve /health. exitCode=${child?.exitCode} output=${childOutput.trim() || '(none)'}`);
    const body = await (await fetch(`http://localhost:${port}/health`)).json() as any;
    assert.equal(body.status, 'ok');
  } finally {
    await stopEntrypoint();
  }
});

test('NFR-002: running the entrypoint executes start() — startup observability entry is written', { timeout: 40000 }, async () => {
  await startEntrypoint();
  try {
    const healthy = await waitForHealth();
    assert.ok(healthy, `entrypoint never came up. exitCode=${child?.exitCode} output=${childOutput.trim() || '(none)'}`);
    const obsFile = join(dataDir, 'observability.json');
    assert.ok(existsSync(obsFile), 'observability.json must exist after startup');
    const logs = JSON.parse(readFileSync(obsFile, 'utf-8')).logs as any[];
    assert.ok(
      logs.some((l) => l.action === 'startup' && l.entityType === 'System'),
      `expected a 'startup' observability entry proving start() ran; got ${logs.length} entries`
    );
  } finally {
    await stopEntrypoint();
  }
});

test('NFR-002: entrypoint process stays alive and prints the startup banner', { timeout: 40000 }, async () => {
  await startEntrypoint();
  try {
    const healthy = await waitForHealth();
    assert.ok(healthy, `entrypoint never came up. exitCode=${child?.exitCode} output=${childOutput.trim() || '(none)'}`);
    assert.equal(child?.exitCode, null, 'server process must still be running (listener bound)');
    assert.match(childOutput, /server running on port/i, `expected startup banner in output; got: ${childOutput.trim() || '(none)'}`);
  } finally {
    await stopEntrypoint();
  }
});
