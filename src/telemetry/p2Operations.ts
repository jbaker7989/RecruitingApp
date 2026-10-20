/**
 * P2 telemetry helpers (OBS-P2-S07/S08/S09).
 *
 * Registers safe span/metric/scope names and provides fail-open wrappers for
 * Pinecone vector-store, JSON store, and scheduling state-machine operations.
 *
 * Constraints:
 * - Uses only @opentelemetry/api (no SDK imports here).
 * - All attribute keys are allow-listed in privacy.ts; no new keys introduced.
 *   Any required additions are declared in observability/p2/schema-contract.md.
 * - registerSafeNames called once at module load with static string literals.
 * - Wrappers are fail-open: telemetry errors never propagate to callers.
 * - No identifiers (entity ids, applicant ids, job ids) used as metric labels.
 * - app.feature read from request context when available; validated against the
 *   finite FEATURE_VOCAB before use — unknown labels map to 'unknown'.
 */

import {
  context, metrics, trace, SpanKind, SpanStatusCode, INVALID_SPAN_CONTEXT,
} from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { classifyError, recordSafeError, registerSafeNames } from './privacy.js';
import { getRequestContext } from './context.js';

// ─── Name registration ────────────────────────────────────────────────────────
// Static literals only — code-review gate.

registerSafeNames({
  spans: [
    // Pinecone vector-store operations (S07)
    'pinecone.query',
    'pinecone.upsert',
    'pinecone.fetch',
    'pinecone.delete',
    'pinecone.delete_many',
    'pinecone.delete_all',
    'pinecone.batch_upsert',
    'pinecone.describe_stats',
    'pinecone.init',
    // Vector-store index/search (embedding vs. reuse path) (S07)
    'vectorstore.index',
    'vectorstore.reindex',
    'vectorstore.similarity_search',
    'vectorstore.semantic_similarity',
    // JSON store operations (S08)
    'store.read',
    'store.write',
    'store.audit.read',
    'store.audit.write',
    'store.audit.append',
    // Scheduling state machine (S09)
    'scheduling.execute',
    'scheduling.transition',
    'scheduling.step',
    // Matching chain (S07/S09)
    'matching.score',
    'matching.rebuild',
  ],
  scopes: [
    'rec-app.p2',
    'rec-app.store',
    'rec-app.vectorstore',
    'rec-app.scheduling',
  ],
  metrics: [
    // Pinecone metrics (S07)
    'app.pinecone.operation.count',
    'app.pinecone.operation.duration',
    // Store metrics (S08)
    'app.store.operation.count',
    'app.store.operation.duration',
    // Scheduling metrics (S09)
    'app.scheduling.execution.count',
    'app.scheduling.transition.count',
    'app.scheduling.duration',
    // Vector-store aggregate metrics (S07)
    'app.vectorstore.operation.count',
    'app.vectorstore.operation.duration',
    // Cost metrics (S06)
    'app.ai.cost.estimated_usd',
    'app.ai.usage.tokens',
  ],
});

// ─── Tracers ──────────────────────────────────────────────────────────────────

const TRACER_VECTORSTORE = 'rec-app.vectorstore';
const TRACER_STORE       = 'rec-app.store';
const TRACER_SCHEDULING  = 'rec-app.scheduling';
const METER_P2           = 'rec-app.p2';

// ─── Finite feature vocabulary ────────────────────────────────────────────────

/**
 * Source-declared finite feature vocabulary for app.feature attribute.
 * Context labels not in this set are mapped to 'unknown'.
 * The union covers dev1 (AI chains) and dev2 (infra operations) features.
 * Additions require a code change and schema-contract.md update.
 */
const FEATURE_VOCAB: ReadonlySet<string> = new Set([
  // Dev1 AI chain features
  'resume_parsing',
  'job_description',
  'candidate_communication',
  // Dev2 vector-store features
  'interview_scheduling',
  'semantic_matching',
  'job_indexing',
  'applicant_indexing',
  'job_search',
  'applicant_search',
  'vectorstore',
  'vectorstore_init',
  'reindex',
  'semantic_rebuild',
  // Dev2 store features
  'store',
]);

/**
 * Finite step vocabulary for scheduling operations.
 * Steps not in this set are mapped to 'unknown'.
 */
const SCHEDULING_STEP_VOCAB: ReadonlySet<string> = new Set([
  // Scheduling states from InterviewState
  'init',
  'collecting_availability',
  'finding_slot',
  'sending_invites',
  'confirmed',
  'cancelled',
  'reschedule_requested',
  'completed',
  'error',
  // Span kind values (valid in 'step' context)
  'execute',
  'transition',
  'step',
]);

// ─── Feature and step helpers ─────────────────────────────────────────────────

/**
 * Read bounded feature label from request context; validate against finite
 * vocabulary. Falls back to supplied default; both checked against vocabulary.
 * Returns 'unknown' if neither is in vocabulary.
 */
function resolveFeature(operationDefault: string): string {
  const fromContext = getRequestContext()?.feature;
  if (fromContext !== undefined) {
    return FEATURE_VOCAB.has(fromContext) ? fromContext : 'unknown';
  }
  return FEATURE_VOCAB.has(operationDefault) ? operationDefault : 'unknown';
}

/** Normalize a scheduling step to the finite vocabulary. */
function resolveSchedulingStep(step: string): string {
  return SCHEDULING_STEP_VOCAB.has(step) ? step : 'unknown';
}

// ─── Fail-open span helper ────────────────────────────────────────────────────

/**
 * Start a span safely: if the tracer or span processor throws during startSpan
 * (e.g. a buggy custom processor), return a NOOP span so fn() is always called.
 * This prevents telemetry failures from breaking business callbacks.
 */
function safeStartSpan(
  tracerName: string,
  spanName: string,
  kind: SpanKind,
  attrs: Record<string, string | number | boolean>,
): Span {
  try {
    return trace.getTracer(tracerName).startSpan(spanName, { kind, attributes: attrs });
  } catch {
    return trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  }
}

// ─── Instrument factories ─────────────────────────────────────────────────────
// Resolved lazily so the SDK provider registered after module load is used.

function pineconeMetrics() {
  const m = metrics.getMeter(METER_P2);
  return {
    count:    m.createCounter('app.pinecone.operation.count',   { description: 'Pinecone operations by outcome' }),
    duration: m.createHistogram('app.pinecone.operation.duration', { unit: 's', description: 'Pinecone operation duration' }),
  };
}

function storeMetrics() {
  const m = metrics.getMeter(METER_P2);
  return {
    count:    m.createCounter('app.store.operation.count',   { description: 'JSON store operations by outcome' }),
    duration: m.createHistogram('app.store.operation.duration', { unit: 's', description: 'JSON store operation duration' }),
  };
}

function schedulingMetrics() {
  const m = metrics.getMeter(METER_P2);
  return {
    executions:   m.createCounter('app.scheduling.execution.count',  { description: 'Scheduling executions by outcome' }),
    transitions:  m.createCounter('app.scheduling.transition.count', { description: 'Scheduling state transitions' }),
    duration:     m.createHistogram('app.scheduling.duration', { unit: 's', description: 'Scheduling execution duration' }),
  };
}

function vectorstoreMetrics() {
  const m = metrics.getMeter(METER_P2);
  return {
    count:    m.createCounter('app.vectorstore.operation.count',   { description: 'Vector-store logical operations' }),
    duration: m.createHistogram('app.vectorstore.operation.duration', { unit: 's', description: 'Vector-store logical operation duration' }),
  };
}

// ─── Pinecone span wrapper (S07) ──────────────────────────────────────────────

export type PineconeOp =
  | 'query' | 'upsert' | 'fetch' | 'delete' | 'delete_many'
  | 'delete_all' | 'batch_upsert' | 'describe_stats' | 'init';

export interface PineconeSpanOpts<T> {
  /**
   * Derive app.outcome from the successful result. Use for distinct outcomes
   * that aren't errors: 'empty' (query with no matches), 'not_found' (fetch
   * that returned undefined). These values are declared in schema-contract.md
   * as pending orchestrator integration in privacy.ts OUTCOMES list.
   */
  outcomeFn?: (result: T) => string;
  /**
   * Derive safe bounded metadata attributes from the successful result.
   * Values MUST be counts/buckets (never identifiers, never free text).
   * Keys must be declared in schema-contract.md before use in production.
   * String values must be finite enums (e.g. '0', '1-10', '11-50', '51+').
   */
  resultAttrs?: (result: T) => Record<string, string | number>;
}

/**
 * Wrap a Pinecone SDK call with a CLIENT span and metrics.
 * Fail-open: telemetry errors never propagate; business exceptions re-throw unchanged.
 */
export async function withPineconeSpan<T>(
  op: PineconeOp,
  featureDefault: string,
  fn: () => Promise<T>,
  opts?: PineconeSpanOpts<T>,
): Promise<T> {
  const feature = resolveFeature(featureDefault);
  const spanName = `pinecone.${op}` as const;

  const span = safeStartSpan(TRACER_VECTORSTORE, spanName, SpanKind.CLIENT, {
    'app.index.alias': 'primary',
    'app.dependency': 'pinecone',
    'app.operation':  op,
    'app.feature':    feature,
  });
  const start = performance.now();
  let outcome = 'success';

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    if (opts?.outcomeFn) {
      try { outcome = opts.outcomeFn(result) ?? 'success'; } catch { /* fail-open */ }
    }
    try {
      span.setAttribute('app.outcome', outcome);
      if (opts?.resultAttrs) {
        const ra = opts.resultAttrs(result);
        for (const [k, v] of Object.entries(ra)) {
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000) {
            span.setAttribute(k, v);
          } else if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
            span.setAttribute(k, v);
          }
        }
      }
      if (outcome === 'success' || outcome === 'empty' || outcome === 'not_found') {
        span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch { /* fail-open */ }
    return result;
  } catch (err) {
    outcome = mapOutcome(classifyError(err));
    try {
      recordSafeError(span, err);
      span.setAttribute('app.outcome', outcome);
    } catch { /* fail-open */ }
    throw err;
  } finally {
    const durationS = (performance.now() - start) / 1000;
    try {
      span.end();
      const pm = pineconeMetrics();
      pm.count.add(1,    { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature, 'app.dependency': 'pinecone' });
      pm.duration.record(durationS, { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature, 'app.dependency': 'pinecone' });
    } catch { /* fail-open */ }
  }
}

// ─── Store span wrapper (S08) ─────────────────────────────────────────────────

export type StoreOp = 'read' | 'write' | 'audit_read' | 'audit_write' | 'audit_append';

/**
 * I/O classification for store operations: bounded safe values (never free text).
 * 'permission_denied' maps EACCES; 'not_found' maps ENOENT; these are distinct
 * from 'internal' errors that indicate unexpected states.
 */
type StoreIoClass = 'permission_denied' | 'not_found' | 'parse_error' | 'io_error' | 'ok';

/** Classify a store error into a bounded I/O category. */
function classifyStoreError(err: unknown): StoreIoClass {
  if (err instanceof SyntaxError) return 'parse_error';
  const code = (err as { code?: string }).code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission_denied';
  if (code === 'ENOENT') return 'not_found';
  if (code === 'EISDIR' || code === 'EIO' || code === 'ENOSPC') return 'io_error';
  return 'io_error';
}

/**
 * Wrap a JSON store or audit operation with an INTERNAL span and metrics.
 * Preserves swallowed-read semantics: callers catch errors themselves; this
 * wrapper does not swallow. EACCES/ENOENT/parse errors are classified into
 * bounded safe I/O categories, not treated as generic 'internal'.
 */
export async function withStoreSpan<T>(
  op: StoreOp,
  featureDefault: string,
  fn: () => Promise<T>,
): Promise<T> {
  const feature = resolveFeature(featureDefault);
  const spanSuffix = op.startsWith('audit') ? `audit.${op.replace('audit_', '')}` : op;
  const spanName = `store.${spanSuffix}` as const;

  const span = safeStartSpan(TRACER_STORE, spanName, SpanKind.INTERNAL, {
    'app.dependency': 'json_store',
    'app.operation':  op,
    'app.feature':    feature,
  });
  const start = performance.now();
  let outcome = 'success';

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    try {
      span.setAttribute('app.outcome', 'success');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch { /* fail-open */ }
    return result;
  } catch (err) {
    // Classify I/O errors distinctly; fall back to general error classification.
    const ioClass = classifyStoreError(err);
    outcome = ioClass === 'ok' ? mapOutcome(classifyError(err)) :
      ioClass === 'permission_denied' ? 'client_error' :
      ioClass === 'not_found' ? 'client_error' :
      ioClass === 'parse_error' ? 'validation_error' :
      'server_error';
    try {
      recordSafeError(span, err);
      span.setAttribute('app.outcome', outcome);
      // Safe classification tag (not a metric label — span-only).
      // Declared in schema-contract.md as pending integration in privacy.ts.
      span.setAttribute('app.store.io_class', ioClass);
    } catch { /* fail-open */ }
    throw err;
  } finally {
    const durationS = (performance.now() - start) / 1000;
    try {
      span.end();
      const sm = storeMetrics();
      sm.count.add(1,    { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature, 'app.dependency': 'json_store' });
      sm.duration.record(durationS, { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature, 'app.dependency': 'json_store' });
    } catch { /* fail-open */ }
  }
}

// ─── Scheduling span wrapper (S09) ────────────────────────────────────────────

export type SchedulingOp =
  | 'execute' | 'transition' | 'step'
  | 'init' | 'collecting_availability' | 'finding_slot'
  | 'sending_invites' | 'confirmed' | 'cancelled'
  | 'reschedule_requested' | 'completed' | 'error';

export interface SchedulingSpanOpts {
  /** Mark simulated calendar/email integration (true = simulated, absent = production path). */
  simulated?: boolean;
  /** Retry attempt index for this scheduling step (1–100). */
  attempt?: number;
  /**
   * Correlation: identifies the enclosing scheduling workflow execution.
   * Used as a span attribute (never a metric label) to link step spans to their
   * parent execute span in traces. Format: safe alphanumeric ID 8–64 chars.
   * Declared in schema-contract.md as app.workflow.run_id (pending privacy.ts integration).
   */
  runId?: string;
  /**
   * Entry point that initiated this execution (e.g. 'api', 'cron', 'retry').
   * Declared in schema-contract.md as app.workflow.entry_point (pending privacy.ts integration).
   */
  entryPoint?: string;
}

/**
 * Wrap a scheduling execution or state transition with an INTERNAL span.
 * No span is held open across human waiting — only active execution is measured.
 * app.traffic='synthetic' is set only for explicitly flagged test/fixture runs;
 * production scheduling with simulated calendar/email does NOT set app.traffic.
 */
export async function withSchedulingSpan<T>(
  kind: 'execute' | 'transition' | 'step',
  step: string,
  opts: SchedulingSpanOpts = {},
  fn: () => Promise<T>,
  outcomeFn?: (result: T) => string,
): Promise<T> {
  const feature = resolveFeature('interview_scheduling');
  const spanName = `scheduling.${kind}` as const;
  const safeStep = resolveSchedulingStep(step);

  const attrs: Record<string, string | number | boolean> = {
    'app.workflow.name': 'interview_scheduling',
    'app.workflow.version': '1',
    'app.integration.mode': opts.simulated ? 'simulated' : 'live',
    'app.dependency': 'scheduling',
    'app.operation':  safeStep,
    'app.feature':    feature,
  };
  // Only mark synthetic for explicit test/fixture scenarios, not for production
  // scheduling that merely uses simulated calendar/email integration.
  if (opts.simulated === true && process.env.APP_TRAFFIC === 'synthetic') {
    attrs['app.traffic'] = 'synthetic';
  }
  if (opts.attempt !== undefined && opts.attempt >= 1 && opts.attempt <= 100) {
    attrs['app.attempt'] = opts.attempt;
  }
  // Workflow correlation (span-only) — pending schema-contract.md / privacy.ts integration.
  // These will be sanitized until dev1/orchestrator adds them to ALLOWED_SPAN_KEYS.
  if (opts.runId && /^[A-Za-z0-9_-]{8,64}$/.test(opts.runId)) {
    attrs['app.workflow.run_id'] = opts.runId;
  }
  if (opts.entryPoint && /^[a-z][a-z0-9_]{0,31}$/.test(opts.entryPoint)) {
    attrs['app.workflow.entry_point'] = opts.entryPoint;
  }

  const span = safeStartSpan(TRACER_SCHEDULING, spanName, SpanKind.INTERNAL, attrs);
  const start = performance.now();
  let outcome = 'success';

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    if (outcomeFn) {
      try { outcome = outcomeFn(result) ?? 'success'; } catch { /* fail-open */ }
    }
    try {
      span.setAttribute('app.outcome', outcome);
      if (outcome === 'success') span.setStatus({ code: SpanStatusCode.OK });
    } catch { /* fail-open */ }
    return result;
  } catch (err) {
    outcome = mapOutcome(classifyError(err));
    try {
      recordSafeError(span, err);
      span.setAttribute('app.outcome', outcome);
    } catch { /* fail-open */ }
    throw err;
  } finally {
    const durationS = (performance.now() - start) / 1000;
    try {
      span.end();
      const sm = schedulingMetrics();
      if (kind === 'execute') {
        sm.executions.add(1, { 'app.operation': safeStep, 'app.outcome': outcome, 'app.feature': feature });
        sm.duration.record(durationS, { 'app.operation': safeStep, 'app.outcome': outcome, 'app.feature': feature });
      } else {
        sm.transitions.add(1, { 'app.operation': safeStep, 'app.outcome': outcome, 'app.feature': feature });
      }
    } catch { /* fail-open */ }
  }
}

// ─── Vector-store logical span wrapper (S07) ──────────────────────────────────

export type VectorstoreLogicalOp = 'index' | 'reindex' | 'similarity_search' | 'semantic_similarity';

/**
 * Wrap a logical vector-store operation (combining embedding + Pinecone calls).
 * Distinct from withPineconeSpan which wraps individual SDK calls.
 *
 * @param outcomeFn  Optional function that derives the app.outcome from the result.
 *                   When provided it overrides the default 'success'. Use for partial
 *                   success (e.g. rebuild with some errors) once 'partial' is added to
 *                   the OUTCOMES schema by the orchestrator (see schema-contract.md).
 */
export async function withVectorstoreSpan<T>(
  op: VectorstoreLogicalOp,
  featureDefault: string,
  fn: () => Promise<T>,
  outcomeFn?: (result: T) => string,
): Promise<T> {
  const feature = resolveFeature(featureDefault);
  const spanName = `vectorstore.${op}` as const;

  const span = safeStartSpan(TRACER_VECTORSTORE, spanName, SpanKind.INTERNAL, {
    'app.dependency': 'vectorstore',
    'app.operation':  op,
    'app.feature':    feature,
  });
  const start = performance.now();
  let outcome = 'success';

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    if (outcomeFn) {
      try { outcome = outcomeFn(result) ?? 'success'; } catch { /* fail-open */ }
    }
    try {
      span.setAttribute('app.outcome', outcome);
      if (outcome === 'success') span.setStatus({ code: SpanStatusCode.OK });
    } catch { /* fail-open */ }
    return result;
  } catch (err) {
    outcome = mapOutcome(classifyError(err));
    try {
      recordSafeError(span, err);
      span.setAttribute('app.outcome', outcome);
    } catch { /* fail-open */ }
    throw err;
  } finally {
    const durationS = (performance.now() - start) / 1000;
    try {
      span.end();
      const vm = vectorstoreMetrics();
      vm.count.add(1, { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature });
      vm.duration.record(durationS, { 'app.operation': op, 'app.outcome': outcome, 'app.feature': feature });
    } catch { /* fail-open */ }
  }
}

// ─── Outcome mapping ──────────────────────────────────────────────────────────

/** Map an ErrorCategory to an allowed app.outcome value. */
function mapOutcome(category: ReturnType<typeof classifyError>): string {
  switch (category) {
    case 'timeout':    return 'timeout';
    case 'network':    return 'connect_failure';
    case 'auth':       return 'client_error';
    case 'rate_limit': return 'rate_limited';
    case 'not_found':  return 'client_error';
    case 'validation': return 'validation_error';
    case 'aborted':    return 'aborted';
    case 'parse':      return 'validation_error';
    case 'upstream':   return 'server_error';
    default:           return 'unknown';
  }
}
