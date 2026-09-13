/**
 * NFR-001 regression tests: production-built JavaScript must run with the
 * same module semantics expected by Vercel's Node runtime.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams, port: number): Promise<Response> {
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`built server exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response;
    } catch {
      // Retry while the server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`built server did not become healthy: ${stderr}`);
}

test('NFR-001: compiled dist/index.js starts and serves /health under Node', async () => {
  const port = await availablePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'nfr-001-built-'));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const response = await waitForHealth(child, port);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).status, 'ok');
  } finally {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('NFR-001: compiled entrypoint can be imported as an ES module as Vercel does', () => {
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    "const mod = await import('./dist/index.js'); if (!mod.app) throw new Error('app export missing'); console.log('esm-app-export-ok');",
  ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(output, /esm-app-export-ok/);
});
