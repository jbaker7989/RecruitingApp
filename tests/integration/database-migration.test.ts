import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
const schema = `nfr_migration_${process.pid}_${Date.now()}`;
let dataDir = '';

if (databaseRequired && !databaseUrl) throw new Error('DB_TEST_REQUIRED=true requires DATABASE_URL');

function runMigration(args: string[], overrides: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/migrate-json-to-db.mjs', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, USE_DATABASE: 'true', NODE_ENV: 'test', ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('NFR-034 JSON-to-PostgreSQL migration', { skip: !runDatabaseTests }, () => {
  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'nfr-db-migration-'));
    const timestamp = new Date().toISOString();
    await writeFile(join(dataDir, 'store.json'), JSON.stringify({
      companies: [{ id: 'migration-company', companyName: 'Migration Co', description: '', location: '', companySize: '', industry: '', createdAt: timestamp, updatedAt: timestamp }],
      jobs: [], applicants: [], applications: [], users: [], hires: [], drafts: [], passwordResetTokens: [], observability: [],
    }));
    await writeFile(join(dataDir, 'observability.json'), JSON.stringify({ logs: [{
      id: 'migration-audit', timestamp, action: 'migration_fixture', entityType: 'System', entityId: 'fixture', userId: 'test', details: {}, outcome: 'success',
    }] }));
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  after(async () => {
    if (databaseUrl) {
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  test('dry-run validates and reports without creating target rows', async () => {
    const result = await runMigration(['--dry-run', '--data-dir', dataDir]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /dry.run/i);
    const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await client.connect();
    const exists = await client.query(`SELECT to_regclass('app_records') AS table_name`);
    assert.equal(exists.rows[0].table_name, null);
    await client.end();
  });

  test('migration is idempotent and preserves records plus audit data', async () => {
    const first = await runMigration(['--data-dir', dataDir]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const second = await runMigration(['--data-dir', dataDir]);
    assert.equal(second.code, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /(already[_ ]migrated|no.op|idempotent)/i);

    const client = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await client.connect();
    const records = await client.query('SELECT collection, id FROM app_records ORDER BY collection, id');
    const audit = await client.query('SELECT id FROM audit_log ORDER BY id');
    assert.deepEqual(records.rows, [{ collection: 'companies', id: 'migration-company' }]);
    assert.deepEqual(audit.rows, [{ id: 'migration-audit' }]);
    await client.end();
  });

  test('audit migration rejects malformed and conflicting records without exposing content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nfr-invalid-audit-'));
    try {
      await writeFile(join(dir, 'store.json'), JSON.stringify({ observability: [] }));
      for (const logs of [{ invalid: true }, [{ id: 'duplicate', action: 'one' }, { id: 'duplicate', action: 'two' }]]) {
        await writeFile(join(dir, 'observability.json'), JSON.stringify({ logs }));
        const result = await runMigration(['--dry-run', '--data-dir', dir], { DATABASE_URL: '' });
        assert.notEqual(result.code, 0);
      }
      await writeFile(join(dir, 'observability.json'), JSON.stringify({ logs: [{ id: 'same' }, { id: 'same' }] }));
      const identical = await runMigration(['--dry-run', '--data-dir', dir], { DATABASE_URL: '' });
      assert.equal(identical.code, 0, identical.stderr);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('non-empty conflicting target is protected', async () => {
    const conflictSchema = `${schema}_conflict`;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${conflictSchema}"`);
    await client.end();

    const first = await runMigration(['--data-dir', dataDir], { DATABASE_SCHEMA: conflictSchema });
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const conflictClient = new pg.Client({ connectionString: databaseUrl, options: `-c search_path=${conflictSchema}` });
    await conflictClient.connect();
    await conflictClient.query(`UPDATE app_records SET data = jsonb_set(data, '{companyName}', '"Changed"'::jsonb) WHERE collection = 'companies' AND id = 'migration-company'`);
    await conflictClient.end();
    const protectedResult = await runMigration(['--data-dir', dataDir], { DATABASE_SCHEMA: conflictSchema });
    assert.equal(protectedResult.code, 2, protectedResult.stderr || protectedResult.stdout);
    assert.match(`${protectedResult.stdout}\n${protectedResult.stderr}`, /(conflict|non.empty|refus)/i);

    const cleanup = new pg.Client({ connectionString: databaseUrl });
    await cleanup.connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS "${conflictSchema}" CASCADE`);
    await cleanup.end();
  });
});

test('database migration prerequisite is explicit', { skip: runDatabaseTests }, () => {
  assert.equal(databaseRequired, false, 'DB_TEST_REQUIRED=true must provide DATABASE_URL');
});
