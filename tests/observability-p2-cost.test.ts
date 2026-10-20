import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCost, buildCostReport, type UsageRecord } from '../src/telemetry/cost.js';

const usage = (id: string, timestamp: string, overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  recordId: id,
  timestamp,
  feature: 'resume_parsing',
  model: 'gpt-4o',
  provider: 'openai',
  operation: 'chat',
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  embeddingTokens: 0,
  usageKnown: true,
  attempt: 1,
  ...overrides,
});

test('S06: the applied version and exact synthetic rate both change at the effective-date boundary', () => {
  const before = applyCost(usage('before', '2026-09-30T23:59:59Z'));
  const after = applyCost(usage('after', '2026-10-01T00:00:00Z'));
  assert.equal(before.priceVersion, 'synthetic-v1');
  assert.equal(before.estimatedUsdMicro, 2500);
  assert.equal(after.priceVersion, 'synthetic-v2');
  assert.equal(after.estimatedUsdMicro, 2000);
});

test('S06: unknown model and missing usage remain uncovered, while a reported retry is billed once', () => {
  const records = [
    usage('first', '2026-10-01T00:00:00Z', { inputTokens: 1000 }),
    usage('retry', '2026-10-01T00:00:01Z', { inputTokens: 1000, attempt: 2 }),
    usage('unknown-model', '2026-10-01T00:00:02Z', { model: 'synthetic-unpriced', inputTokens: 1000 }),
    usage('no-usage', '2026-10-01T00:00:03Z', { usageKnown: false, inputTokens: 0 }),
  ];
  const report = buildCostReport(records, { feature: 'resume_parsing', dateFrom: '2026-10-01', dateTo: '2026-10-01' });
  assert.equal(report.coveredRecords, 2);
  assert.equal(report.unknownRecords, 2);
  assert.equal(report.retryAttempts, 1);
  assert.equal(report.totalEstimatedUsdMicro, 4);
  assert.ok(report.priceVersionNote.includes('NON-POLICY'));
  assert.ok(report.dailyRows.some(row => row.unknownCount > 0));
  assert.equal(buildCostReport(records, { provider: 'anthropic' }).dailyRows.length, 0);
});

test('S06: a missing price never becomes a zero-cost record even when reported tokens are positive', () => {
  const unpriced = applyCost(usage('unpriced', '2026-10-02T12:00:00Z', { model: 'synthetic-unpriced' }));
  assert.equal(unpriced.estimatedUsdMicro, null);
  assert.equal(unpriced.priceCoverage, 'unknown');
});

test('S06: a catalog model under the wrong provider and a pre-catalog date remain unpriced', () => {
  for (const record of [
    usage('wrong-provider', '2026-10-02T12:00:00Z', { provider: 'anthropic' }),
    usage('before-catalog', '2025-12-31T23:59:59Z'),
  ]) {
    const cost = applyCost(record);
    assert.equal(cost.priceCoverage, 'unknown');
    assert.equal(cost.estimatedUsdMicro, null);
  }
});

test('S06: date and feature filters exclude other records before computing coverage and total', () => {
  const records = [
    usage('selected', '2026-10-02T12:00:00Z', { inputTokens: 1_000_000 }),
    usage('wrong-day', '2026-10-03T12:00:00Z', { inputTokens: 1_000_000 }),
    usage('wrong-feature', '2026-10-02T12:00:00Z', { feature: 'job_description', inputTokens: 1_000_000 }),
    usage('unknown', '2026-10-02T12:00:00Z', { usageKnown: false, inputTokens: 0 }),
  ];
  const report = buildCostReport(records, {
    feature: 'resume_parsing', dateFrom: '2026-10-02', dateTo: '2026-10-02',
  });
  assert.equal(report.dailyRows.length, 1);
  assert.equal(report.coveredRecords, 1);
  assert.equal(report.unknownRecords, 1);
  assert.equal(report.totalEstimatedUsdMicro, 2000);
  assert.equal(report.dailyRows[0].date, '2026-10-02');
  assert.equal(report.dailyRows[0].priceCoverage, 'mixed');
});

test('S06: environment and release filters isolate one deployment before cost aggregation', () => {
  const records = [
    usage('selected', '2026-10-02T12:00:00Z', { environment: 'staging', release: 'synthetic-r2' }),
    usage('wrong-environment', '2026-10-02T12:00:00Z', { environment: 'production', release: 'synthetic-r2' }),
    usage('wrong-release', '2026-10-02T12:00:00Z', { environment: 'staging', release: 'synthetic-r1' }),
  ];
  const report = buildCostReport(records, { environment: 'staging', release: 'synthetic-r2' });
  assert.equal(report.coveredRecords, 1);
  assert.equal(report.totalEstimatedUsdMicro, 2000);
  assert.equal(report.dailyRows.length, 1);
  assert.equal(report.dailyRows[0].completedOps, 1);
});

test('S06: failed first attempt and successful retry cost both attempts but complete one logical operation', () => {
  const records = [
    usage('attempt-1', '2026-10-02T12:00:00Z', {
      logicalOperationId: 'synthetic-op', completionOutcome: 'failure', attempt: 1,
    }),
    usage('attempt-2', '2026-10-02T12:00:01Z', {
      logicalOperationId: 'synthetic-op', completionOutcome: 'success', attempt: 2,
    }),
  ];
  const report = buildCostReport(records);
  assert.equal(report.totalEstimatedUsdMicro, 4000);
  assert.equal(report.retryAttempts, 1);
  assert.equal(report.dailyRows[0].completedOps, 1);
  assert.equal(buildCostReport([records[0]]).dailyRows[0].completedOps, 0);
});

test('S06: replaying an identical usage record cannot bill the same provider attempt twice', () => {
  const record = usage('same-attempt', '2026-10-02T12:00:00Z', {
    logicalOperationId: 'synthetic-op', completionOutcome: 'success',
  });
  const report = buildCostReport([record, record]);
  assert.equal(report.totalEstimatedUsdMicro, 2000);
  assert.equal(report.coveredRecords, 1);
  assert.equal(report.dailyRows[0].completedOps, 1);
});
