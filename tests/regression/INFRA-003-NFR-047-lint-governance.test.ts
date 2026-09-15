/**
 * INFRA-003 / NFR-047 governance tests: linting must be an enforced
 * development and CI gate before implementation work proceeds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function packageJson(): any {
  return JSON.parse(readFileSync('package.json', 'utf8'));
}

function workflow(): string {
  return readFileSync('.github/workflows/ci.yml', 'utf8');
}

test('INFRA-003/NFR-047: package.json defines an ESLint lint script for source and tests', () => {
  const script = packageJson().scripts?.lint;

  assert.ok(script, 'package.json must define scripts.lint');
  assert.match(script, /eslint/, 'scripts.lint must invoke ESLint');
  assert.match(script, /src/, 'scripts.lint must include src TypeScript files');
  assert.match(script, /tests/, 'scripts.lint must include test TypeScript files');
});

test('INFRA-003/NFR-047: CI runs lint after typecheck and before build/test/smoke', () => {
  const commands = [...workflow().matchAll(/^\s+run:\s*(.+)\s*$/gm)].map((match) => match[1].trim());

  assert.ok(commands.includes('npm run lint'), 'CI must run npm run lint');
  assert.deepEqual(commands, [
    'npm ci',
    'npm run typecheck',
    'npm run lint',
    'npm run build',
    'npm test',
    'npm run smoke',
  ]);
});
