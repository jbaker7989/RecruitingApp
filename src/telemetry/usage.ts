/**
 * AI token usage normalization and metrics (OBS-P2-S04).
 *
 * Extracts usage from LangChain AIMessage response_metadata in a provider-aware
 * way: OpenAI net-input/cache-read/reasoning decomposition, Anthropic cache-read/
 * cache-write decomposition. Falls back to LangChain usage_metadata for minimal
 * input/output counts. Missing usage is marked 'unknown' rather than coerced to
 * zero (OBS-P2-S04-AC3).
 *
 * Token counters use the official metrics API and are recorded outside any span
 * sampling decision, so they accumulate even for unsampled traces (OBS-P2-S04-AC2).
 *
 * Current limitation: LangChain OpenAIEmbeddings does not expose token usage from
 * the Embeddings API response; embedding usage is always 'unknown' until the SDK
 * provides it or a direct API wrapper is added (OBS-P2-S03-AC2).
 */
import { metrics } from '@opentelemetry/api';

// ── Bounded vocabulary (must match ai.ts — defined independently to avoid circular imports) ──

const USAGE_PROVIDERS = new Set(['openai', 'anthropic', 'other']);
const USAGE_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'text-embedding-3-small', 'unknown']);
const USAGE_FEATURES = new Set([
  'resume_parsing', 'job_description', 'candidate_communication',
  'matching', 'scheduling', 'vectorstore',
  'application_submission', 'login', 'unknown',
]);

const normalizeProvider = (p: string): string => USAGE_PROVIDERS.has(p) ? p : 'other';
const normalizeModel = (m: string): string => USAGE_MODELS.has(m) ? m : 'unknown';
const normalizeFeature = (f: string): string => USAGE_FEATURES.has(f) ? f : 'unknown';

/**
 * Validate that a value is a finite non-negative integer token count.
 * Returns undefined for NaN, Infinity, negative, non-integer, or non-number values.
 * Missing fields must not be inferred as zero — return undefined so callers can represent
 * partial/unknown rather than silently coercing absent data. (OBS-P2-S04-AC3)
 */
function safeCount(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  if (!Number.isInteger(v)) return undefined;
  if (v < 0) return undefined;
  return v;
}

// ── Raw provider shapes (best-effort; access is guarded) ─────────────────────

// OpenAI API-level usage nested in response_metadata.usage
interface OAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

// LangChain ChatOpenAI puts summarised counts here
interface OAITokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

// Anthropic usage from response_metadata.usage
interface ANTHUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// LangChain standard usage_metadata (all providers)
interface LCUsageMeta {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
  output_token_details?: { reasoning?: number };
}

// ── Public types ─────────────────────────────────────────────────────────────

export type AITokenCategory = 'input' | 'output' | 'cache_read' | 'cache_write' | 'reasoning';

export interface NormalizedTokenUsage {
  /** Token counts by category. Only categories with non-zero counts are present. */
  categories: Partial<Record<AITokenCategory, number>>;
  /**
   * Whether usage came from the provider response. 'unknown' when the SDK does not
   * expose it (e.g. LangChain OpenAIEmbeddings, streaming paths, missing fields).
   */
  source: 'provider_reported' | 'unknown';
}

export interface TokenUsageAttrs {
  feature: string;
  provider: string;
  model: string;
  task?: string;
}

// ── Extraction ────────────────────────────────────────────────────────────────

const UNKNOWN: NormalizedTokenUsage = { categories: {}, source: 'unknown' };

/** Distinguish "field absent" from "field present-but-invalid". */
type FieldStatus = 'absent' | 'valid' | 'invalid';
function fieldStatus(v: unknown): FieldStatus {
  if (v === undefined || v === null) return 'absent';
  return safeCount(v) !== undefined ? 'valid' : 'invalid';
}

/**
 * Extract normalized token usage from a LangChain response message.
 * Prefers response_metadata (provider-level detail) over usage_metadata (summary).
 * Never throws; returns source:'unknown' on any missing or malformed data.
 *
 * Policy (OBS-P2-S04-AC3): required fields (both of the primary pair) must be
 * present and valid; if either is absent or invalid the result is 'unknown'.
 * Optional sub-fields (cached_tokens, reasoning_tokens) default to 0 when absent,
 * but return 'unknown' if present-and-invalid. Internal consistency (cached ≤ prompt)
 * is also enforced; impossible values indicate corrupt data.
 */
export function extractLCUsage(message: unknown): NormalizedTokenUsage {
  if (!message || typeof message !== 'object') return UNKNOWN;
  const m = message as Record<string, unknown>;
  const rmeta = typeof m['response_metadata'] === 'object' && m['response_metadata'] !== null
    ? (m['response_metadata'] as Record<string, unknown>) : null;

  if (rmeta) {
    // ── OpenAI detailed usage (preferred; includes cache and reasoning) ──────
    const oaiUsage = rmeta['usage'] as OAIUsage | undefined;
    const hasPt = oaiUsage != null && oaiUsage.prompt_tokens !== undefined;
    const hasCt = oaiUsage != null && oaiUsage.completion_tokens !== undefined;
    if (hasPt || hasCt) {
      // Require both to be present and valid (absent or invalid → unknown).
      const ptStatus = fieldStatus(oaiUsage!.prompt_tokens);
      const ctStatus = fieldStatus(oaiUsage!.completion_tokens);
      if (ptStatus !== 'valid' || ctStatus !== 'valid') return UNKNOWN;
      const promptTokens = safeCount(oaiUsage!.prompt_tokens)!;
      const completionTokens = safeCount(oaiUsage!.completion_tokens)!;
      // Optional sub-fields: absent → 0, present-but-invalid → unknown.
      const cachedRaw = oaiUsage!.prompt_tokens_details?.cached_tokens;
      const reasoningRaw = oaiUsage!.completion_tokens_details?.reasoning_tokens;
      if (cachedRaw !== undefined && fieldStatus(cachedRaw) === 'invalid') return UNKNOWN;
      if (reasoningRaw !== undefined && fieldStatus(reasoningRaw) === 'invalid') return UNKNOWN;
      const cached = safeCount(cachedRaw) ?? 0;
      const reasoning = safeCount(reasoningRaw) ?? 0;
      // Consistency: cached cannot exceed total prompt tokens (physically impossible).
      if (cached > promptTokens) return UNKNOWN;
      const netInput = promptTokens - cached;
      const netOutput = completionTokens - reasoning;
      const categories: Partial<Record<AITokenCategory, number>> = {};
      if (netInput > 0) categories.input = netInput;
      if (cached > 0) categories.cache_read = cached;
      if (netOutput > 0) categories.output = netOutput;
      if (reasoning > 0) categories.reasoning = reasoning;
      return { categories, source: 'provider_reported' };
    }

    // ── LangChain ChatOpenAI summarised tokenUsage ────────────────────────────
    const tu = rmeta['tokenUsage'] as OAITokenUsage | undefined;
    const hasPtk = tu != null && tu.promptTokens !== undefined;
    const hasCtk = tu != null && tu.completionTokens !== undefined;
    if (hasPtk || hasCtk) {
      const ptkStatus = fieldStatus(tu!.promptTokens);
      const ctkStatus = fieldStatus(tu!.completionTokens);
      if (ptkStatus !== 'valid' || ctkStatus !== 'valid') return UNKNOWN;
      const inp = safeCount(tu!.promptTokens)!;
      const out = safeCount(tu!.completionTokens)!;
      const categories: Partial<Record<AITokenCategory, number>> = {};
      if (inp > 0) categories.input = inp;
      if (out > 0) categories.output = out;
      return { categories, source: 'provider_reported' };
    }

    // ── Anthropic usage ───────────────────────────────────────────────────────
    // Anthropic's input_tokens is the net non-cached count. cache_read_input_tokens and
    // cache_creation_input_tokens are ADDITIONAL categories, not subsets of input_tokens.
    // Do NOT subtract them from input_tokens. (Anthropic pricing docs.)
    const anthUsage = rmeta['usage'] as ANTHUsage | undefined;
    const hasAi = anthUsage != null && anthUsage.input_tokens !== undefined;
    const hasAo = anthUsage != null && anthUsage.output_tokens !== undefined;
    if (hasAi || hasAo) {
      const aiStatus = fieldStatus(anthUsage!.input_tokens);
      const aoStatus = fieldStatus(anthUsage!.output_tokens);
      if (aiStatus !== 'valid' || aoStatus !== 'valid') return UNKNOWN;
      const inp = safeCount(anthUsage!.input_tokens)!;
      const out = safeCount(anthUsage!.output_tokens)!;
      const crRaw = anthUsage!.cache_read_input_tokens;
      const cwRaw = anthUsage!.cache_creation_input_tokens;
      if (crRaw !== undefined && fieldStatus(crRaw) === 'invalid') return UNKNOWN;
      if (cwRaw !== undefined && fieldStatus(cwRaw) === 'invalid') return UNKNOWN;
      const cacheRead = safeCount(crRaw) ?? 0;
      const cacheWrite = safeCount(cwRaw) ?? 0;
      const categories: Partial<Record<AITokenCategory, number>> = {};
      if (inp > 0) categories.input = inp;
      if (out > 0) categories.output = out;
      if (cacheRead > 0) categories.cache_read = cacheRead;
      if (cacheWrite > 0) categories.cache_write = cacheWrite;
      return { categories, source: 'provider_reported' };
    }
  }

  // ── LangChain standard usage_metadata fallback ────────────────────────────
  const um = m['usage_metadata'] as LCUsageMeta | undefined;
  const hasUi = um != null && um.input_tokens !== undefined;
  const hasUo = um != null && um.output_tokens !== undefined;
  if (hasUi || hasUo) {
    const uiStatus = fieldStatus(um!.input_tokens);
    const uoStatus = fieldStatus(um!.output_tokens);
    if (uiStatus !== 'valid' || uoStatus !== 'valid') return UNKNOWN;
    const inp = safeCount(um!.input_tokens)!;
    const out = safeCount(um!.output_tokens)!;
    const categories: Partial<Record<AITokenCategory, number>> = {};
    // LangChain standard totals include their detail categories; split them once.
    const details = [um!.input_token_details?.cache_read ?? 0,
      um!.input_token_details?.cache_creation ?? 0, um!.output_token_details?.reasoning ?? 0];
    if (details.some(value => safeCount(value) === undefined)) return UNKNOWN;
    const [cached, created, reasoning] = details;
    if (cached + created > inp || reasoning > out) return UNKNOWN;
    if (inp - cached - created > 0) categories.input = inp - cached - created;
    if (out - reasoning > 0) categories.output = out - reasoning;
    if (cached > 0) categories.cache_read = cached;
    if (created > 0) categories.cache_write = created;
    if (reasoning > 0) categories.reasoning = reasoning;
    return { categories, source: 'provider_reported' };
  }

  return UNKNOWN;
}

/**
 * Embedding usage from LangChain OpenAIEmbeddings.
 * The LangChain client does not currently expose usage from the Embeddings API
 * response; this always returns source:'unknown'. Callers that want exact counts
 * must use the direct OpenAI client or a future SDK version that exposes it.
 * (OBS-P2-S03-AC2)
 */
export function extractEmbeddingUsage(_response: unknown): NormalizedTokenUsage {
  return { categories: {}, source: 'unknown' };
}

// ── Metric recording ──────────────────────────────────────────────────────────

const METER_NAME = 'rec-app';
const TASKS = new Set(['resume_parsing', 'embeddings', 'scheduling', 'conflict_resolution', 'communication', 'job_description', 'interview_questions', 'default']);

/**
 * Record token counters for a normalized usage result.
 * Tokens are broken out by category; unknown usage increments a separate coverage
 * counter rather than appearing as zero (OBS-P2-S04-AC3).
 * Safe to call with no active SDK — metrics API is always a no-op when disabled.
 */
export function recordTokenUsage(attrs: TokenUsageAttrs, usage: NormalizedTokenUsage): void {
  try {
    const meter = metrics.getMeter(METER_NAME);
    // Normalize attrs to bounded vocabulary at the recording boundary so callers that pass
    // arbitrary strings cannot create unbounded metric cardinality. (OBS-P2-S04-AC1)
    const base: Record<string, string> = {
      'app.feature': normalizeFeature(attrs.feature),
      'ai.provider': normalizeProvider(attrs.provider),
      'ai.model': normalizeModel(attrs.model),
    };
    if (attrs.task && TASKS.has(attrs.task)) base['ai.task'] = attrs.task;

    if (usage.source === 'unknown') {
      meter.createCounter('app.ai.usage.unknown_count', {
        description: 'AI invocations where provider did not report usage',
      }).add(1, { ...base, 'ai.usage_source': 'unknown' });
      return;
    }

    // Known usage: increment known-call coverage counter then record per-category tokens.
    // The known_count counter enables computing a coverage fraction = known / (known + unknown).
    meter.createCounter('app.ai.usage.known_count', {
      description: 'AI invocations with provider-reported usage',
    }).add(1, { ...base, 'ai.usage_source': 'provider_reported' });

    const counter = meter.createCounter('app.ai.tokens', {
      description: 'AI tokens by provider-reported category',
    });
    for (const [category, count] of Object.entries(usage.categories)) {
      const c = safeCount(count);
      if (c !== undefined && c > 0) {
        counter.add(c, {
          ...base,
          'ai.token_category': category,
          'ai.usage_source': 'provider_reported',
        });
      }
    }
  } catch { /* metrics never affect the application flow */ }
}
