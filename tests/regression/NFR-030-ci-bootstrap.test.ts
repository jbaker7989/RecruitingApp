/**
 * NFR-030 regression tests: the repository must have an executable test
 * command and a CI gate that runs install, typecheck, build, test, and smoke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function packageJson(): any {
  return JSON.parse(readFileSync('package.json', 'utf8'));
}

function workflow(): string {
  return readFileSync('.github/workflows/ci.yml', 'utf8');
}

test('NFR-030: npm test runs the complete TypeScript test file pattern', () => {
  const script = packageJson().scripts?.test;
  assert.equal(script, 'tsx --test "tests/**/*.test.ts"');
});

test('NFR-030: GitHub Actions uses the mandated install → typecheck → build → test → smoke order', () => {
  const yaml = workflow();
  assert.match(yaml, /pull_request:/);
  assert.match(yaml, /push:/);
  assert.match(yaml, /runs-on:\s*ubuntu-latest/);
  const commands = [...yaml.matchAll(/^\s+run:\s*(.+)\s*$/gm)].map((match) => match[1].trim());
  assert.deepEqual(commands, [
    'npm ci',
    'npm run typecheck',
    'npm run build',
    'npm test',
    'npm run smoke',
  ]);
});

test('NFR-030: CI smoke script executes the built artifact and verifies health', () => {
  assert.equal(packageJson().scripts?.smoke, 'node scripts/ci-smoke.mjs');
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  const output = execFileSync('npm', ['run', 'smoke'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /smoke-health=ok/);
});

test('NFR-030: third-party CI actions are SHA-pinned and checkout credentials do not persist', () => {
  const yaml = workflow();
  const uses = [...yaml.matchAll(/^\s+uses:\s*([^\s#]+).*$/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/, `${action} must use a full commit SHA`);
  }
  assert.match(yaml, /persist-credentials:\s*false/);
});
