/**
 * LLM Service Factory
 * Routes to appropriate LLM provider based on task type
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { OpenAIEmbeddings } from '@langchain/openai';
import { z } from 'zod';

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

/**
 * Get LLM client for a task type
 */
export function getLLMClient(taskType: string = 'default'): ChatOpenAI | ChatAnthropic {
  const config = MODEL_CONFIGS[taskType] || MODEL_CONFIGS['default'];
  
  if (config.provider === 'openai') {
    return new ChatOpenAI({
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      apiKey: getApiKey('openai'),
    });
  } else {
    return new ChatAnthropic({
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens || 4096,
      apiKey: getApiKey('anthropic'),
    });
  }
}

/**
 * Get embeddings client for semantic similarity
 */
export function getEmbeddingsClient(): OpenAIEmbeddings {
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: getApiKey('openai'),
  });
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
