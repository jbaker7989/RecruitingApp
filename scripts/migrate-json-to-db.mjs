#!/usr/bin/env node
// Usage: DATABASE_URL=postgres://... node --import tsx scripts/migrate-json-to-db.mjs [--dry-run] [--data-dir DIR] [--allow-nonempty-target]
// See docs/implementation/db-storage-contract.md. Exit codes: 0 ok, 2 refused/conflict, 1 error.
import { migrateJsonToDb } from '../src/models/migrate.ts';
import { closeStore } from '../src/models/store.ts';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const dirIdx = args.indexOf('--data-dir');
const dataDir = dirIdx >= 0 ? args[dirIdx + 1] : (process.env.DATA_DIR || 'data');

try {
  const report = await migrateJsonToDb({
    dataDir,
    databaseUrl: process.env.DATABASE_URL,
    dryRun: flag('--dry-run'),
    allowNonEmptyTarget: flag('--allow-nonempty-target'),
  });
  console.log(JSON.stringify(report, null, 2));
  await closeStore();
  process.exit(report.outcome === 'refused' ? 2 : 0);
} catch (err) {
  console.error(`migration failed: ${err instanceof Error ? err.message : err}`);
  await closeStore().catch(() => {});
  process.exit(1);
}
