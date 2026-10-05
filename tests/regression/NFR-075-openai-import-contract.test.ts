import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('NFR-075: the OpenAI workaround dependency is declared and pinned', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.dependencies.openai ?? '', /^\d+\.\d+\.\d+$/, 'app must own its workaround dependency');
  const installed = JSON.parse(readFileSync('node_modules/openai/package.json', 'utf8'));
  assert.equal(pkg.dependencies.openai, installed.version);
});

test('NFR-075: the trace audit resolves ESM subpaths from their importing LangChain files', () => {
  const audit = readFileSync('tests/regression/NFR-071-vercel-bundle-trace.test.ts', 'utf8');
  assert.doesNotMatch(audit, /import\.meta\.resolve\(specifier\)/, 'root resolution can audit a different OpenAI copy');
  assert.match(audit, /--experimental-import-meta-resolve/, 'Node needs the parent-URL resolution flag');
  assert.match(audit, /import\.meta\.resolve\(specifier, importer\)/, 'each import must keep its parent URL');
});

// Positive control: installed TypeScript 7 already checks side-effect paths by default.
// This protects existing coverage, but is not counted as one of the required Red tests.
test('NFR-075: the compiler rejects nonexistent side-effect import subpaths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nfr-075-types-'));
  try {
    writeFileSync(join(dir, 'probe.ts'), "import 'openai/this-subpath-must-not-exist';\n");
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      extends: join(process.cwd(), 'tsconfig.json'),
      compilerOptions: { rootDir: dir, noEmit: true },
      include: ['./probe.ts'], exclude: [],
    }));
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', join(dir, 'tsconfig.json')], {
      encoding: 'utf8', timeout: 30000,
    });
    assert.notEqual(result.status, 0, 'typecheck silently accepted an invalid side-effect path');
    assert.match(result.stdout + result.stderr, /openai\/this-subpath-must-not-exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
