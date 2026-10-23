// PostgreSQL backend for the store facade (NFR-034). See docs/implementation/db-storage-contract.md.
//
// Layout: one typed-record table (collection, id, seq, data JSONB) preserves the exact record
// shape of every collection without per-column drift, plus an append-only audit_log table.
// Writers are serialized across processes with a transaction-scoped advisory lock and commit
// only the records that actually changed (never a blind snapshot overwrite).
import pg from 'pg';
import type { DataStore, ObservabilityLog } from './store.js';

const { Pool } = pg;
type PoolT = InstanceType<typeof Pool>;
type ClientT = pg.PoolClient;

export const SCHEMA_VERSION = 1;
export const COLLECTIONS = ['companies', 'jobs', 'applicants', 'applications', 'users', 'hires', 'drafts', 'passwordResetTokens'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export function dbSchemaName(): string | undefined {
  const name = process.env.DATABASE_SCHEMA?.trim();
  if (!name) return undefined;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error('DATABASE_SCHEMA must match [a-z_][a-z0-9_]{0,62}');
  return name;
}
// Advisory lock keys are per database, so they include the schema to keep isolated schemas independent.
const WRITE_LOCK_KEY = () => `recapp:store:write:${dbSchemaName() ?? ''}`;
const SCHEMA_LOCK_KEY = () => `recapp:store:schema:${dbSchemaName() ?? ''}`;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_records (
  collection text NOT NULL,
  id text NOT NULL,
  seq bigserial NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS app_records_collection_seq_idx ON app_records (collection, seq);
CREATE UNIQUE INDEX IF NOT EXISTS app_records_applicant_email_uidx
  ON app_records ((data->>'email')) WHERE collection = 'applicants' AND data->>'email' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_records_user_username_uidx
  ON app_records ((data->>'username')) WHERE collection = 'users';
CREATE UNIQUE INDEX IF NOT EXISTS app_records_applicant_oauth_uidx
  ON app_records ((data->>'oauthProvider'), (data->>'oauthProviderId'))
  WHERE collection = 'applicants' AND data->>'oauthProvider' IS NOT NULL AND data->>'oauthProviderId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_records_reset_token_uidx
  ON app_records ((data->>'token')) WHERE collection = 'passwordResetTokens';
CREATE TABLE IF NOT EXISTS audit_log (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

interface PoolState { url: string; key: string; pool: PoolT; ready?: Promise<void> }
let state: PoolState | null = null;

export function getPool(url: string): PoolT {
  const schema = dbSchemaName();
  const key = `${url}|${schema ?? ''}`;
  if (state && state.key === key) return state.pool;
  if (state) void state.pool.end().catch(() => {});
  const pool = new Pool({
    connectionString: url,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5_000,
    statement_timeout: 30_000,
  });
  pool.on('error', () => { /* idle client errors surface on next query; never crash the process */ });
  state = { url, key, pool };
  return pool;
}

export async function closePool(): Promise<void> {
  const s = state;
  state = null;
  if (s) await s.pool.end().catch(() => {});
}

export async function ensureSchema(url: string): Promise<void> {
  const pool = getPool(url);
  const st = state!; // capture: a later pool switch must not be affected by this initialization
  if (!st.ready) {
    st.ready = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [SCHEMA_LOCK_KEY()]);
        try {
          const schema = dbSchemaName();
          if (schema) await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
          await client.query(SCHEMA_SQL);
          await client.query(
            `INSERT INTO store_meta(key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO NOTHING`,
            [String(SCHEMA_VERSION)],
          );
          // Fail closed: never assume schema-1 semantics against a store written by another version.
          const v = await client.query(`SELECT value FROM store_meta WHERE key = 'schema_version'`);
          if (v.rows[0]?.value !== String(SCHEMA_VERSION)) {
            throw new Error(`Unsupported store schema version (found ${JSON.stringify(v.rows[0]?.value ?? null)}, this build supports ${SCHEMA_VERSION}); upgrade the application or migrate the database`);
          }
        } finally {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [SCHEMA_LOCK_KEY()]);
        }
      } finally {
        client.release();
      }
    })();
    st.ready.catch(() => { st.ready = undefined; });
  }
  return st.ready;
}

export async function ping(url: string): Promise<boolean> {
  try {
    await getPool(url).query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

function emptyData(): DataStore {
  return {
    companies: [], jobs: [], applicants: [], applications: [], users: [], hires: [],
    observability: [], drafts: [], passwordResetTokens: [],
  };
}

async function loadAll(client: Pick<ClientT, 'query'>): Promise<DataStore> {
  const res = await client.query('SELECT collection, data FROM app_records ORDER BY collection, seq');
  const store = emptyData() as unknown as Record<string, unknown[]>;
  for (const row of res.rows) {
    if (store[row.collection]) store[row.collection].push(row.data);
  }
  return store as unknown as DataStore;
}

export async function pgReadStore(url: string): Promise<DataStore> {
  await ensureSchema(url);
  return loadAll(getPool(url));
}

function recordId(collection: string, rec: unknown): string {
  const id = (rec as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id === '') throw new Error(`store: ${collection} record is missing a string id`);
  return id;
}

/** Runs mutator inside one serialized transaction; commits only changed/removed/added records. */
export async function pgUpdateStore<T>(
  url: string,
  mutator: (s: DataStore) => T | Promise<T>,
  traceRead: <R>(fn: () => Promise<R>) => Promise<R> = (fn) => fn(),
  traceWrite: <R>(fn: () => Promise<R>) => Promise<R> = (fn) => fn(),
): Promise<T> {
  await ensureSchema(url);
  const client = await getPool(url).connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '15s'`);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [WRITE_LOCK_KEY()]);
    const store = await traceRead(() => loadAll(client));
    const before = new Map<string, string>();
    for (const c of COLLECTIONS) for (const rec of store[c] as unknown[]) before.set(`${c}\u0000${recordId(c, rec)}`, JSON.stringify(rec));

    const result = await mutator(store);

    await traceWrite(async () => {
      if (store.observability && store.observability.length > 0) {
        throw new Error('store: audit entries must be written with addObservabilityEntry, not store.observability');
      }
      const upCol: string[] = [], upId: string[] = [], upData: string[] = [];
      const seen = new Set<string>();
      for (const c of COLLECTIONS) {
        const list = store[c] as unknown[];
        if (!Array.isArray(list)) throw new Error(`store: collection ${c} must be an array`);
        for (const rec of list) {
          const id = recordId(c, rec);
          const key = `${c}\u0000${id}`;
          if (seen.has(key)) throw new Error(`store: duplicate id in ${c}`);
          seen.add(key);
          const json = JSON.stringify(rec);
          if (before.get(key) !== json) { upCol.push(c); upId.push(id); upData.push(json); }
        }
      }
      const delCol: string[] = [], delId: string[] = [];
      for (const key of before.keys()) {
        if (!seen.has(key)) { const [c, id] = key.split('\u0000'); delCol.push(c); delId.push(id); }
      }
      if (delCol.length) {
        await client.query(
          'DELETE FROM app_records WHERE (collection, id) IN (SELECT * FROM unnest($1::text[], $2::text[]))',
          [delCol, delId],
        );
      }
      if (upCol.length) {
        await client.query(
          `INSERT INTO app_records (collection, id, data)
           SELECT c, i, d::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) AS t(c, i, d)
           ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [upCol, upId, upData],
        );
      }
      await client.query('COMMIT');
      committed = true;
    });
    return result;
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function pgAppendAudit(url: string, entry: ObservabilityLog): Promise<void> {
  await ensureSchema(url);
  await getPool(url).query('INSERT INTO audit_log (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [entry.id, JSON.stringify(entry)]);
}

export async function pgReadAudit(url: string): Promise<ObservabilityLog[]> {
  await ensureSchema(url);
  const res = await getPool(url).query('SELECT data FROM audit_log ORDER BY seq');
  return res.rows.map((r) => r.data as ObservabilityLog);
}

// ---- migration support (used by src/models/migrate.ts) ----------------------------------

export interface TargetCounts { records: Record<string, number>; audit: number }

export async function tablesExist(url: string): Promise<boolean> {
  const res = await getPool(url).query(`SELECT to_regclass('app_records') IS NOT NULL AS a, to_regclass('audit_log') IS NOT NULL AS b`);
  return res.rows[0].a && res.rows[0].b;
}

/** Locks the same lock as updateStore so migration cannot interleave with writers. */
export async function withMigrationTransaction<T>(url: string, fn: (client: ClientT) => Promise<T>): Promise<T> {
  await ensureSchema(url);
  const client = await getPool(url).connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [WRITE_LOCK_KEY()]);
    const out = await fn(client);
    await client.query('COMMIT');
    committed = true;
    return out;
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
