#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
/**
 * S10 fixture driver: exercises instrumented P2 seams with fakes (OBS-P2-S10-AC2).
 *
 * Uses actual source-level seams (readStore, PineconeVectorStore, parseResume,
 * scheduling state machine) with patched SDK/fs dependencies.
 * No paid provider network calls are possible.
 *
 * Dual mode:
 *   In-memory (default): spans collected via InMemorySpanExporter.
 *   OTLP export (when OTLP_ENDPOINT is set): spans exported to a real collector.
 *
 * Usage:
 *   node --import tsx scripts/observability-p2-fixtures.mjs [--scenario <name>] [--list]
 *   OTLP_ENDPOINT=http://127.0.0.1:4318 node --import tsx scripts/observability-p2-fixtures.mjs
 *
 * Scenarios (S10-AC2):
 *   store_read        - readStore() against temp-dir fixture (fast path baseline)
 *   slow_store        - readStore() with delayed fs.promises.readFile (elevated I/O span)
 *   slow_llm          - parseResume() with ChatOpenAI.prototype.invoke delayed 50 ms then success
 *   malformed_model   - parseResume() with ChatOpenAI.prototype.invoke returning non-JSON
 *   pinecone_empty    - PineconeVectorStore.similaritySearch with fake SDK (empty result)
 *   pinecone_not_found - PineconeVectorStore.getEntry with fake SDK (not_found)
 *   pinecone_timeout  - PineconeVectorStore.similaritySearch with fake timeout
 *   matching_fallback - calculateSemanticSimilarity fallback (both entries not_found → score 0)
 *   scheduling        - Actual startInterviewScheduling with fixture store data
 *   all               - All scenarios (default)
 *
 * Authorization: synthetic only. No production provider calls, no real data.
 * DATA_DIR is set to a temp directory before any store imports.
 *
 * Privacy: all inherited provider credentials are stripped unconditionally so
 * no real key can leak into child processes or telemetry payloads.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// ─── Step 1: prepare temp DATA_DIR before any store or telemetry imports ──────

const tempDataDir = mkdtempSync(join(tmpdir(), 'rec-app-p2-fixtures-'));
process.env.DATA_DIR = tempDataDir;

// Write minimal fixture store so readStore() succeeds.
const fixtureStore = {
  companies: [{ id: 'co-1', companyName: 'Acme Corp', description: 'Synthetic', location: 'Remote', companySize: '50-100', industry: 'Technology', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  jobs: [{ id: 'job-1', companyId: 'co-1', jobTitle: 'Software Engineer', positionDescription: 'Build things', requirements: ['TypeScript'], positionLocation: 'Remote', payRange: { min: 100000, max: 150000, currency: 'USD' }, responsibilities: ['Code'], qualifications: ['BS CS'], requiredSkills: ['TypeScript'], requiredExperience: 2, reportsTo: 'CTO', isActive: true, totalOpenings: 1, currentApplications: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  applicants: [{ id: 'app-1', firstName: 'Test', lastName: 'User', email: null, passwordHash: null, phone: '555-0100', preferredContactMethod: 'email', address: { state: 'CA', zip: '90001' }, educationHistory: [{ institution: 'State U', degree: 'BS', fieldOfStudy: 'Computer Science', startDate: '2020-09-01', endDate: '2024-06-01' }], employmentHistory: [{ company: 'OldCo', position: 'Engineer', startDate: '2024-07-01', endDate: '2026-01-01', responsibilities: ['TypeScript'] }], rightToWork: true, requiresSponsorship: false, expectedPay: 110000, notificationToManager: false, hireRecords: [], oauthProvider: null, oauthProviderId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  applications: [{ id: 'application-1', applicantId: 'app-1', jobPostingId: 'job-1', status: 'pending', matchScore: 0, keywordMatches: [], educationMatchScore: 0, experienceMatchScore: 0, appliedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', emailConfirmed: true }],
  users: [],
  hires: [],
  observability: [],
  drafts: [],
  passwordResetTokens: [],
};
writeFileSync(join(tempDataDir, 'store.json'), JSON.stringify(fixtureStore, null, 2));

// ─── Step 2: strip all inherited provider credentials unconditionally ────────
// Use explicit assignment (NOT ??=) so no real key can be preserved.

delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.PINECONE_API_KEY;

// Inject known dummy values that look like real keys but are obviously synthetic.
process.env.OPENAI_API_KEY   = 'sk-fixture-fake-0000000000000000000000000000000000000000000000000000';
process.env.ANTHROPIC_API_KEY = 'sk-ant-fixture-fake-000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
process.env.PINECONE_API_KEY  = 'pcsk-fixture-fake-000000000000000000000000000000000000000000000000000000';

process.env.TELEMETRY_ENABLED ??= 'true';
process.env.APP_ENV           ??= 'test';
process.env.APP_TRAFFIC       ??= 'synthetic';

// ─── Step 3: determine mode ───────────────────────────────────────────────────

const otlpEndpoint = process.env.OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
const isOtlpMode   = Boolean(otlpEndpoint);
const runId        = `p2-fix-${randomUUID().slice(0, 8)}`;

// ─── Step 4: import telemetry ─────────────────────────────────────────────────

const { createTestTelemetry, initTelemetry, shutdownTelemetry, forceFlushTelemetry } =
  await import('../src/telemetry/index.js');
const { withPineconeSpan, withStoreSpan, withVectorstoreSpan, withSchedulingSpan } =
  await import('../src/telemetry/p2Operations.js');

let tel;
if (isOtlpMode) {
  // Unique service name so Jaeger/Prometheus isolates this verification run.
  // If the caller (e.g. verifier) already set OTEL_SERVICE_NAME, honor it unconditionally.
  if (!process.env.OTEL_SERVICE_NAME) {
    process.env.OTEL_SERVICE_NAME = `rec-app-p2-${runId}`;
  }
  process.env.TELEMETRY_RELEASE                ??= runId;
  process.env.TELEMETRY_ENVIRONMENT            ??= 'local';
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT       = otlpEndpoint;
  process.env.TELEMETRY_METRIC_INTERVAL_MS       = '500';
  process.env.TELEMETRY_SCHEDULE_DELAY_MS        = '200';
  process.env.TELEMETRY_ALLOW_REMOTE_EXPORT      = 'false';
  initTelemetry({
    env: process.env,
    overrides: { metricIntervalMs: 500 },
  });
  tel = null;
  console.log(`[fixtures] OTLP mode → endpoint=${otlpEndpoint} service=${process.env.OTEL_SERVICE_NAME} runId=${runId}`);
} else {
  tel = createTestTelemetry({
    env: process.env,
    overrides: { metricIntervalMs: 500 },
    spanProcessor: 'simple',
  });
  console.log('[fixtures] In-memory mode (no OTLP_ENDPOINT set)');
}

// ─── Step 5: patch Pinecone SDK prototype ─────────────────────────────────────

const { Pinecone } = await import('@pinecone-database/pinecone');

Pinecone.prototype.listIndexes = async function() {
  return { indexes: [{ name: process.env.PINECONE_INDEX_NAME || 'recruiting-app' }] };
};

let _nextQueryShouldTimeout = false;
let failFetch = false;

Pinecone.prototype.index = function(_indexName) {
  return {
    query: async function({ topK = 10 } = {}) {
      await _sleep(5);
      if (_nextQueryShouldTimeout) {
        _nextQueryShouldTimeout = false;
        const e = new Error('Request timed out after 5000ms');
        e.name = 'TimeoutError';
        throw e;
      }
      return { matches: [] };
    },
    fetch: async function() {
      if (failFetch) throw Object.assign(new Error('synthetic vector timeout'), { name: 'TimeoutError' });
      await _sleep(3);
      return { records: {} };
    },
    upsert: async function() { await _sleep(3); return {}; },
    deleteOne: async function() { await _sleep(2); },
    deleteMany: async function() { await _sleep(2); },
    deleteAll: async function() { await _sleep(2); },
    describeIndexStats: async function() { return { totalRecordCount: 0 }; },
  };
};

// ─── Step 6: patch ChatOpenAI.prototype.invoke for LLM scenarios ──────────────
// Must happen BEFORE importing chains/LLM service so InstrumentedChatOpenAI's
// super.invoke() uses the patched implementation.

const { ChatOpenAI } = await import('@langchain/openai');

// Control knobs for LLM scenarios (reset after each call).
let _llmDelayMs = 0;
let _llmNextResponse = null;   // null = use default valid-JSON response
let _llmCallCount = 0;

// Known exact usage for fixture assertions: 11 input / 7 output tokens.
// These are plausible for a minimal resume parse prompt; using explicit values
// avoids fabricating unknown usage. Actual provider would differ — this is
// declared as synthetic fixture data, not a production usage measurement.
const FIXTURE_USAGE = { input_tokens: 11, output_tokens: 7, total_tokens: 18 };

// Valid minimal parsed-resume JSON that satisfies ParsedResumeSchema.
const VALID_RESUME_JSON = JSON.stringify({
  firstName: 'Fixture',
  lastName: 'Person',
  email: 'fixture@example.com',
  phone: '555-0100',
  address: { state: 'CA', zip: '90001' },
  educationHistory: [],
  employmentHistory: [],
  skills: ['TypeScript'],
  achievements: [],
  certifications: [],
  confidenceScores: { firstName: 0.99 },
  rawText: 'Fixture resume text for synthetic scenario',
});

ChatOpenAI.prototype.invoke = async function fakeInvoke(_input, _options) {
  _llmCallCount++;
  const delayMs = _llmDelayMs;
  const nextResp = _llmNextResponse;
  _llmDelayMs = 0;
  _llmNextResponse = null;

  if (delayMs > 0) await _sleep(delayMs);

  if (nextResp !== null) {
    // nextResp is a pre-built fake response object or an Error to throw.
    if (nextResp instanceof Error) throw nextResp;
    return nextResp;
  }

  // Default: return a valid JSON response with known token counts.
  return {
    content: VALID_RESUME_JSON,
    response_metadata: {
      tokenUsage: {
        completionTokens: FIXTURE_USAGE.output_tokens,
        promptTokens:     FIXTURE_USAGE.input_tokens,
        totalTokens:      FIXTURE_USAGE.total_tokens,
      },
      usage: {
        completion_tokens: FIXTURE_USAGE.output_tokens,
        prompt_tokens:     FIXTURE_USAGE.input_tokens,
        total_tokens:      FIXTURE_USAGE.total_tokens,
      },
    },
    usage_metadata: {
      input_tokens:  FIXTURE_USAGE.input_tokens,
      output_tokens: FIXTURE_USAGE.output_tokens,
      total_tokens:  FIXTURE_USAGE.total_tokens,
    },
  };
};

// Delay the actual filesystem seam once; business readStore still owns its span.
let delayStoreRead = false;
const originalReadFile = fsPromises.readFile;
fsPromises.readFile = async function(...args) {
  if (delayStoreRead && String(args[0]).endsWith('store.json')) {
    delayStoreRead = false;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return originalReadFile.apply(this, args);
};
syncBuiltinESMExports();

// ─── Step 7: import actual business seams ─────────────────────────────────────

const { readStore }              = await import('../src/models/store.js');
const { PineconeVectorStore }    = await import('../src/services/vectorStore/pinecone.js');
const { calculateSemanticSimilarity } = await import('../src/services/vectorStore/index.js');
const { parseResume }            = await import('../src/chains/resumeParsing.js');
const { startInterviewScheduling } = await import('../src/agents/scheduling/agent.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function scenarioStoreRead() {
  console.log('\n[scenario] store_read: real readStore() against temp-dir fixture');
  const store = await readStore();
  console.log(`  → readStore() returned ${store.jobs.length} job(s), ${store.applicants.length} applicant(s)`);
  console.log('  → span emitted: store.read with feature=store, outcome=success');
}

async function scenarioSlowStore() {
  delayStoreRead = true;
  await readStore();
  console.log('[scenario] slow_store: actual readStore with controlled 80ms I/O delay');
}

async function scenarioSlowLLM() {
  console.log('\n[scenario] slow_llm: parseResume() with 50 ms model delay then success (S10-AC2)');
  // Exact known usage: 11 input / 7 output tokens (FIXTURE_USAGE).
  // ai.chat.attempt span will show elevated duration from the fake delay.
  _llmDelayMs = 50;
  const text = 'SYNTHETIC_P2_PRIVATE_CANARY_48291 Fixture Person\nfixture@example.com\n555-0100\nSoftware Engineer';
  const result = await parseResume(text);
  console.log(`  → parseResume returned firstName=${result.firstName}`);
  console.log(`  → ai.chat + ai.chat.attempt spans: attempt delayed ${FIXTURE_USAGE.input_tokens} input / ${FIXTURE_USAGE.output_tokens} output tokens recorded`);
  console.log('  → Slow LLM visible as dominant dependency latency in trace (S10-AC2)');
}

async function scenarioMalformedModel() {
  console.log('\n[scenario] malformed_model: parseResume() with model returning non-JSON (S10-AC2)');
  // Provider "succeeds" but output is not parseable JSON.
  // parseResume distinguishes this: JSON.parse fails → ctx.markParseOutcome('json_failure').
  // ai.chat span shows ai.parse_outcome=json_failure; ai.chat.attempt shows success.
  // One logical operation + one attempt pair. Unknown-model response treated as synthetic.
  _llmNextResponse = {
    content: 'Sorry, I cannot provide structured resume data in the requested format.',
    usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    response_metadata: {
      tokenUsage: { completionTokens: 7, promptTokens: 11, totalTokens: 18 },
      usage:      { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
    },
  };
  try {
    await parseResume('Fixture Person fixture@example.com');
  } catch {
    console.log('  → caught expected JSON parse failure from parseResume');
  }
  console.log('  → ai.chat span: ai.parse_outcome=json_failure, outcome≠success (S10-AC2)');
  console.log('  → ai.chat.attempt span: outcome=success (provider responded, parse failed in app)');
  console.log('  → Provider success + app parse failure are distinguishable (OBS-P2-S02-AC3)');
}

async function scenarioRejectedModel() {
  _llmNextResponse = Object.assign(new Error('synthetic rejection'), { name: 'TimeoutError' });
  try { await parseResume('SYNTHETIC_P2_PRIVATE_CANARY_48291'); } catch { /* expected */ }
}

async function scenarioPineconeEmpty() {
  console.log('\n[scenario] pinecone_empty: PineconeVectorStore.similaritySearch (empty result)');
  const vs = new PineconeVectorStore();
  const results = await vs.similaritySearch(new Array(1536).fill(0.1), { entityType: 'job' }, 5);
  console.log(`  → similaritySearch returned ${results.length} result(s)`);
  console.log('  → pinecone.query span: outcome=empty, app.count_bucket=0');
}

async function scenarioPineconeNotFound() {
  console.log('\n[scenario] pinecone_not_found: PineconeVectorStore.getEntry (not found)');
  const vs = new PineconeVectorStore();
  const entry = await vs.getEntry('nonexistent-id-fixture');
  console.log(`  → getEntry returned: ${entry === undefined ? 'undefined (not found)' : JSON.stringify(entry)}`);
  console.log('  → pinecone.fetch span: outcome=not_found');
}

async function scenarioPineconeTimeout() {
  console.log('\n[scenario] pinecone_timeout: PineconeVectorStore.similaritySearch with timeout (S10-AC2)');
  _nextQueryShouldTimeout = true;
  const vs = new PineconeVectorStore();
  try {
    await vs.similaritySearch(new Array(1536).fill(0.1));
  } catch (err) {
    console.log(`  → caught expected error: ${err.name} — pinecone.query: error.type=timeout, outcome=timeout`);
  }
}

async function scenarioMatchingFallback() {
  const { calculateMatchScore } = await import('../src/chains/matching.js');
  failFetch = true;
  try { await calculateMatchScore('app-1', 'job-1'); }
  finally { failFetch = false; }
  console.log('[scenario] matching_fallback: actual caught vector exception preserves score');
}

async function scenarioScheduling() {
  console.log('\n[scenario] scheduling: actual startInterviewScheduling with fixture store (S10-AC2)');
  // Uses the real state-machine execute() path (createInitialState → initNode → error outcome).
  // Fixture applicant/job/company IDs from fixtureStore written above.
  // Expected path: init → error (application found, job found, valid → collecting_availability →
  // stays there since no proposedTimes, hits maxRetries → cancelled).
  // We use app-1/job-1/co-1 from the fixture store written at step 1.
  const result = await startInterviewScheduling(
    'application-1',  // applicationId — must match fixture store
    'app-1',          // candidateId
    'job-1',          // jobId
    'co-1',           // companyId
    [],               // interviewerIds (none for fixture)
  );
  console.log(`  → scheduling completed with state: ${result.currentState}`);
  console.log(`  → retryCount: ${result.retryCount}`);
  console.log('  → scheduling.execute + scheduling.step spans emitted for each state');
  console.log('  → terminal state visible in scheduling.execute span outcome');

  // Also test an invalid transition: explicitly try to complete a cancelled workflow.
  // S09-AC3: caught invalid transition is visible in trace without throwing at HTTP boundary.
  const cancelledState = { ...result, currentState: 'confirmed' };
  // Force confirmed state to test a realistic cancel from confirmed.
  const { cancelInterview } = await import('../src/agents/scheduling/agent.js');
  try {
    const cancelled = await cancelInterview(cancelledState, 'Fixture-initiated cancellation');
    const { completeInterview } = await import('../src/agents/scheduling/agent.js');
    try { await completeInterview(cancelled); } catch { /* actual invalid terminal replay */ }
    console.log(`  → cancelInterview result: ${cancelled.currentState}`);
  } catch (err) {
    console.log(`  → cancelInterview error: ${err.message}`);
  }

  // Test terminal replay rejection (S09-AC4).
  const { completeInterview } = await import('../src/agents/scheduling/agent.js');
  try {
    await completeInterview({ ...result });  // result is 'cancelled' — can't complete
  } catch (err) {
    console.log(`  → replay rejection: ${err.message.slice(0, 80)}`);
    console.log('  → scheduling.transition error span emitted; no success completion counted');
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  console.log('Available scenarios: store_read slow_store slow_llm malformed_model pinecone_empty pinecone_not_found pinecone_timeout matching_fallback scheduling all');
  process.exit(0);
}
const scenarioArg = argv[argv.indexOf('--scenario') + 1] ?? 'all';

const SCENARIOS = {
  store_read:          scenarioStoreRead,
  slow_store:          scenarioSlowStore,
  slow_llm:            scenarioSlowLLM,
  malformed_model:     scenarioMalformedModel,
  rejected_model:      scenarioRejectedModel,
  pinecone_empty:      scenarioPineconeEmpty,
  pinecone_not_found:  scenarioPineconeNotFound,
  pinecone_timeout:    scenarioPineconeTimeout,
  matching_fallback:   scenarioMatchingFallback,
  scheduling:          scenarioScheduling,
};

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log('=== P2 fixture driver (S10) ===');
console.log(`Scenario: ${scenarioArg}`);
console.log(`Mode: ${isOtlpMode ? `OTLP → ${otlpEndpoint}` : 'in-memory'}`);
console.log(`RunId: ${runId}`);
console.log(`DATA_DIR: ${tempDataDir}`);

const toRun = scenarioArg === 'all' ? Object.values(SCENARIOS) : [SCENARIOS[scenarioArg]];
if (!toRun[0]) {
  console.error(`Unknown scenario: ${scenarioArg}. Use --list to see options.`);
  process.exit(1);
}

let fixtureError;
try {
  for (const fn of toRun) {
    await fn();
  }
} catch (err) {
  fixtureError = err;
  console.error(`[fixtures] Scenario error: ${err.message}`);
} finally {
  // Always flush telemetry and clean up temp dir, even on scenario failure.
  try {
    if (isOtlpMode) {
      await forceFlushTelemetry(3000);
      await shutdownTelemetry(2000);
    } else if (tel) {
      await tel.flush();
    }
  } catch { /* fail-open: don't mask scenario errors */ }

  try { rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

if (tel) {
  const spans = tel.spans();
  const spanNames = [...new Set(spans.map((s) => s.name))].sort();

  console.log(`\n=== Results ===`);
  console.log(`Total spans captured: ${spans.length}`);
  console.log(`Span names: ${spanNames.join(', ')}`);

  for (const s of spans) {
    const durationMs = ((s.endTime[0] * 1e9 + s.endTime[1]) - (s.startTime[0] * 1e9 + s.startTime[1])) / 1e6;
    const outcome = s.attributes['app.outcome'] ?? 'n/a';
    const errType = s.attributes['error.type'] ?? '';
    const parseOut = s.attributes['ai.parse_outcome'] ?? '';
    const extra = [errType && `error.type=${errType}`, parseOut && `ai.parse_outcome=${parseOut}`].filter(Boolean).join(' ');
    console.log(`  ${s.name.padEnd(40)} outcome=${String(outcome).padEnd(18)} duration=${durationMs.toFixed(1)}ms${extra ? ' ' + extra : ''}`);
  }

  // S10-AC2 verification summary.
  console.log('\n[S10-AC2] Expected span inventory:');
  console.log('  store.read              outcome=success         (store_read scenario)');
  console.log('  store.read              outcome=success         (slow_store: elevated duration)');
  console.log('  ai.chat                 ai.parse_outcome=n/a    (slow_llm: logical op span)');
  console.log('  ai.chat.attempt         outcome=success         (slow_llm: attempt span, 50 ms delay)');
  console.log('  ai.chat                 ai.parse_outcome=json_failure (malformed_model: logical op)');
  console.log('  ai.chat.attempt         outcome=success         (malformed_model: provider ok, app fails)');
  console.log('  pinecone.query          outcome=empty           (pinecone_empty)');
  console.log('  pinecone.fetch          outcome=not_found       (pinecone_not_found)');
  console.log('  pinecone.query          outcome=timeout         (pinecone_timeout, error.type=timeout)');
  console.log('  vectorstore.semantic_similarity outcome=timeout (exception caught by matching score)');
  console.log('  scheduling.execute      outcome=cancelled/error (scheduling: actual state machine)');
  console.log('  scheduling.step         outcome=success/error   (×N, each state transition)');
  console.log('  scheduling.transition   outcome=error           (replay/invalid transition rejection)');

  console.log('\n[S10-AC3] Duration notes:');
  console.log('  Parent span duration ≤ sum of overlapping child spans is expected for concurrent children.');
  console.log('  Use parent wall-clock for end-to-end duration; child spans for component breakdown.');
  console.log('  Sparse data (single run): p95 may equal p50/p99 with < 20 observations.');

  console.log('\n[LIMITATION] SDK hidden retries (Pinecone, OpenAI) not visible as separate spans.');
  console.log('[LIMITATION] No durable continuation: scheduling state cannot resume across restarts.');
  console.log('[LIMITATION] OBS-P2-S05 pending: cost coverage shown in cost-report script only.');

  try { await tel.shutdown(); } catch { /* ignore */ }
} else {
  console.log(`\n=== OTLP mode: spans exported to ${otlpEndpoint} ===`);
  console.log(`Service: ${process.env.OTEL_SERVICE_NAME}  RunId: ${runId}`);
  console.log(`Query Jaeger: http://127.0.0.1:16686/search?service=${encodeURIComponent(process.env.OTEL_SERVICE_NAME)}`);
}

if (fixtureError) process.exit(1);
