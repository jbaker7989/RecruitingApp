import { safeSpan } from './safeSpan.js';
/**
 * AI invocation tracing — chat and embedding operation spans (OBS-P2-S02/S03).
 *
 * One logical span per application invocation. Parse/schema validation failure
 * is distinguished from provider failure via ai.parse_outcome, satisfying
 * OBS-P2-S02-AC3. Token metrics are emitted outside the span so they accumulate
 * regardless of trace sampling (OBS-P2-S04-AC2).
 *
 * Raw prompts, completions, vector content, exception messages and stacks are
 * never recorded (OBS-P2-S02-AC4, OBS-P2-S03-AC4).
 *
 * SDK-internal retries are not observable through LangChain's public API;
 * this module counts each application-level invoke as one attempt. If LangChain
 * exposes retry hooks in a future version, they can be wired here. (OBS-P2-S02-AC2)
 */
import { SpanKind, SpanStatusCode, context, createContextKey, metrics, trace } from '@opentelemetry/api';
import { classifyError, registerSafeNames } from './privacy.js';
import { getRequestContext, markRequestValidationFailure } from './context.js';
import { recordTokenUsage, extractLCUsage, extractEmbeddingUsage } from './usage.js';
import type { ErrorCategory } from './privacy.js';

// Register at module load with static literals only (privacy.ts code-review gate).
registerSafeNames({
  spans: ['ai.chat', 'ai.chat.attempt', 'ai.embed'],
  metrics: [
    'app.ai.invocation.count', 'app.ai.invocation.duration',
    'app.ai.attempt.count', 'app.ai.attempt.duration',
    'app.ai.usage.known_count',
  ],
});

/**
 * OTel context key carrying the bounded feature label from the enclosing traceAIInvocation.
 * Set before calling the callback so factory-level invoke() wrappers can read it without
 * depending on request context or relying on caller propagation. Read via getInvocationFeature().
 */
const INVOCATION_FEATURE_KEY = createContextKey('rec-app.ai.invocation.feature');
const USAGE_STATE_KEY = createContextKey('rec-app.ai.invocation.usage');
interface UsageState { recorded: boolean }

/** Factory attempts own accounting; logical callbacks share a guard against duplicate hooks. */
export function markAttemptUsageRecorded(): void {
  const state = context.active().getValue(USAGE_STATE_KEY) as UsageState | undefined;
  if (state) state.recorded = true;
}


/**
 * Return the AI invocation feature label from the current OTel context, or undefined if none
 * has been set by an enclosing traceAIInvocation call. Factory clients use this so that
 * resume_parsing usage carries 'resume_parsing' even if getRequestContext() is unavailable.
 */
export function getInvocationFeature(): string | undefined {
  const v = context.active().getValue(INVOCATION_FEATURE_KEY);
  return typeof v === 'string' ? v : undefined;
}

const TRACER = 'rec-app';
const METER = 'rec-app';

// ── Bounded vocabulary ────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'other';
export type AIModel = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet' | 'text-embedding-3-small' | 'unknown';
export type AIOperation = 'chat' | 'embed_query' | 'embed_document' | 'embed_batch' | 'other';
export type AIParseOutcome = 'success' | 'json_failure' | 'schema_failure';
export type EmbedOperation = 'embed_query' | 'embed_document' | 'embed_batch';

const PROVIDERS = new Set<string>(['openai', 'anthropic', 'other']);
const MODELS = new Set<string>(['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'text-embedding-3-small', 'unknown']);
const OPERATIONS = new Set<string>(['chat', 'embed_query', 'embed_document', 'embed_batch', 'other']);
const TASKS = new Set<string>(['resume_parsing', 'embeddings', 'scheduling', 'conflict_resolution', 'communication', 'job_description', 'interview_questions', 'default']);

// BOUNDED feature vocabulary. Any feature not in this set is normalized to 'unknown' so
// free-text caller values cannot create unbounded metric cardinality (OBS-P2-S04-AC1).
// Add new features here (code-review gate: static literals only).
const VALID_FEATURES = new Set<string>([
  'resume_parsing', 'job_description', 'candidate_communication',
  'matching', 'scheduling', 'vectorstore',
  'application_submission', 'login', 'unknown',
]);

const safeProvider = (p: string): AIProvider => (PROVIDERS.has(p) ? (p as AIProvider) : 'other');
const safeModel = (m: string): AIModel => (MODELS.has(m) ? (m as AIModel) : 'unknown');
const safeOperation = (o: string): AIOperation => (OPERATIONS.has(o) ? (o as AIOperation) : 'other');
/** Normalizes feature to a static bounded value; rejects arbitrary caller strings. */
const safeFeature = (f: string | undefined): string => (f && VALID_FEATURES.has(f) ? f : 'unknown');
const safeTask = (t: string | undefined): string | undefined => (t && TASKS.has(t) ? t : undefined);

// Map ErrorCategory to OUTCOMES-compatible values for app.outcome metric attribute.
function toAppOutcome(cat: ErrorCategory): string {
  switch (cat) {
    case 'timeout': return 'timeout';
    case 'aborted': return 'aborted';
    case 'rate_limit': return 'rate_limited';
    case 'upstream': return 'server_error';
    case 'auth': return 'client_error';
    case 'not_found': return 'client_error';
    case 'validation': return 'validation_error';
    default: return 'other';
  }
}

function getBatchSizeBucket(size: number): string {
  if (size <= 1) return '1';
  if (size <= 10) return '2-10';
  if (size <= 50) return '11-50';
  return '51+';
}

function getInvocationMetrics() {
  const meter = metrics.getMeter(METER);
  return {
    count: meter.createCounter('app.ai.invocation.count', { description: 'AI invocations by outcome' }),
    duration: meter.createHistogram('app.ai.invocation.duration', { unit: 's', description: 'AI invocation duration' }),
  };
}

// ── Chat invocation ───────────────────────────────────────────────────────────

export interface AIInvocationOpts {
  /** Bounded feature label; falls back to request context feature, then 'unknown'. */
  feature?: string;
  /** Bounded task key (matches MODEL_CONFIGS keys, snake_case). */
  task?: string;
  provider: AIProvider;
  model: AIModel;
  operation?: AIOperation;
}

export interface AIInvocationContext {
  /**
   * Notify that the model responded successfully but output parsing failed.
   * Call before rethrowing the parse error so the span records the distinction.
   * Provider errors (network, timeout, auth) should NOT call this method.
   * (OBS-P2-S02-AC3)
   */
  markParseOutcome(outcome: AIParseOutcome): void;
  /**
   * Extract and record token usage from a LangChain response message.
   * Safe to call with any value; missing/unknown usage is tracked separately
   * rather than as zero (OBS-P2-S04-AC3).
   */
  recordUsage(response: unknown): void;
}

/**
 * Wrap one logical LLM chat invocation with a span and invocation metrics.
 *
 * The wrapped function receives an AIInvocationContext for parse-outcome marking
 * and usage extraction. The original return value and thrown exceptions are
 * preserved exactly; the application call path is unchanged.
 */
export async function traceAIInvocation<T>(
  opts: AIInvocationOpts,
  fn: (ctx: AIInvocationContext) => Promise<T>,
): Promise<T> {
  const feature = safeFeature(opts.feature ?? getRequestContext()?.feature);
  const provider = safeProvider(opts.provider);
  const model = safeModel(opts.model);
  const operation = safeOperation(opts.operation ?? 'chat');
  const task = safeTask(opts.task);

  const spanAttrs: Record<string, string> = {
    'ai.provider': provider,
    'ai.model': model,
    'ai.operation': operation,
    'app.feature': feature,
  };
  if (task) spanAttrs['ai.task'] = task;

  const span = safeSpan(TRACER, 'ai.chat', {
    kind: SpanKind.INTERNAL,
    attributes: spanAttrs,
  });

  const start = process.hrtime.bigint();
  let outcome = 'success';
  let parseOutcome: AIParseOutcome = 'success';
  let parseOutcomeSet = false;

  const usageState: UsageState = { recorded: false };
  const ctx: AIInvocationContext = {
    markParseOutcome(o: AIParseOutcome) {
      parseOutcome = o;
      parseOutcomeSet = true;
    },
    recordUsage(response: unknown) {
      if (usageState.recorded) return; // guard: only one usage recording per logical invocation
      usageState.recorded = true;
      try {
        const usage = extractLCUsage(response);
        recordTokenUsage({ feature, provider, model, ...(task ? { task } : {}) }, usage);
      } catch { /* usage recording never affects the application flow */ }
    },
  };

  // Propagate bounded feature into OTel context so factory clients (InstrumentedChatXxx)
  // can read it without requiring request context to be set. Avoids mutating any shared state.
  const ctxWithFeature = context.active().setValue(INVOCATION_FEATURE_KEY, feature).setValue(USAGE_STATE_KEY, usageState);
  try {
    const result = await context.with(trace.setSpan(ctxWithFeature, span), () => fn(ctx));
    span.setAttribute('ai.parse_outcome', 'success');
    span.setAttribute('app.outcome', 'success');
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    if (parseOutcomeSet) {
      markRequestValidationFailure();
      // Model succeeded; the error is a parse/schema failure in our application code.
      span.setAttribute('ai.parse_outcome', parseOutcome);
      // Classify based on parse stage: json → parse category, schema → validation.
      // Cast required: TS narrows the closure-mutated `parseOutcome` to 'success'
      // (the initial assignment) even though markParseOutcome sets it otherwise.
      const errCat: ErrorCategory = (parseOutcome as string) === 'json_failure' ? 'parse' : 'validation';
      outcome = toAppOutcome(errCat);
      span.setAttribute('error.type', errCat);
    } else {
      // Provider-level failure (network, timeout, auth, etc.).
      span.setAttribute('ai.parse_outcome', 'success');
      const errCat = classifyError(err);
      outcome = toAppOutcome(errCat);
      span.setAttribute('error.type', errCat);
      // No provider response: record unknown so the usage coverage denominator stays accurate.
      // Guard: only when no factory client already recorded usage (parse failures have known usage).
      if (!usageState.recorded) {
        try { recordTokenUsage({ feature, provider, model, ...(task ? { task } : {}) }, { categories: {}, source: 'unknown' }); } catch { /**/ }
      }
    }
    span.setAttribute('app.outcome', outcome);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    span.end();
    const metricAttrs = {
      'ai.provider': provider,
      'ai.model': model,
      'ai.operation': operation,
      'app.feature': feature,
      'app.outcome': outcome,
    };
    try {
      const i = getInvocationMetrics();
      i.count.add(1, metricAttrs);
      i.duration.record(seconds, metricAttrs);
    } catch { /* metrics never affect the application flow */ }
  }
}

// ── Embedding invocation ──────────────────────────────────────────────────────

export interface EmbeddingOpts {
  operation: EmbedOperation;
  model?: string;
  feature?: string;
  batchSize?: number;
}

/**
 * Wrap one embedding operation with a span and invocation metrics.
 *
 * Usage is always 'unknown' for LangChain OpenAIEmbeddings (OBS-P2-S03-AC2):
 * the unknown-usage counter increments but the span duration is still recorded.
 * Text/vector content is never added to attributes (OBS-P2-S03-AC4).
 */
export async function traceEmbedding<T>(opts: EmbeddingOpts, fn: () => Promise<T>): Promise<T> {
  const feature = safeFeature(opts.feature ?? getRequestContext()?.feature);
  const model = safeModel(opts.model ?? 'text-embedding-3-small');
  const operation = safeOperation(opts.operation);
  const batchSizeBucket = getBatchSizeBucket(opts.batchSize ?? 1);

  const span = safeSpan(TRACER, 'ai.embed', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'ai.provider': 'openai' as AIProvider,
      'ai.model': model,
      'ai.operation': operation,
      'app.feature': feature,
      'ai.batch_size_bucket': batchSizeBucket,
    },
  });

  const start = process.hrtime.bigint();
  let outcome = 'success';

  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    span.setAttribute('app.outcome', 'success');
    span.setStatus({ code: SpanStatusCode.OK });
    // Embedding usage not exposed by LangChain; record unknown counter (OBS-P2-S03-AC2)
    try { recordTokenUsage({ feature, provider: 'openai', model }, extractEmbeddingUsage(null)); } catch { /**/ }
    return result;
  } catch (err) {
    try { recordTokenUsage({ feature, provider: 'openai', model }, extractEmbeddingUsage(null)); } catch { /* fail-open */ }
    const errCat = classifyError(err);
    outcome = toAppOutcome(errCat);
    span.setAttribute('error.type', errCat);
    span.setAttribute('app.outcome', outcome);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    span.end();
    try {
      const i = getInvocationMetrics();
      const mAttrs = { 'ai.provider': 'openai', 'ai.model': model, 'ai.operation': operation, 'app.feature': feature, 'app.outcome': outcome };
      i.count.add(1, mAttrs);
      i.duration.record(seconds, mAttrs);
    } catch { /* metrics never affect the application flow */ }
  }
}
