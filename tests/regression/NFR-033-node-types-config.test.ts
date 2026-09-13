/**
 * NFR-033 regression tests: Vercel production builds must resolve Node's type
 * declarations explicitly rather than relying on an environment-dependent default.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();

test('NFR-033: checked-in tsconfig explicitly points TypeScript at installed declaration packages', () => {
  const config = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  assert.ok(Array.isArray(config.compilerOptions.typeRoots), 'compilerOptions.typeRoots must be explicit');
  assert.ok(config.compilerOptions.typeRoots.includes('./node_modules/@types'));
});

test('NFR-033: effective TypeScript configuration preserves the explicit Node type root', () => {
  const shown = execFileSync('npx', ['tsc', '--showConfig'], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const config = JSON.parse(shown);
  assert.ok(Array.isArray(config.compilerOptions.typeRoots), 'effective compiler config must include typeRoots');
  assert.ok(config.compilerOptions.typeRoots.some((root: string) => root.endsWith('/node_modules/@types')));
});
