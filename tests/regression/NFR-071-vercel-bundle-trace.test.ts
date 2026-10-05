/**
 * NFR-071 regression tests: the Vercel function bundle must contain every
 * file the built server loads, and a deployed build must be health-checked.
 *
 * Vercel builds the function with @vercel/nft. nft cannot resolve
 * `openai/lib/responses/ResponseInputItems.js` (imported by @langchain/openai),
 * so the file was left out of the bundle and every production request failed
 * with ERR_MODULE_NOT_FOUND while the build itself stayed green.
 *
 * @vercel/nft is pinned to the version Vercel's builder ships (1.10.0); newer
 * releases resolve the import, so an unpinned tracer would hide the defect.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const repoRoot = process.cwd();
const langchainOpenAiDist = dirname(fileURLToPath(import.meta.resolve('@langchain/openai')));

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

// openai subpaths that @langchain/openai's ESM build imports at module load.
function openAiSubpathImports(): { specifier: string; importer: string }[] {
  const imports = [];
  for (const file of jsFiles(langchainOpenAiDist)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/from "(openai\/[^"]+)"/g)) {
      imports.push({ specifier: match[1], importer: pathToFileURL(file).href });
    }
  }
  return imports;
}

test('NFR-071: Vercel file trace of dist/index.js includes every openai file @langchain/openai imports', async () => {
  const { fileList } = await nodeFileTrace(['dist/index.js'], { base: repoRoot });
  const specifiers = openAiSubpathImports();
  assert.ok(specifiers.length > 0, 'expected @langchain/openai to import openai subpaths');

  // NFR-075: use Node's ESM import conditions and each LangChain importer URL,
  // not the root's hoisted OpenAI copy or createRequire's CJS export conditions.
  const resolved: string[] = JSON.parse(execFileSync(process.execPath, [
    '--experimental-import-meta-resolve', '--input-type=module', '--eval',
    `const imports = JSON.parse(process.argv[1]);
     console.log(JSON.stringify(imports.map(({ specifier, importer }) => import.meta.resolve(specifier, importer))));`,
    JSON.stringify(specifiers),
  ], { encoding: 'utf8' }));
  const missing = resolved
    .map((url) => relative(repoRoot, fileURLToPath(url)))
    .filter((file) => !fileList.has(file));

  assert.deepEqual(missing, [], `files missing from the Vercel function bundle: ${missing.join(', ')}`);
});

test('NFR-071: a deployment health gate exists and runs against Vercel deployments', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
  assert.match(scripts['verify:deploy'] ?? '', /verify-deployment\.mjs/, 'package.json must define scripts.verify:deploy');
  assert.ok(existsSync('scripts/verify-deployment.mjs'), 'scripts/verify-deployment.mjs must exist');

  const workflowPath = '.github/workflows/deploy-verify.yml';
  assert.ok(existsSync(workflowPath), `${workflowPath} must exist`);
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /deployment_status/, 'gate must trigger on deployment_status events');
  assert.match(workflow, /npm run verify:deploy/, 'gate must run npm run verify:deploy');
});
