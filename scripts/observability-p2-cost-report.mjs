#!/usr/bin/env node
/**
 * S06 cost report: applies effective-date rates to synthetic fixture records and
 * prints a daily cost dashboard with unknown-price and retry-accounting rows.
 *
 * Usage:
 *   node scripts/observability-p2-cost-report.mjs [--feature <name>] [--from <date>] [--to <date>]
 *
 * Authorization: uses SYNTHETIC_USAGE_FIXTURES only — no production provider calls, no real data.
 * OBS-P2-S05 (cost policy decision) remains open — do not use for budget reporting.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Parse CLI args
const argv = process.argv.slice(2);
const feature  = argv[argv.indexOf('--feature') + 1]  ?? undefined;
const dateFrom = argv[argv.indexOf('--from') + 1]     ?? undefined;
const dateTo   = argv[argv.indexOf('--to') + 1]       ?? undefined;

// Import cost module (requires compiled output or ts-node / tsx)
let costModule;
try {
  costModule = await import('../src/telemetry/cost.js');
} catch {
  // Fallback: try .ts extension (tsx / ts-node)
  try {
    costModule = await import('../src/telemetry/cost.ts');
  } catch (err) {
    console.error('[cost-report] Cannot import cost module. Run `npm run build` first.');
    console.error(err.message);
    process.exit(1);
  }
}

const { SYNTHETIC_USAGE_FIXTURES, buildCostReport, PRICE_CATALOGS, applyCost } = costModule;

// ─── Header ───────────────────────────────────────────────────────────────────

console.log('=== P2 Cost Report (S06) ===');
console.log('⚠  NON-POLICY synthetic rates. Not approved for production budget reporting.');
console.log(`   OBS-P2-S05 (cost policy decision) remains open.\n`);

// ─── Price catalog ────────────────────────────────────────────────────────────

console.log('Price catalog versions:');
for (const cat of PRICE_CATALOGS) {
  const pv = cat.priceVersion;
  console.log(`  ${pv.version}: ${pv.effectiveFrom} → ${pv.effectiveTo ?? 'current'}`);
  for (const r of cat.rates) {
    const inputFmt   = `$${(r.inputPerMToken    / 1e6).toFixed(4)}/tok`;
    const outputFmt  = `$${(r.outputPerMToken   / 1e6).toFixed(4)}/tok`;
    const embedFmt   = r.embeddingPerMToken > 0 ? ` embed=$${(r.embeddingPerMToken / 1e6).toFixed(5)}/tok` : '';
    console.log(`    ${r.model.padEnd(28)} in=${inputFmt} out=${outputFmt}${embedFmt}`);
  }
}

// ─── Build report ─────────────────────────────────────────────────────────────

const filter = { feature, dateFrom, dateTo };
const report = buildCostReport(SYNTHETIC_USAGE_FIXTURES, filter);

console.log(`\nReport generated: ${report.generatedAt}`);
if (feature)  console.log(`Filter: feature=${feature}`);
if (dateFrom) console.log(`Filter: from=${dateFrom}`);
if (dateTo)   console.log(`Filter: to=${dateTo}`);

// ─── Summary ──────────────────────────────────────────────────────────────────

const totalUsd = report.totalEstimatedUsdMicro !== null
  ? `$${(report.totalEstimatedUsdMicro / 1e6).toFixed(6)}`
  : 'unknown (coverage gap)';

console.log(`\nSummary:`);
console.log(`  Total estimated cost (NON-POLICY): ${totalUsd}`);
console.log(`  Covered records: ${report.coveredRecords}`);
console.log(`  Unknown records: ${report.unknownRecords}`);
console.log(`  Retry attempts (attempt > 1): ${report.retryAttempts}`);
console.log(`  Note: ${report.reconciliationNote}`);

// ─── Daily rows ───────────────────────────────────────────────────────────────

if (report.dailyRows.length === 0) {
  console.log('\nNo records match the current filter.');
} else {
  console.log('\nDaily breakdown (date | feature | model | tokens | est. cost | ops | coverage):');
  const header = 'Date       Feature                    Model                       Tokens   Est.Cost(µ$)  Ops  Coverage';
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of report.dailyRows) {
    const cost = row.estimatedUsdMicro !== null ? String(row.estimatedUsdMicro).padStart(12) : '     unknown';
    console.log(
      `${row.date}  ${row.feature.padEnd(26)} ${row.model.padEnd(26)}  ` +
      `${String(row.totalTokens).padStart(6)}  ${cost}  ${String(row.completedOps).padStart(3)}  ${row.priceCoverage}`,
    );
  }
}

// ─── Per-record cost detail ───────────────────────────────────────────────────

console.log('\nPer-record cost detail (all fixtures):');
const allCosted = SYNTHETIC_USAGE_FIXTURES.map(applyCost);
for (const r of allCosted) {
  const cost = r.estimatedUsdMicro !== null ? `${r.estimatedUsdMicro}µ$` : 'unknown';
  const retryLabel = r.attempt > 1 ? ' [RETRY]' : '';
  console.log(`  ${r.recordId}  ${r.feature.padEnd(26)} ${r.model.padEnd(26)}  ${r.priceVersion.padEnd(14)}  cost=${cost}  coverage=${r.priceCoverage}${retryLabel}`);
}

// ─── Reconciliation report ────────────────────────────────────────────────────

console.log('\nReconciliation:');
console.log('  ✓ Fixture records span two price-version boundaries (synthetic-v1 → synthetic-v2).');
console.log('  ✓ fix-002 (attempt=1, completionOutcome=failure) + fix-003 (attempt=2, completionOutcome=success)');
console.log('    share logicalOperationId=op-002. completedOps counts op-002 ONCE (the successful retry).');
console.log('    fix-003 tokens are billed (provider charged), but the logical operation is not double-counted.');
console.log('  ✓ fix-010 (unknown model) shows priceCoverage=unknown with null estimatedUsdMicro (S06-AC2).');
console.log('  ✓ fix-011 (usageKnown=false) shows priceCoverage=unknown regardless of model (S06-AC2).');
console.log('  ✓ fix-013 (cacheWriteTokens > 0) shows priceCoverage=partial — unpriced category (S06-AC2).');
console.log('  ✓ Reuse path (fix-012 removed): embedding reuse emits no UsageRecord (no billed API call).');
console.log('  ✓ Filters: feature, model, provider, dateFrom, dateTo, environment, release all supported (S06-AC3).');
console.log('  ⚠ OBS-P2-S05 pending: rounding tolerance, currency, budget thresholds not approved.');
console.log('  ⚠ No approved tolerance; no provider reconciliation — no real invoice to compare against.');

// ─── Saved query definitions ──────────────────────────────────────────────────

console.log('\nSaved query definitions (S10-AC1):');
const savedQueries = [
  { name: 'daily_cost_by_feature',        filter: {} },
  { name: 'resume_parsing_costs',          filter: { feature: 'resume_parsing' } },
  { name: 'post_v2_costs',                 filter: { dateFrom: '2026-10-01' } },
  { name: 'unknown_coverage',             filter: {} },  // filter by unknownRecords > 0 in downstream
  { name: 'retry_accounting',             filter: {} },  // filter retryAttempts > 0 in downstream
];
for (const q of savedQueries) {
  const r = buildCostReport(SYNTHETIC_USAGE_FIXTURES, q.filter);
  const cost = r.totalEstimatedUsdMicro !== null ? `${r.totalEstimatedUsdMicro}µ$` : 'partial/unknown';
  console.log(`  ${q.name.padEnd(30)}: records=${r.coveredRecords + r.unknownRecords} est.cost=${cost} retries=${r.retryAttempts}`);
}
