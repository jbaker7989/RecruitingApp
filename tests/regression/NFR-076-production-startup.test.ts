import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('NFR-076: every production-required signing secret is documented', () => {
  const source = readFileSync('src/services/tokenService.ts', 'utf8');
  const required = [...source.matchAll(/validateSecret\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(required.length >= 2);
  const example = readFileSync('.env.example', 'utf8');
  for (const name of required) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} must be in .env.example`);
  }
});

test('NFR-076: smoke boots the built server in development AND production with isolated secrets', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-smoke.mjs'], {
    env: { ...process.env, JWT_SECRET: '', APPLICANT_JWT_SECRET: '' },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /smoke-health=ok NODE_ENV=development/);
  assert.match(result.stdout, /smoke-health=ok NODE_ENV=production/);
});
