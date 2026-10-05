import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { nodeFileTrace } from '@vercel/nft';

const root = process.cwd();
let fileList: Set<string>;
before(async () => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  ({ fileList } = await nodeFileTrace(['dist/index.js'], { base: root }));
});

test('NFR-073: the pinned Vercel tracer includes the worker used by pdf-parse', () => {
  const requirePdf = createRequire(import.meta.resolve('pdf-parse'));
  const worker = relative(root, requirePdf.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'));
  assert.ok(fileList.has(worker), `PDF worker missing from bundle: ${worker}`);
});

test('NFR-073: real PDF extraction and production health work with ONLY traced files', () => {
  const bundle = mkdtempSync(join(tmpdir(), 'nfr-073-traced-'));
  try {
    for (const file of fileList) {
      const dest = join(bundle, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(root, file), dest);
    }
    const output = execFileSync(process.execPath, [
      '--experimental-import-meta-resolve', 'tests/helpers/pdf-bundle-check.mjs',
      bundle, join(root, 'tests/fixtures/resume.pdf'),
    ], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_ENV: 'production', DATA_DIR: join(bundle, 'test-data'),
        JWT_SECRET: randomBytes(32).toString('hex'), APPLICANT_JWT_SECRET: randomBytes(32).toString('hex'),
        NODE_PATH: '' },
    });
    assert.match(output, /pdf-bundle=ok health=200 real-pdf=ok/);
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
});
