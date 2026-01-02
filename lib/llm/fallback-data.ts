/**
 * Legacy Fallback Data
 *
 * This file contains hardcoded fallback data for LLM providers.
 * These constants are used ONLY when:
 * 1. No plugin is registered for the provider
 * 2. The plugin doesn't provide the required configuration
 *
 * IMPORTANT: This data is deprecated and should not be extended.
 * New providers should register via the plugin system and provide
 * their own configuration through the provider registry.
 *
 * Plugins are the authoritative source for:
 * - Model pricing (via getModelInfo())
 * - Cheap model recommendations (via cheapModels config)
 * - Message format support (via messageFormat config)
 *
 * @module llm/fallback-data
 * @deprecated Plugins should be the primary source of provider configuration
 */

import { Provider } from '@/lib/schemas/types'

// ============================================================================
// CHEAP MODEL FALLBACKS
// ============================================================================

/**
 * Mapping of providers to their cheapest models
 * Updated for November 2025 model lineup
 *
 * @deprecated Use getCheapModelConfig() from provider-registry instead
 */
export const LEGACY_CHEAPEST_MODEL_MAP: Record<Provider, string> = {
  ANTHROPIC: 'claude-haiku-4-5-20251001',
  OPENAI: 'gpt-4o-mini',
  GOOGLE: 'gemini-2.0-flash',
  GROK: 'grok-2-mini',
  OPENROUTER: 'openai/gpt-4o-mini',
  OLLAMA: 'llama3.2:3b',
  OPENAI_COMPATIBLE: 'gpt-4o-mini',
}

/**
 * Models that are known to work well for cheap LLM tasks
 * (memory extraction, summarization, titling)
 *
 * @deprecated Use getCheapModelConfig() from provider-registry instead
 */
export const LEGACY_RECOMMENDED_CHEAP_MODELS: Record<Provider, string[]> = {
  ANTHROPIC: ['claude-haiku-4-5-20251001', 'claude-3-haiku-20240307'],
  OPENAI: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  GOOGLE: ['gemini-2.0-flash', 'gemini-1.5-flash'],
  GROK: ['grok-2-mini'],
  OPENROUTER: [
    'openai/gpt-4o-mini',
    'anthropic/claude-3-haiku',
    'google/gemini-2.0-flash',
    'mistralai/mistral-7b-instruct',
  ],
  OLLAMA: [
    'llama3.2:3b',
    'llama3.2:1b',
    'phi3:mini',
    'mistral:7b',
    'gemma2:2b',
  ],
  OPENAI_COMPATIBLE: ['gpt-4o-mini', 'gpt-3.5-turbo'],
}

// ============================================================================
// MESSAGE FORMAT FALLBACKS
// ============================================================================

/**
 * Provider capabilities for name field support
 */
export interface LegacyProviderNameSupport {
  /** Whether the provider supports a name field on messages */
  supportsNameField: boolean
  /** Which roles support the name field */
  supportedRoles: ('user' | 'assistant')[]
  /** Maximum length for name field (if limited) */
  maxNameLength?: number
}

/**
 * Provider-specific name field support information
 * Based on API documentation as of late 2024/early 2025
 *
 * @deprecated Use getMessageFormat() from provider-registry instead
 */
export const LEGACY_PROVIDER_NAME_SUPPORT: Record<string, LegacyProviderNameSupport> = {
  // OpenAI supports name field on both user and assistant messages
  OPENAI: {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
  // Anthropic does NOT support name field in the standard API
  // We'll use content prefix fallback
  ANTHROPIC: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // Google/Gemini does NOT support name field
  // We'll use content prefix fallback
  GOOGLE: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // OpenRouter passes through to underlying provider, assume no name support for safety
  OPENROUTER: {
    supportsNameField: false,
    supportedRoles: [],
  },
  // xAI/Grok uses OpenAI-compatible format
  GROK: {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
  // Ollama uses OpenAI-compatible format but name support varies by model
  OLLAMA: {
    supportsNameField: false, // Conservative default
    supportedRoles: [],
  },
  // OpenAI Compatible providers - assume OpenAI behavior
  'OPENAI-COMPATIBLE': {
    supportsNameField: true,
    supportedRoles: ['user', 'assistant'],
    maxNameLength: 64,
  },
}

// ============================================================================
// PRICING FALLBACKS
// ============================================================================

/**
 * Pricing information for a model (costs per 1M tokens)
 */
export interface LegacyModelPricing {
  /** Model identifier */
  modelId: string
  /** Provider */
  provider: Provider
  /** Display name */
  name: string
  /** Cost per 1M input/prompt tokens (in USD) */
  promptCostPer1M: number
  /** Cost per 1M output/completion tokens (in USD) */
  completionCostPer1M: number
  /** Context window size */
  contextLength: number | null
  /** Whether this model supports vision/images */
  supportsVision?: boolean
  /** Whether this model supports tool/function calling */
  supportsTools?: boolean
  /** When this pricing data was fetched */
  fetchedAt: string
}

/**
 * Default/fallback pricing data for providers that don't expose pricing via API
 * Prices are per 1M tokens in USD (as of November 2025)
 *
 * @deprecated Use getModelPricing() from provider-registry instead
 */
export const LEGACY_FALLBACK_PRICING: Record<Provider, LegacyModelPricing[]> = {
  ANTHROPIC: [
    // Claude 4.5 models
    {
      modelId: 'claude-sonnet-4-5-20250929',
      provider: 'ANTHROPIC',
      name: 'Claude 4.5 Sonnet',
      promptCostPer1M: 3.0,
      completionCostPer1M: 15.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-haiku-4-5-20251001',
      provider: 'ANTHROPIC',
      name: 'Claude 4.5 Haiku',
      promptCostPer1M: 0.80,
      completionCostPer1M: 4.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Claude 4 models
    {
      modelId: 'claude-opus-4-1-20250805',
      provider: 'ANTHROPIC',
      name: 'Claude 4.1 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-sonnet-4-20250514',
      provider: 'ANTHROPIC',
      name: 'Claude 4 Sonnet',
      promptCostPer1M: 3.0,
      completionCostPer1M: 15.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-opus-4-20250514',
      provider: 'ANTHROPIC',
      name: 'Claude 4 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Claude 3 legacy
    {
      modelId: 'claude-3-opus-20240229',
      provider: 'ANTHROPIC',
      name: 'Claude 3 Opus',
      promptCostPer1M: 15.0,
      completionCostPer1M: 75.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'claude-3-haiku-20240307',
      provider: 'ANTHROPIC',
      name: 'Claude 3 Haiku',
      promptCostPer1M: 0.25,
      completionCostPer1M: 1.25,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  OPENAI: [
    // GPT-4o models
    {
      modelId: 'gpt-4o',
      provider: 'OPENAI',
      name: 'GPT-4o',
      promptCostPer1M: 2.50,
      completionCostPer1M: 10.0,
      contextLength: 128000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gpt-4o-mini',
      provider: 'OPENAI',
      name: 'GPT-4o Mini',
      promptCostPer1M: 0.15,
      completionCostPer1M: 0.60,
      contextLength: 128000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // o1 reasoning models
    {
      modelId: 'o1',
      provider: 'OPENAI',
      name: 'o1',
      promptCostPer1M: 15.0,
      completionCostPer1M: 60.0,
      contextLength: 200000,
      supportsVision: true,
      supportsTools: false,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'o1-mini',
      provider: 'OPENAI',
      name: 'o1-mini',
      promptCostPer1M: 3.0,
      completionCostPer1M: 12.0,
      contextLength: 128000,
      supportsVision: false,
      supportsTools: false,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // GPT-3.5 (legacy but cheap)
    {
      modelId: 'gpt-3.5-turbo',
      provider: 'OPENAI',
      name: 'GPT-3.5 Turbo',
      promptCostPer1M: 0.50,
      completionCostPer1M: 1.50,
      contextLength: 16385,
      supportsVision: false,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  GOOGLE: [
    // Gemini 2.0 models
    {
      modelId: 'gemini-2.0-flash',
      provider: 'GOOGLE',
      name: 'Gemini 2.0 Flash',
      promptCostPer1M: 0.075,
      completionCostPer1M: 0.30,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gemini-2.0-pro',
      provider: 'GOOGLE',
      name: 'Gemini 2.0 Pro',
      promptCostPer1M: 1.25,
      completionCostPer1M: 5.0,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    // Gemini 1.5 models
    {
      modelId: 'gemini-1.5-flash',
      provider: 'GOOGLE',
      name: 'Gemini 1.5 Flash',
      promptCostPer1M: 0.075,
      completionCostPer1M: 0.30,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'gemini-1.5-pro',
      provider: 'GOOGLE',
      name: 'Gemini 1.5 Pro',
      promptCostPer1M: 1.25,
      completionCostPer1M: 5.0,
      contextLength: 1000000,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  GROK: [
    {
      modelId: 'grok-2',
      provider: 'GROK',
      name: 'Grok-2',
      promptCostPer1M: 2.0,
      completionCostPer1M: 10.0,
      contextLength: 131072,
      supportsVision: true,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
    {
      modelId: 'grok-2-mini',
      provider: 'GROK',
      name: 'Grok-2 Mini',
      promptCostPer1M: 0.30,
      completionCostPer1M: 0.50,
      contextLength: 131072,
      supportsVision: false,
      supportsTools: true,
      fetchedAt: '2025-11-01T00:00:00Z',
    },
  ],

  // OpenRouter fetches from API, these are fallbacks
  OPENROUTER: [],

  // Ollama is local/free
  OLLAMA: [],

  // OpenAI Compatible uses same pricing structure as source
  OPENAI_COMPATIBLE: [],
}
