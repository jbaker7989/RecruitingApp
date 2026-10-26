/**
 * NFR-DATA-002 F-AC3 / S03-AC5: the legacy wholesale `writeStore` API must keep rejecting
 * PostgreSQL snapshots. Route repair uses `updateStore`; nothing may make `writeStore`
 * work for the database backend.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const databaseRequired = process.env.DB_TEST_REQUIRED === 'true';
const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = Boolean(databaseUrl);
const schema = `nfr_store_contract_${process.pid}_${Date.now()}`;

if (databaseRequired && !databaseUrl) throw new Error('DB_TEST_REQUIRED=true requires DATABASE_URL');

type StoreModule = typeof import('../../src/models/store.js');
let store: StoreModule;

async function dropSchema(): Promise<void> {
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}

describe('NFR-DATA-002 PostgreSQL store write contract', { skip: !runDatabaseTests }, () => {
  before(async () => {
    process.env.USE_DATABASE = 'true';
    process.env.DATABASE_SCHEMA = schema;
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_CONNECT_TIMEOUT_MS = '1500';
    await dropSchema();
    store = await import('../../src/models/store.js');
    await store.initializeStore();
    assert.equal(store.getStoreMode(), 'postgres');
  });

  after(async () => {
    if (store) await store.closeStore();
    if (databaseUrl) await dropSchema();
    delete process.env.DATABASE_SCHEMA;
    delete process.env.USE_DATABASE;
  });

  test('writeStore rejects PostgreSQL snapshots and leaves committed rows unchanged', async () => {
    const timestamp = new Date().toISOString();
    await store.updateStore((current) => {
      current.companies.push({
        id: 'contract-committed-company', companyName: 'Committed Contract Co', description: 'Synthetic',
        location: 'Remote', companySize: '1-10', industry: 'Testing', createdAt: timestamp, updatedAt: timestamp,
      });
    });

    const snapshot = await store.readStore();
    snapshot.companies[0].companyName = 'Wholesale overwrite';
    snapshot.companies.push({
      id: 'contract-wholesale-company', companyName: 'Must not persist', description: '',
      location: '', companySize: '', industry: '', createdAt: timestamp, updatedAt: timestamp,
    });

    await assert.rejects(
      store.writeStore(snapshot),
      (error: unknown) => {
        assert.ok(error instanceof store.LegacyWholesaleWriteError, String(error));
        assert.match((error as Error).message, /writeStore\(\) is not supported with the database backend; use updateStore\(\)/);
        return true;
      },
    );
    // A fresh empty store is rejected too: there is no PostgreSQL wholesale path at all.
    await assert.rejects(store.writeStore(store.emptyStore()), store.LegacyWholesaleWriteError);

    const persisted = await store.readStore();
    assert.deepEqual(persisted.companies.map((company) => [company.id, company.companyName]), [
      ['contract-committed-company', 'Committed Contract Co'],
    ]);
  });
});

test('database store contract prerequisite is explicit', { skip: runDatabaseTests }, () => {
  assert.equal(databaseRequired, false, 'DB_TEST_REQUIRED=true must provide DATABASE_URL');
});
