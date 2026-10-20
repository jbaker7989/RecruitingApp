import { markAttemptUsageRecorded } from '../../telemetry/ai.js';
import { safeSpan } from '../../telemetry/safeSpan.js';
/**
 * LLM Service Factory
 * Routes to appropriate LLM provider based on task type
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { OpenAIEmbeddings } from '@langchain/openai';
import { traceEmbedding, getInvocationFeature } from '../../telemetry/ai.js';
import type { AIProvider, AIModel } from '../../telemetry/ai.js';
import { getRequestContext } from '../../telemetry/context.js';
import { SpanKind, SpanStatusCode, context, metrics, trace } from '@opentelemetry/api';
import { classifyError } from '../../telemetry/privacy.js';
import { extractLCUsage, recordTokenUsage } from '../../telemetry/usage.js';

export type LLMProvider = 'openai' | 'anthropic';
export type LLMModel = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet';

interface LLMConfig {
  provider: LLMProvider;
  model: LLMModel;
  temperature?: number;
  maxTokens?: number;
}

// Model configurations by task type
const MODEL_CONFIGS: Record<string, LLMConfig> = {
  // Resume parsing - needs structured output
  'resume-parsing': { provider: 'openai', model: 'gpt-4o', temperature: 0.1 },
  
  // Semantic embeddings
  'embeddings': { provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
  
  // Interview scheduling logic - needs reasoning
  'scheduling': { provider: 'anthropic', model: 'claude-3-5-sonnet', temperature: 0.3 },
  
  // Conflict resolution - needs reasoning
  'conflict-resolution': { provider: 'anthropic', model: 'claude-3-5-sonnet', temperature: 0.4 },
  
  // Candidate communication - needs natural language
  'communication': { provider: 'anthropic', model: 'claude-3-5-sonnet', temperature: 0.7 },
  
  // Job description generation - creative
  'job-description': { provider: 'openai', model: 'gpt-4o', temperature: 0.8 },
  
  // Interview questions - good enough, fast
  'interview-questions': { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.5 },
  
  // Default
  'default': { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
};

// Environment variable checks
function getApiKey(provider: LLMProvider): string {
  switch (provider) {
    case 'openai':
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set in environment');
      return openaiKey;
    case 'anthropic':
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set in environment');
      return anthropicKey;
  }
}

// Shared span/metric logic for instrumented LLM clients. Records a provider-attempt span
// (ai.chat.attempt) and attempt metrics for each invoke() call. Distinct from the logical
// operation span (ai.chat) owned by traceAIInvocation. (OBS-P2-S02)
const TRACER = 'rec-app';
const METER = 'rec-app';
const TASK_TO_SANITIZE = /[^a-z0-9_.]/g;
const TASKS = new Set<string>(['resume_parsing', 'embeddings', 'scheduling', 'conflict_resolution', 'communication', 'job_description', 'interview_questions', 'default']);

const VALID_FEATURES = new Set([
  'resume_parsing', 'job_description', 'candidate_communication',
  'matching', 'scheduling', 'vectorstore',
  'application_submission', 'login', 'unknown',
]);

function sanitizeTask(raw: string): string {
  const sanitized = raw.replace(/-/g, '_').replace(TASK_TO_SANITIZE, '');
  return TASKS.has(sanitized) ? sanitized : '';
}

// Map ErrorCategory to OUTCOMES-compatible app.outcome value
function mapErrToOutcome(err: unknown): string {
  const cat = classifyError(err);
  const m: Record<string, string> = {
    timeout: 'timeout', aborted: 'aborted', rate_limit: 'rate_limited',
    upstream: 'server_error', auth: 'client_error', not_found: 'client_error',
    validation: 'validation_error',
  };
  return m[cat] ?? 'other';
}

function getFeatureForAttempt(): string {
  // Priority: feature propagated by enclosing traceAIInvocation → request context → 'unknown'
  const fromInvocation = getInvocationFeature();
  if (fromInvocation) return fromInvocation;
  const f = getRequestContext()?.feature;
  return f && VALID_FEATURES.has(f) ? f : 'unknown';
}

function wrapInvokeWithTelemetry(
  invoker: (input: unknown, options?: unknown) => Promise<unknown>,
  providerKey: AIProvider,
  modelKey: AIModel,
  taskKey: string,
): (input: unknown, options?: unknown) => Promise<unknown> {
  return async (input: unknown, options?: unknown) => {
    const feat = getFeatureForAttempt();
    const spanAttrs: Record<string, string | number> = {
      'app.attempt': 1,
      'ai.provider': providerKey, 'ai.model': modelKey,
      'ai.operation': 'chat', 'app.feature': feat,
    };
    if (taskKey) spanAttrs['ai.task'] = taskKey;

    // Provider-attempt span: distinguishable from the outer logical ai.chat span.
    const span = safeSpan(TRACER, 'ai.chat.attempt', { kind: SpanKind.INTERNAL, attributes: spanAttrs });
    const start = process.hrtime.bigint();
    let outcome = 'success';
    try {
      const response = await context.with(trace.setSpan(context.active(), span), () => invoker(input, options));
      span.setAttribute('app.outcome', 'success');
      span.setStatus({ code: SpanStatusCode.OK });
      markAttemptUsageRecorded();
      try { recordTokenUsage({ feature: feat, provider: providerKey, model: modelKey, ...(taskKey ? { task: taskKey } : {}) }, extractLCUsage(response)); } catch { /**/ }
      return response;
    } catch (err) {
      markAttemptUsageRecorded();
      recordTokenUsage({ feature: feat, provider: providerKey, model: modelKey, task: taskKey }, extractLCUsage(err));
      const errCat = classifyError(err);
      outcome = mapErrToOutcome(err);
      span.setAttribute('error.type', errCat);
      span.setAttribute('app.outcome', outcome);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      span.end();
      // Attempt-level metrics (distinct from logical invocation metrics in traceAIInvocation)
      try {
        const meter = metrics.getMeter(METER);
        const mAttrs = { 'ai.provider': providerKey, 'ai.model': modelKey, 'ai.operation': 'chat', 'app.feature': feat, 'app.outcome': outcome };
        meter.createCounter('app.ai.attempt.count', { description: 'Provider-level AI attempt count' }).add(1, mAttrs);
        meter.createHistogram('app.ai.attempt.duration', { unit: 's', description: 'Provider-level AI attempt duration' }).record(seconds, mAttrs);
      } catch { /**/ }
    }
  };
}

/**
 * Instrumented ChatOpenAI subclass. Wraps invoke() with an OTel span and token
 * metrics. All callers receive the identical ChatOpenAI interface; the prototype
 * patch in tests (ChatOpenAI.prototype.invoke) intercepts super.invoke() correctly.
 */
class InstrumentedChatOpenAI extends ChatOpenAI {
  private readonly _tracedInvoke: (input: unknown, options?: unknown) => Promise<unknown>;
  constructor(
    params: ConstructorParameters<typeof ChatOpenAI>[0],
    private readonly _aiOpts: { provider: AIProvider; model: AIModel; task: string },
  ) {
    super(params);
    this._tracedInvoke = wrapInvokeWithTelemetry(
      (i, o) => super.invoke(i as Parameters<ChatOpenAI['invoke']>[0], o as Parameters<ChatOpenAI['invoke']>[1]),
      _aiOpts.provider, _aiOpts.model, _aiOpts.task,
    );
  }
  override async invoke(
    input: Parameters<ChatOpenAI['invoke']>[0],
    options?: Parameters<ChatOpenAI['invoke']>[1],
  ): ReturnType<ChatOpenAI['invoke']> {
    return this._tracedInvoke(input, options) as ReturnType<ChatOpenAI['invoke']>;
  }
}

/**
 * Instrumented ChatAnthropic subclass. Same instrumentation contract as
 * InstrumentedChatOpenAI.
 */
class InstrumentedChatAnthropic extends ChatAnthropic {
  private readonly _tracedInvoke: (input: unknown, options?: unknown) => Promise<unknown>;
  constructor(
    params: ConstructorParameters<typeof ChatAnthropic>[0],
    private readonly _aiOpts: { provider: AIProvider; model: AIModel; task: string },
  ) {
    super(params);
    this._tracedInvoke = wrapInvokeWithTelemetry(
      (i, o) => super.invoke(i as Parameters<ChatAnthropic['invoke']>[0], o as Parameters<ChatAnthropic['invoke']>[1]),
      _aiOpts.provider, _aiOpts.model, _aiOpts.task,
    );
  }
  override async invoke(
    input: Parameters<ChatAnthropic['invoke']>[0],
    options?: Parameters<ChatAnthropic['invoke']>[1],
  ): ReturnType<ChatAnthropic['invoke']> {
    return this._tracedInvoke(input, options) as ReturnType<ChatAnthropic['invoke']>;
  }
}

/**
 * Get LLM client for a task type.
 * Returns an instrumented subclass that wraps invoke() with an OTel span and token
 * usage metrics; the interface is identical to the bare client. (OBS-P2-S02)
 */
export function getLLMClient(taskType: string = 'default'): ChatOpenAI | ChatAnthropic {
  const config = MODEL_CONFIGS[taskType] || MODEL_CONFIGS['default'];
  const task = sanitizeTask(taskType);

  if (config.provider === 'openai') {
    return new InstrumentedChatOpenAI(
      { model: config.model, temperature: config.temperature, maxTokens: config.maxTokens, apiKey: getApiKey('openai') },
      { provider: 'openai', model: config.model as AIModel, task },
    );
  } else {
    return new InstrumentedChatAnthropic(
      { model: config.model, temperature: config.temperature, maxTokens: config.maxTokens || 4096, apiKey: getApiKey('anthropic') },
      { provider: 'anthropic', model: config.model as AIModel, task },
    );
  }
}

/**
 * Get embeddings client for semantic similarity.
 * Returns an InstrumentedEmbeddings instance that wraps embedQuery/embedDocuments
 * with OTel spans so all callers (including vectorStore/index.ts) are covered
 * without requiring changes at each call site. (OBS-P2-S03)
 */
export function getEmbeddingsClient(): OpenAIEmbeddings {
  return new InstrumentedEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: getApiKey('openai'),
  });
}

/**
 * OpenAIEmbeddings subclass that instruments each embedding call with an OTel span.
 * All callers receive the identical interface; instrumentation is transparent.
 */
class InstrumentedEmbeddings extends OpenAIEmbeddings {
  override async embedQuery(text: string): Promise<number[]> {
    const feature = getRequestContext()?.feature;
    return traceEmbedding(
      { operation: 'embed_query', model: 'text-embedding-3-small', feature, batchSize: 1 },
      () => super.embedQuery(text),
    );
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    const feature = getRequestContext()?.feature;
    return traceEmbedding(
      { operation: 'embed_batch', model: 'text-embedding-3-small', feature, batchSize: texts.length },
      () => super.embedDocuments(texts),
    );
  }
}

/**
 * Get configuration for a task type
 */
export function getLLMConfig(taskType: string): LLMConfig {
  return MODEL_CONFIGS[taskType] || MODEL_CONFIGS['default'];
}

/**
 * Check if required API keys are available
 */
export function validateApiKeys(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  
  return { valid: missing.length === 0, missing };
}

export { MODEL_CONFIGS };
