import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function smoke(nodeEnv) {
  const port = await availablePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'rec-app-ci-smoke-'));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: nodeEnv,
      ...(nodeEnv === 'production' ? {
        JWT_SECRET: randomBytes(32).toString('hex'),
        APPLICANT_JWT_SECRET: randomBytes(32).toString('hex'),
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000); });

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`built server exited ${child.exitCode}\n${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        const payload = await response.json();
        if (response.status === 200 && payload.status === 'ok') {
          healthy = true;
          break;
        }
      } catch {
        // Retry only during bounded process startup.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!healthy) throw new Error(`built server health check timed out\n${output}`);
    console.log(`smoke-health=ok NODE_ENV=${nodeEnv}`);
  } finally {
    child.kill('SIGTERM');
    await closed;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

await smoke('development');
await smoke('production');
