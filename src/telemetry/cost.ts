/**
 * P2 cost estimation fixtures and query (OBS-P2-S06).
 *
 * Synthetic cost records with versioned effective-date rates. These are
 * explicit fixture records — NOT production-defaults or live price APIs.
 * All prices are labeled NON-POLICY and require approval before use in
 * budgets or alerting (OBS-P2-S05 remains open).
 *
 * Ownership: dev2. Dev1's usage.ts provides token records consumed here.
 * No new AI module imports — cost report consumes declared fixture records.
 */

// ─── Versioned price catalog (NON-POLICY, synthetic only) ────────────────────

/** A price version tied to an effective date range (ISO-8601 dates). */
export interface PriceVersion {
  version: string;
  effectiveFrom: string;  // ISO date
  effectiveTo:   string | null; // null = current
  note: string;           // must state "NON-POLICY synthetic rates"
}

/**
 * Per-token prices in micro-USD (1e-6 USD) to avoid floating-point drift.
 * Units: micro-USD per million tokens = 1e-6 USD / 1e6 tokens = 1e-12 USD/token.
 * These are internally consistent but ARBITRARY illustrative values — not real
 * provider prices. No cache-write or reasoning categories are priced here;
 * records with non-zero cacheWriteTokens or reasoningTokens will have priceCoverage='partial'.
 */
export interface ModelRates {
  model:              string;
  provider:           'openai' | 'anthropic';
  inputPerMToken:     number; // micro-USD per million input tokens
  outputPerMToken:    number; // micro-USD per million output tokens
  cacheReadPerMToken: number; // micro-USD per million cached-read tokens (0 if unsupported)
  embeddingPerMToken: number; // micro-USD per million embedding tokens (0 if not applicable)
  // cache-write and reasoning are intentionally unpriced in these fixtures
  // (no approved policy values). If a record has non-zero values in those
  // categories, applyCost marks priceCoverage='partial'.
}

/** A fixed snapshot: rates for a specific version. */
export interface PriceCatalog {
  priceVersion: PriceVersion;
  rates:        ModelRates[];
}

/**
 * NON-POLICY synthetic rate catalog (two versions to demonstrate effective-date
 * boundary crossing in S06-AC1). Values are illustrative placeholders that
 * cannot be used for real spend reporting until OBS-P2-S05 is approved.
 * Rate units: micro-USD per million tokens (internally consistent).
 */
export const PRICE_CATALOGS: PriceCatalog[] = [
  {
    priceVersion: {
      version: 'synthetic-v1',
      effectiveFrom: '2026-01-01',
      effectiveTo:   '2026-09-30',
      note: 'NON-POLICY synthetic rates for fixture testing only — not approved for production budget reporting',
    },
    rates: [
      { model: 'gpt-4o',               provider: 'openai',    inputPerMToken: 2500,  outputPerMToken: 10000, cacheReadPerMToken: 1250, embeddingPerMToken: 0 },
      { model: 'gpt-4o-mini',          provider: 'openai',    inputPerMToken: 150,   outputPerMToken: 600,   cacheReadPerMToken: 75,   embeddingPerMToken: 0 },
      { model: 'text-embedding-3-small', provider: 'openai',  inputPerMToken: 0,     outputPerMToken: 0,     cacheReadPerMToken: 0,    embeddingPerMToken: 20 },
      { model: 'claude-3-5-sonnet',    provider: 'anthropic', inputPerMToken: 3000,  outputPerMToken: 15000, cacheReadPerMToken: 300,  embeddingPerMToken: 0 },
    ],
  },
  {
    priceVersion: {
      version: 'synthetic-v2',
      effectiveFrom: '2026-10-01',
      effectiveTo:   null,
      note: 'NON-POLICY synthetic rates for fixture testing only — not approved for production budget reporting',
    },
    rates: [
      { model: 'gpt-4o',               provider: 'openai',    inputPerMToken: 2000,  outputPerMToken: 8000,  cacheReadPerMToken: 1000, embeddingPerMToken: 0 },
      { model: 'gpt-4o-mini',          provider: 'openai',    inputPerMToken: 150,   outputPerMToken: 600,   cacheReadPerMToken: 75,   embeddingPerMToken: 0 },
      { model: 'text-embedding-3-small', provider: 'openai',  inputPerMToken: 0,     outputPerMToken: 0,     cacheReadPerMToken: 0,    embeddingPerMToken: 20 },
      { model: 'claude-3-5-sonnet',    provider: 'anthropic', inputPerMToken: 3000,  outputPerMToken: 15000, cacheReadPerMToken: 300,  embeddingPerMToken: 0 },
    ],
  },
];

// ─── Usage record type ────────────────────────────────────────────────────────

/**
 * A single observed usage record (from SDK telemetry or fixture injection).
 * Populated by dev1's ai.ts / usage.ts at call time; this module consumes them.
 */
export interface UsageRecord {
  recordId:            string;
  timestamp:           string;   // ISO-8601
  feature:             string;   // bounded label from app.feature
  model:               string;
  provider:            'openai' | 'anthropic';
  operation:           'chat' | 'embedding';
  inputTokens:         number;
  outputTokens:        number;
  cacheReadTokens:     number;
  embeddingTokens:     number;
  /** Indicates whether SDK usage was present; false = tokens are unknown. */
  usageKnown:          boolean;
  /** Retry attempt number (1 = first attempt). */
  attempt:             number;
  /**
   * Logical operation ID: groups all attempt records for one user-visible operation.
   * When present, completedOps counts unique IDs with completionOutcome='success'.
   * When absent, falls back to completionOutcome='success' (or attempt===1 for legacy records).
   */
  logicalOperationId?: string;
  /**
   * Whether this attempt completed the logical operation successfully.
   * 'success': this attempt is the completing call.
   * 'failure': this attempt failed; may have a retry sibling record.
   */
  completionOutcome?:  'success' | 'failure';
  /**
   * Optional environment/release dimensions for cross-deployment filtering (S06-AC3).
   * Never used as free-text; should match the static env/release labels from telemetry config.
   */
  environment?:        string;
  release?:            string;
  /**
   * Cache-write and reasoning tokens: unpriced in current NON-POLICY catalog.
   * If non-zero, applyCost marks priceCoverage='partial' (cannot claim full coverage).
   */
  cacheWriteTokens?:   number;
  reasoningTokens?:    number;
}

// ─── Cost record type ─────────────────────────────────────────────────────────

export interface CostRecord extends UsageRecord {
  priceVersion:       string;
  estimatedUsdMicro:  number | null; // null = price unknown / usage unknown
  inputCostMicro:     number;
  outputCostMicro:    number;
  cacheReadCostMicro: number;
  embeddingCostMicro: number;
  priceCoverage:      'full' | 'partial' | 'unknown';
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

/**
 * Find the applicable catalog and rate for a model+provider on a given date.
 * Both model AND provider must match the catalog entry — a model name alone
 * is insufficient to look up rates (same name may exist under different providers
 * at different prices).
 */
export function findCatalogAndRates(
  model: string,
  provider: 'openai' | 'anthropic',
  atDate: string,
): { catalog: PriceCatalog; rates: ModelRates } | undefined {
  // Iterate newest-first so the most recent price version wins at a boundary.
  for (const catalog of [...PRICE_CATALOGS].reverse()) {
    const pv = catalog.priceVersion;
    if (atDate >= pv.effectiveFrom && (pv.effectiveTo === null || atDate <= pv.effectiveTo)) {
      const rate = catalog.rates.find((r) => r.model === model && r.provider === provider);
      if (rate) return { catalog, rates: rate };
    }
  }
  return undefined;
}

/** Find the applicable rate for a model+provider on a given date. Returns undefined if unknown. */
export function findRates(model: string, provider: 'openai' | 'anthropic', atDate: string): ModelRates | undefined {
  return findCatalogAndRates(model, provider, atDate)?.rates;
}

/** Apply rates to a usage record to produce a cost record. */
export function applyCost(record: UsageRecord): CostRecord {
  if (!record.usageKnown) {
    return {
      ...record,
      priceVersion: 'unknown',
      estimatedUsdMicro: null,
      inputCostMicro: 0,
      outputCostMicro: 0,
      cacheReadCostMicro: 0,
      embeddingCostMicro: 0,
      priceCoverage: 'unknown',
    };
  }

  const date = record.timestamp.slice(0, 10);
  const found = findCatalogAndRates(record.model, record.provider, date);

  if (!found) {
    return {
      ...record,
      priceVersion: 'unknown',
      estimatedUsdMicro: null,
      inputCostMicro: 0,
      outputCostMicro: 0,
      cacheReadCostMicro: 0,
      embeddingCostMicro: 0,
      priceCoverage: 'unknown',
    };
  }

  const { catalog, rates } = found;
  const priceVersion = catalog.priceVersion.version;

  // Micro-USD per token = rate per million / 1_000_000
  const inputCost    = Math.round((record.inputTokens     * rates.inputPerMToken)    / 1_000_000);
  const outputCost   = Math.round((record.outputTokens    * rates.outputPerMToken)   / 1_000_000);
  const cacheCost    = Math.round((record.cacheReadTokens * rates.cacheReadPerMToken) / 1_000_000);
  const embedCost    = Math.round((record.embeddingTokens * rates.embeddingPerMToken) / 1_000_000);
  const total        = inputCost + outputCost + cacheCost + embedCost;

  // If the record has cache-write or reasoning tokens, these are NOT priced in the
  // current NON-POLICY catalog (no approved values). Mark as partial so callers
  // know the reported cost understates the true cost.
  const hasUnpricedCategories =
    (record.cacheWriteTokens ?? 0) > 0 ||
    (record.reasoningTokens  ?? 0) > 0;

  return {
    ...record,
    priceVersion,
    estimatedUsdMicro: total,
    inputCostMicro: inputCost,
    outputCostMicro: outputCost,
    cacheReadCostMicro: cacheCost,
    embeddingCostMicro: embedCost,
    priceCoverage: hasUnpricedCategories ? 'partial' : 'full',
  };
}

// ─── Report types ─────────────────────────────────────────────────────────────

export interface DailyCostRow {
  date:              string;
  feature:           string;
  model:             string;
  provider:          'openai' | 'anthropic';
  totalTokens:       number;
  estimatedUsdMicro: number | null;
  /** Number of unique successfully completed logical operations in this row. */
  completedOps:      number;
  unknownCount:      number;
  priceCoverage:     'full' | 'partial' | 'unknown' | 'mixed';
}

export interface CostReport {
  generatedAt:            string;
  priceVersionNote:       string;
  totalEstimatedUsdMicro: number | null;
  coveredRecords:         number;
  unknownRecords:         number;
  retryAttempts:          number; // records with attempt > 1
  dailyRows:              DailyCostRow[];
  reconciliationNote:     string;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface CostReportFilter {
  /** Filter by exact feature label (bounded vocabulary). */
  feature?:     string;
  /** Filter by model name. */
  model?:       string;
  /** Filter by provider. */
  provider?:    'openai' | 'anthropic';
  /** Filter by date (ISO date, inclusive). */
  dateFrom?:    string;
  dateTo?:      string;
  /** Filter by deployment environment (e.g. 'local', 'staging', 'production'). */
  environment?: string;
  /** Filter by release identifier. */
  release?:     string;
}

// Internal builder type — strip before returning rows.
interface RowBuilder extends DailyCostRow {
  _coverages: Array<'full' | 'partial' | 'unknown'>;
  _successfulOpIds: Set<string>;
  _legacyCompleted: number;
}

/**
 * Generate a cost report from an array of usage records.
 *
 * completedOps denominator:
 *   - When logicalOperationId is present: count unique IDs that have at least
 *     one record with completionOutcome='success'. This correctly handles retries
 *     (a successful retry completes the operation; a failed first attempt does not).
 *   - Fallback (no logicalOperationId): count records with completionOutcome='success',
 *     or records with attempt===1 if completionOutcome is absent (legacy format).
 *
 * Reuse note: embedding reuse paths must emit NO UsageRecord (no billed API call).
 * Presence of a record with usageKnown=true always implies a real provider call.
 */
export function buildCostReport(records: UsageRecord[], filter: CostReportFilter = {}): CostReport {
  // Deduplicate by recordId: same provider attempt must never be billed twice.
  // First occurrence wins; subsequent duplicates are silently dropped.
  const seenIds = new Set<string>();
  const deduped = records.filter((r) => {
    if (seenIds.has(r.recordId)) return false;
    seenIds.add(r.recordId);
    return true;
  });
  const costed = deduped.map(applyCost);

  // Apply filters
  const filtered = costed.filter((r) => {
    if (filter.feature     && r.feature     !== filter.feature)     return false;
    if (filter.model       && r.model       !== filter.model)       return false;
    if (filter.provider    && r.provider    !== filter.provider)    return false;
    if (filter.environment && r.environment !== filter.environment) return false;
    if (filter.release     && r.release     !== filter.release)     return false;
    const date = r.timestamp.slice(0, 10);
    if (filter.dateFrom && date < filter.dateFrom) return false;
    if (filter.dateTo   && date > filter.dateTo)   return false;
    return true;
  });

  // Aggregate by date + feature + model + provider
  const byKey = new Map<string, RowBuilder>();

  for (const r of filtered) {
    const date = r.timestamp.slice(0, 10);
    const key  = `${date}|${r.feature}|${r.model}|${r.provider}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date, feature: r.feature, model: r.model, provider: r.provider,
        totalTokens: 0, estimatedUsdMicro: null, completedOps: 0,
        unknownCount: 0, priceCoverage: 'full',
        _coverages: [], _successfulOpIds: new Set(), _legacyCompleted: 0,
      };
      byKey.set(key, row);
    }

    row.totalTokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.embeddingTokens;
    row._coverages.push(r.priceCoverage);

    if (r.estimatedUsdMicro !== null) {
      row.estimatedUsdMicro = (row.estimatedUsdMicro ?? 0) + r.estimatedUsdMicro;
    } else {
      row.unknownCount += 1;
    }

    // Track completed logical operations.
    if (r.logicalOperationId) {
      if (r.completionOutcome === 'success') {
        row._successfulOpIds.add(r.logicalOperationId);
      }
    } else {
      // Fallback: use completionOutcome when available, else attempt===1 (legacy).
      if (r.completionOutcome === 'success' ||
          (r.completionOutcome === undefined && r.attempt === 1)) {
        row._legacyCompleted += 1;
      }
    }
  }

  // Derive final row values from builders.
  const dailyRows: DailyCostRow[] = [];
  for (const row of byKey.values()) {
    // Coverage: full only when every record is full; unknown only when all unknown; mixed otherwise.
    const allFull    = row._coverages.every((c) => c === 'full');
    const allUnknown = row._coverages.every((c) => c === 'unknown');
    row.priceCoverage = allFull ? 'full' : allUnknown ? 'unknown' : 'mixed';

    // completedOps = ops with logicalOperationId that succeeded + legacy fallback count.
    row.completedOps = row._successfulOpIds.size + row._legacyCompleted;

    const { _coverages: _c, _successfulOpIds: _s, _legacyCompleted: _l, ...cleanRow } = row;
    dailyRows.push(cleanRow);
  }

  dailyRows.sort((a, b) => a.date.localeCompare(b.date) || a.feature.localeCompare(b.feature));

  const totalUsd       = filtered.reduce<number | null>((acc, r) => r.estimatedUsdMicro !== null ? (acc ?? 0) + r.estimatedUsdMicro : acc, null);
  const coveredRecords = filtered.filter((r) => r.priceCoverage === 'full').length;
  const unknownRecords = filtered.filter((r) => r.priceCoverage === 'unknown').length;
  const retryAttempts  = filtered.filter((r) => r.attempt > 1).length;

  const hasMixed = dailyRows.some((r) => r.priceCoverage !== 'full');

  return {
    generatedAt: new Date().toISOString(),
    priceVersionNote: 'NON-POLICY synthetic rates. OBS-P2-S05 (cost policy decision) must be approved before production use.',
    totalEstimatedUsdMicro: totalUsd,
    coveredRecords,
    unknownRecords,
    retryAttempts,
    dailyRows,
    reconciliationNote: hasMixed
      ? `${unknownRecords} record(s) have unknown price/usage and ${filtered.filter(r => r.priceCoverage === 'partial').length} partial; variance is not reconciled until OBS-P2-S05 is approved.`
      : 'All records have full price coverage for this filter window.',
  };
}

// ─── Synthetic fixture records (S06 acceptance evidence) ─────────────────────

/**
 * Deterministic synthetic fixture usage records for S06 acceptance.
 * These are NOT real applicant data and NOT live provider usage.
 * Dates span a price-version boundary (synthetic-v1 to synthetic-v2).
 *
 * logicalOperationId groups attempt records for the same operation.
 * completionOutcome='success' marks the completing attempt.
 *
 * Reuse paths (e.g. semantic matching that reuses cached embeddings) do NOT
 * appear here — they produce no billed API call and therefore no UsageRecord.
 */
export const SYNTHETIC_USAGE_FIXTURES: UsageRecord[] = [
  // Resume parsing (gpt-4o, v1 rates)
  {
    recordId: 'fix-001', timestamp: '2026-09-28T10:00:00Z', feature: 'resume_parsing',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 1200, outputTokens: 400, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-001', completionOutcome: 'success',
  },
  {
    recordId: 'fix-002', timestamp: '2026-09-28T10:05:00Z', feature: 'resume_parsing',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 1500, outputTokens: 600, cacheReadTokens: 200, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-002', completionOutcome: 'failure',  // first attempt failed
  },
  // Resume parsing retry (attempt 2 — fix-002 failed, this retry succeeded)
  {
    recordId: 'fix-003', timestamp: '2026-09-28T10:06:00Z', feature: 'resume_parsing',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 1500, outputTokens: 600, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 2,
    logicalOperationId: 'op-002', completionOutcome: 'success',  // retry completed op-002
  },
  // Job description (gpt-4o, v1 rates)
  {
    recordId: 'fix-004', timestamp: '2026-09-29T14:00:00Z', feature: 'job_description',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 800, outputTokens: 1200, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-004', completionOutcome: 'success',
  },
  // Embeddings (text-embedding-3-small, v1 rates)
  {
    recordId: 'fix-005', timestamp: '2026-09-29T14:01:00Z', feature: 'job_description',
    model: 'text-embedding-3-small', provider: 'openai', operation: 'embedding',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, embeddingTokens: 300,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-005', completionOutcome: 'success',
  },
  // Cross price-version boundary (oct-01 = v2 rates)
  {
    recordId: 'fix-006', timestamp: '2026-10-01T09:00:00Z', feature: 'resume_parsing',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 1300, outputTokens: 500, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-006', completionOutcome: 'success',
  },
  {
    recordId: 'fix-007', timestamp: '2026-10-01T09:00:00Z', feature: 'resume_parsing',
    model: 'text-embedding-3-small', provider: 'openai', operation: 'embedding',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, embeddingTokens: 280,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-007', completionOutcome: 'success',
  },
  // Candidate communication (claude, v2 rates)
  {
    recordId: 'fix-008', timestamp: '2026-10-02T11:00:00Z', feature: 'candidate_communication',
    model: 'claude-3-5-sonnet', provider: 'anthropic', operation: 'chat',
    inputTokens: 600, outputTokens: 900, cacheReadTokens: 300, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-008', completionOutcome: 'success',
  },
  // Scheduling (claude, v2 rates)
  {
    recordId: 'fix-009', timestamp: '2026-10-02T12:00:00Z', feature: 'interview_scheduling',
    model: 'claude-3-5-sonnet', provider: 'anthropic', operation: 'chat',
    inputTokens: 400, outputTokens: 200, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-009', completionOutcome: 'success',
  },
  // Unknown model — price coverage should be 'unknown'
  {
    recordId: 'fix-010', timestamp: '2026-10-03T08:00:00Z', feature: 'resume_parsing',
    model: 'unknown-model-xyz', provider: 'openai', operation: 'chat',
    inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-010', completionOutcome: 'success',
  },
  // SDK usage missing — usageKnown=false → priceCoverage='unknown'
  {
    recordId: 'fix-011', timestamp: '2026-10-03T09:00:00Z', feature: 'job_description',
    model: 'gpt-4o', provider: 'openai', operation: 'chat',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, embeddingTokens: 0,
    usageKnown: false, attempt: 1,
    logicalOperationId: 'op-011', completionOutcome: 'success',
  },
  // Anthropic record with cache-write tokens — priceCoverage='partial' (unpriced category)
  {
    recordId: 'fix-013', timestamp: '2026-10-04T11:00:00Z', feature: 'candidate_communication',
    model: 'claude-3-5-sonnet', provider: 'anthropic', operation: 'chat',
    inputTokens: 700, outputTokens: 300, cacheReadTokens: 0, embeddingTokens: 0,
    cacheWriteTokens: 150,  // unpriced in NON-POLICY catalog → partial coverage
    usageKnown: true, attempt: 1,
    logicalOperationId: 'op-013', completionOutcome: 'success',
  },
  // Note: fix-012 (embedding reuse, 0 tokens) was removed. Reuse paths must NOT
  // produce a UsageRecord — no billed API call was made, so no record is emitted.
  // The semantic_matching feature reuses stored vectors and emits only Pinecone spans,
  // not AI usage records.
];
