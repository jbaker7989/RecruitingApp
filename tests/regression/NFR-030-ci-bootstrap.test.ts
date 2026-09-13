/**
 * NFR-030 regression tests: the repository must have an executable test
 * command and a CI gate that runs tests, typecheck, and build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function packageJson(): any {
  return JSON.parse(readFileSync('package.json', 'utf8'));
}

test('NFR-030: npm test runs the TypeScript test suite instead of a failing placeholder', () => {
  const script = packageJson().scripts?.test;
  assert.equal(typeof script, 'string');
  assert.doesNotMatch(script, /no test specified/i);
  assert.match(script, /tsx\s+--test/);
  assert.match(script, /tests/);
});

test('NFR-030: GitHub Actions gates pull requests and pushes on tests, typecheck, and build', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run build/);
});
