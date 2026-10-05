import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

for (const status of [302, 401]) {
  test(`NFR-074: protected preview HTTP ${status} fails even with legacy ALLOW_PROTECTED`, async () => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { Location: 'https://vercel.com/login' });
      res.end('Protected');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const child = spawn(process.execPath, ['scripts/verify-deployment.mjs'], {
      env: { ...process.env, DEPLOYMENT_URL: `http://127.0.0.1:${address.port}`,
        ALLOW_PROTECTED: 'true', VERCEL_AUTOMATION_BYPASS_SECRET: '' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      assert.equal(code, 1, output);
      assert.match(output, /deploy-health=failed/);
      assert.doesNotMatch(output, /deploy-health=skipped/);
    } finally {
      child.kill();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test('NFR-074: workflow cannot opt into silently skipping protected deployments', () => {
  const workflow = readFileSync('.github/workflows/deploy-verify.yml', 'utf8');
  assert.doesNotMatch(workflow, /ALLOW_PROTECTED/);
  assert.match(workflow, /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/);
});
