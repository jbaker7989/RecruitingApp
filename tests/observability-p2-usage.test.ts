import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLCUsage } from '../src/telemetry/usage.js';

test('S04: OpenAI totals split cache and reasoning without counting either category twice', () => {
  const normalized = extractLCUsage({
    response_metadata: {
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 15 },
      },
    },
    usage_metadata: { input_tokens: 120, output_tokens: 45 },
  });
  assert.equal(normalized.source, 'provider_reported');
  assert.deepEqual(normalized.categories, { input: 100, cache_read: 20, output: 30, reasoning: 15 });
  assert.equal(Object.values(normalized.categories).reduce((sum, n) => sum + n, 0), 165);
});

test('S04: Anthropic input and cache counters are distinct reported categories', () => {
  const normalized = extractLCUsage({
    response_metadata: {
      usage: {
        input_tokens: 80,
        output_tokens: 40,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
    },
  });
  // Anthropic reports input_tokens separately from cache reads and writes.
  // See https://docs.anthropic.com/en/docs/about-claude/pricing#long-context-pricing.
  assert.deepEqual(normalized.categories, { input: 80, output: 40, cache_read: 20, cache_write: 10 });
  assert.equal(Object.values(normalized.categories).reduce((sum, n) => sum + n, 0), 150);
});

test('S04: a missing usage object is unknown, never an invented zero-token observation', () => {
  assert.deepEqual(extractLCUsage({ content: 'synthetic' }), { categories: {}, source: 'unknown' });
});

test('S04: malformed and incomplete reported usage cannot produce a known partial bill', () => {
  for (const response of [
    { response_metadata: { usage: { prompt_tokens: 10 } } },
    { response_metadata: { usage: { prompt_tokens: 10, completion_tokens: Number.NaN } } },
    { response_metadata: { usage: { prompt_tokens: Number.POSITIVE_INFINITY, completion_tokens: 2 } } },
    { response_metadata: { usage: { prompt_tokens: 3, completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 4 } } } },
    { usage_metadata: { input_tokens: -1, output_tokens: 2 } },
  ]) {
    assert.deepEqual(extractLCUsage(response), { categories: {}, source: 'unknown' });
  }
});

test('S04: provider detail wins over LangChain summary without counting both', () => {
  const result = extractLCUsage({
    response_metadata: { usage: { prompt_tokens: 12, completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } } },
    usage_metadata: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
  });
  assert.deepEqual(result.categories, { input: 10, cache_read: 2, output: 4, reasoning: 1 });
  assert.equal(Object.values(result.categories).reduce((sum, n) => sum + n, 0), 17);
});

test('S04: LangChain standard details split input, cache writes, cache reads and reasoning exactly', () => {
  const result = extractLCUsage({ usage_metadata: {
    input_tokens: 100, output_tokens: 30, total_tokens: 130,
    input_token_details: { cache_read: 20, cache_creation: 10 },
    output_token_details: { reasoning: 5 },
  } });
  assert.equal(result.source, 'provider_reported');
  assert.deepEqual(result.categories, { input: 70, output: 25, cache_read: 20, cache_write: 10, reasoning: 5 });
  assert.equal(Object.values(result.categories).reduce((sum, n) => sum + n, 0), 130);
  assert.deepEqual(extractLCUsage({ usage_metadata: {
    input_tokens: 10, output_tokens: 2, input_token_details: { cache_read: 11 },
  } }), { categories: {}, source: 'unknown' });
});
