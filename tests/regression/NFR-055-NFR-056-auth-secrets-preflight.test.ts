/**
 * NFR-055: no native bcrypt dependency (pure-JS bcryptjs only).
 * NFR-056: production auth-secret policy is enforced by a deploy-time preflight,
 * not only by a cold-start crash; .env.example documents the variables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { authSecretProblems } from '../../src/config/authSecrets.js';

const STRONG_A = 'a'.repeat(40);
const STRONG_B = 'b'.repeat(40);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('NFR-055: package.json has no native bcrypt dependency', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps.bcryptjs, 'bcryptjs must be declared');
  assert.equal(deps.bcrypt, undefined);
  assert.equal(deps['@types/bcrypt'], undefined);
});

test('NFR-055: no source file imports native bcrypt', () => {
  for (const file of sourceFiles('src')) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]bcrypt['"]|require\(['"]bcrypt['"]\)/, file);
  }
});

test('NFR-056: policy accepts two strong distinct secrets', () => {
  assert.deepEqual(authSecretProblems({ JWT_SECRET: STRONG_A, APPLICANT_JWT_SECRET: STRONG_B }), []);
});

test('NFR-056: policy reports missing, short, default and identical secrets without echoing values', () => {
  const missing = authSecretProblems({});
  assert.equal(missing.length, 2);
  const short = authSecretProblems({ JWT_SECRET: 'short-secret-value', APPLICANT_JWT_SECRET: STRONG_B });
  assert.match(short[0], /JWT_SECRET is too short/);
  assert.ok(!short.join().includes('short-secret-value'));
  const dev = authSecretProblems({ JWT_SECRET: 'dev-user-jwt-secret-change-in-production', APPLICANT_JWT_SECRET: STRONG_B });
  assert.match(dev[0], /dev default/);
  assert.match(authSecretProblems({ JWT_SECRET: STRONG_A, APPLICANT_JWT_SECRET: STRONG_A })[0], /must differ/);
});

test('NFR-056: preflight is skipped outside production', () => {
  const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /preflight=skipped/);
});

test('NFR-056: preflight fails the build in production when secrets are missing, passes when valid', () => {
  execFileSync('npx', ['tsc'], { stdio: 'ignore' });
  const base = { ...process.env, NODE_ENV: 'production' };
  delete base.JWT_SECRET;
  delete base.APPLICANT_JWT_SECRET;
  const bad = spawnSync(process.execPath, ['scripts/preflight.mjs'], { env: base, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /preflight=failed/);
  assert.match(bad.stderr, /JWT_SECRET is required/);
  const good = spawnSync(process.execPath, ['scripts/preflight.mjs'], {
    env: { ...base, JWT_SECRET: STRONG_A, APPLICANT_JWT_SECRET: STRONG_B }, encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /preflight=ok/);
});

test('NFR-056: .env.example documents both secrets and package.json wires preflight into the Vercel build', () => {
  const env = readFileSync('.env.example', 'utf8');
  assert.match(env, /^JWT_SECRET=/m);
  assert.match(env, /^APPLICANT_JWT_SECRET=/m);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts['vercel-build'], /preflight/);
  assert.ok(pkg.scripts.preflight);
});
