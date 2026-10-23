// Legacy JSON → PostgreSQL migration (NFR-034). Logic only; CLI is scripts/migrate-json-to-db.mjs.
// Reports counts, never record contents. Never overwrites existing target rows.
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { COLLECTIONS, withMigrationTransaction, tablesExist, getPool, ensureSchema } from './pgBackend.js';

export interface MigrationOptions {
  dataDir: string;
  databaseUrl?: string;
  dryRun?: boolean;
  allowNonEmptyTarget?: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  outcome: 'migrated' | 'already_migrated' | 'dry_run_ok' | 'refused';
  reason?: string;
  source: Record<string, number>;
  target: Record<string, number> | null;
  inserted: Record<string, number>;
  conflicts: number;
}

type Rec = { id?: unknown } & Record<string, unknown>;

async function readSource(dataDir: string): Promise<{ records: Record<string, Rec[]>; audit: Rec[] }> {
  const storeFile = join(resolve(dataDir), 'store.json');
  if (!existsSync(storeFile)) throw new Error(`Source not found: ${storeFile}`);
  const parsed = JSON.parse(await readFile(storeFile, 'utf-8'));
  const records: Record<string, Rec[]> = {};
  for (const c of COLLECTIONS) {
    const list = parsed[c] ?? [];
    if (!Array.isArray(list)) throw new Error(`Source collection ${c} is not an array`);
    const ids = new Set<string>();
    for (const r of list) {
      if (!r || typeof r.id !== 'string' || r.id === '') throw new Error(`Source ${c} contains a record without a string id`);
      if (ids.has(r.id)) throw new Error(`Source ${c} contains a duplicate id`);
      ids.add(r.id);
    }
    records[c] = list;
  }
  const obsFile = join(resolve(dataDir), 'observability.json');
  const audit: Rec[] = [];
  const seen = new Map<string, string>();
  // Absent => nothing to import; present but not an array, or malformed entries, is rejected
  // (generic messages only — never record contents). Identical duplicates dedupe; conflicting ones fail.
  const add = (list: unknown, origin: string) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) throw new Error(`Source audit data (${origin}) is not an array`);
    for (const r of list as Rec[]) {
      if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || r.id === '') {
        throw new Error(`Source audit entry (${origin}) is malformed or has no string id`);
      }
      const c = canon(r);
      const prior = seen.get(r.id);
      if (prior === undefined) { seen.set(r.id, c); audit.push(r); }
      else if (prior !== c) throw new Error(`Source audit contains conflicting entries sharing one id (${origin}); refusing to discard data`);
    }
  };
  if (existsSync(obsFile)) {
    const obs = JSON.parse(await readFile(obsFile, 'utf-8'));
    if (!obs || typeof obs !== 'object' || Array.isArray(obs)) throw new Error('Source observability.json is malformed');
    add(obs.logs, 'observability.json');
  }
  add(parsed.observability, 'store.json observability'); // legacy: audit rows once kept inside store.json
  return { records, audit };
}

const count = (r: Record<string, Rec[]>, audit: Rec[]): Record<string, number> => ({ ...Object.fromEntries(COLLECTIONS.map((c) => [c, r[c].length])), audit: audit.length });

/** Stable comparison independent of jsonb key ordering. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export async function migrateJsonToDb(opts: MigrationOptions): Promise<MigrationReport> {
  const { records, audit } = await readSource(opts.dataDir);
  const source = count(records, audit);
  const emptyInserted = Object.fromEntries(Object.keys(source).map((k) => [k, 0]));

  if (!opts.databaseUrl) {
    if (!opts.dryRun) throw new Error('DATABASE_URL is required unless --dry-run');
    return { dryRun: true, outcome: 'dry_run_ok', source, target: null, inserted: emptyInserted, conflicts: 0 };
  }
  const url = opts.databaseUrl;

  // Dry-run must not create schema: inspect only if tables already exist.
  if (opts.dryRun && !(await tablesExist(url))) {
    return { dryRun: true, outcome: 'dry_run_ok', source, target: Object.fromEntries(Object.keys(source).map((k) => [k, 0])), inserted: emptyInserted, conflicts: 0 };
  }
  if (!opts.dryRun) await ensureSchema(url);

  const run = async (client: { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Promise<MigrationReport> => {
    const existing = new Map<string, string>();
    const rows = await client.query('SELECT collection, id, data FROM app_records');
    for (const r of rows.rows) existing.set(`${r.collection}\u0000${r.id}`, canon(r.data));
    const auditRows = await client.query('SELECT id, data FROM audit_log');
    const existingAudit = new Map<string, string>(auditRows.rows.map((r) => [r.id, canon(r.data)]));
    const target = { ...Object.fromEntries(COLLECTIONS.map((c) => [c, 0])), audit: existingAudit.size } as Record<string, number>;
    for (const r of rows.rows) target[r.collection] = (target[r.collection] ?? 0) + 1;
    const targetTotal = rows.rows.length + existingAudit.size;

    let conflicts = 0;
    let missing = 0;
    const sourceKeys = new Set<string>();
    const toInsert: Array<{ c: string; r: Rec }> = [];
    for (const c of COLLECTIONS) {
      for (const r of records[c]) {
        const key = `${c}\u0000${r.id}`;
        sourceKeys.add(key);
        const have = existing.get(key);
        if (have === undefined) { missing++; toInsert.push({ c, r }); }
        else if (have !== canon(r)) conflicts++;
      }
    }
    const auditInsert: Rec[] = [];
    for (const r of audit) {
      const have = existingAudit.get(r.id as string);
      if (have === undefined) { missing++; auditInsert.push(r); }
      else if (have !== canon(r)) conflicts++;
    }
    const extras = targetTotal - (source_total(source) - missing);
    const base = { dryRun: !!opts.dryRun, source, target, conflicts };
    const refuse = (reason: string): MigrationReport => ({ ...base, outcome: 'refused', reason, inserted: emptyInserted });

    if (conflicts > 0) return refuse(`${conflicts} record(s) exist in the target with different content; refusing to overwrite`);
    if (targetTotal > 0 && missing === 0 && extras === 0) {
      return { ...base, outcome: opts.dryRun ? 'dry_run_ok' : 'already_migrated', inserted: emptyInserted };
    }
    if (targetTotal > 0 && !opts.allowNonEmptyTarget) {
      return refuse('target database is not empty and does not exactly match the source; use --allow-nonempty-target to insert only missing records');
    }

    const inserted = { ...emptyInserted } as Record<string, number>;
    for (const { c } of toInsert) inserted[c]++;
    inserted.audit = auditInsert.length;
    if (opts.dryRun) return { ...base, outcome: 'dry_run_ok', inserted };

    for (const c of COLLECTIONS) {
      const list = toInsert.filter((x) => x.c === c).map((x) => x.r);
      if (!list.length) continue;
      await client.query(
        `INSERT INTO app_records (collection, id, data)
         SELECT $1, i, d::jsonb FROM unnest($2::text[], $3::text[]) AS t(i, d) ON CONFLICT (collection, id) DO NOTHING`,
        [c, list.map((r) => r.id), list.map((r) => JSON.stringify(r))],
      );
    }
    if (auditInsert.length) {
      await client.query(
        // Strict insert: an id collision (e.g. a concurrent audit append, which does not take the migration lock)
        // raises a unique violation and rolls the whole migration back instead of silently skipping.
        `INSERT INTO audit_log (id, data) SELECT i, d::jsonb FROM unnest($1::text[], $2::text[]) AS t(i, d)`,
        [auditInsert.map((r) => r.id), auditInsert.map((r) => JSON.stringify(r))],
      );
    }
    // Verify inside the same transaction: every source record must now be present.
    const after = await client.query('SELECT collection, count(*)::int AS n FROM app_records GROUP BY collection');
    const got = Object.fromEntries(after.rows.map((r) => [r.collection, r.n]));
    for (const c of COLLECTIONS) {
      if ((got[c] ?? 0) < source[c]) throw new Error(`Verification failed for ${c}: expected at least ${source[c]}, found ${got[c] ?? 0}`);
    }
    const auditAfter = await client.query('SELECT count(*)::int AS n FROM audit_log');
    if (auditAfter.rows[0].n < source.audit) throw new Error('Verification failed for audit');
    return { ...base, outcome: 'migrated', inserted };
  };

  if (opts.dryRun) return run(getPool(url));
  return withMigrationTransaction(url, run);
}

function source_total(s: Record<string, number>): number {
  return Object.values(s).reduce((a, b) => a + b, 0);
}
