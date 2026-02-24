/**
 * Cheap LLM Provider Selection
 * Sprint 2: Memory System - Cheap LLM Support
 *
 * This module provides intelligent selection of cost-effective LLM providers
 * for background tasks like memory extraction, summarization, and chat titling.
 * These tasks don't require the full power of expensive models.
 *
 * Now enhanced with real pricing data from provider APIs (Sprint 2.1).
 *
 * NOTE: Registered plugins provide cheapModels configuration via the provider
 * registry. The legacy fallback constants are imported from fallback-data.ts
 * and used only when no plugin is registered for a provider.
 *
 * @see lib/llm/fallback-data.ts for legacy fallback constants
 */

import { ConnectionProfile, Provider } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import {
  ModelPricing,
  getAverageCostPer1M,
  calculateCostTier,
  calculateSavings,
} from './pricing'
import {
  getProviderPricing,
  findCheapestAvailableModel,
} from './pricing-fetcher'
import { getCheapModelConfig } from '@/lib/plugins/provider-registry'
import {
  LEGACY_CHEAPEST_MODEL_MAP,
  LEGACY_RECOMMENDED_CHEAP_MODELS,
} from './fallback-data'

/**
 * Strategy for selecting the cheap LLM provider
 */
export type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'

/**
 * Configuration for cheap LLM provider selection
 */
export interface CheapLLMConfig {
  /** Strategy for selecting the cheap LLM */
  strategy: CheapLLMStrategy
  /** If USER_DEFINED, the connection profile ID to use */
  userDefinedProfileId?: string
  /** Global default cheap profile ID - takes priority over strategy */
  defaultCheapProfileId?: string
  /** Whether to fall back to local models (Ollama) if available */
  fallbackToLocal: boolean
}

/**
 * Result of cheap LLM provider selection
 */
export interface CheapLLMSelection {
  /** The provider to use */
  provider: Provider
  /** The model name to use */
  modelName: string
  /** Base URL if required (e.g., for Ollama) */
  baseUrl?: string
  /** The connection profile ID to use for API key retrieval */
  connectionProfileId?: string
  /** Whether this is a local model (no API costs) */
  isLocal: boolean
}

/**
 * Mapping of providers to their cheapest models (legacy fallback)
 * @see getCheapModelConfig() from provider-registry for plugin-based resolution
 */

/**
 * Models that are known to work well for cheap LLM tasks
 * Re-exported from fallback-data.ts for backward compatibility
 *
 * @deprecated Use getCheapModelConfig() from provider-registry instead
 */
export const RECOMMENDED_CHEAP_MODELS = LEGACY_RECOMMENDED_CHEAP_MODELS

/**
 * Default cheap LLM configuration
 */
export const DEFAULT_CHEAP_LLM_CONFIG: CheapLLMConfig = {
  strategy: 'PROVIDER_CHEAPEST',
  fallbackToLocal: true,
}

/**
 * Gets the cheapest model for a given provider
 * First checks the plugin registry, falls back to hardcoded map.
 */
export function getCheapestModel(provider: Provider): string {
  // First try the plugin registry
  const registryConfig = getCheapModelConfig(provider)
  if (registryConfig?.defaultModel) {
    return registryConfig.defaultModel
  }

  // Fall back to hardcoded map
  return LEGACY_CHEAPEST_MODEL_MAP[provider]
}

/**
 * Selects the appropriate cheap LLM provider based on configuration
 *
 * Selection priority (per CHEAP-LLM.md spec):
 * 1. Global defaultCheapProfileId if set
 * 2. USER_DEFINED strategy with userDefinedProfileId
 * 3. Any profile with isCheap flag set to true
 * 4. LOCAL_FIRST or fallbackToLocal using Ollama
 * 5. Fall back to current profile's cheapest model variant
 *
 * @param currentProfile - The current connection profile being used for chat
 * @param config - Cheap LLM configuration
 * @param availableProfiles - All available connection profiles (for USER_DEFINED strategy)
 * @param ollamaAvailable - Whether Ollama is available locally
 * @param onNoCheapLLM - Callback when no cheap LLM is available (for toast notification)
 * @returns The selected cheap LLM configuration
 */
export function getCheapLLMProvider(
  currentProfile: ConnectionProfile,
  config: CheapLLMConfig = DEFAULT_CHEAP_LLM_CONFIG,
  availableProfiles: ConnectionProfile[] = [],
  ollamaAvailable: boolean = false,
  onNoCheapLLM?: () => void
): CheapLLMSelection {

  // Priority 1: Global default cheap profile (always takes precedence if set)
  if (config.defaultCheapProfileId) {
    const defaultCheapProfile = availableProfiles.find(p => p.id === config.defaultCheapProfileId)
    if (defaultCheapProfile) {
      return {
        provider: defaultCheapProfile.provider,
        modelName: defaultCheapProfile.modelName,
        baseUrl: defaultCheapProfile.baseUrl || undefined,
        connectionProfileId: defaultCheapProfile.id,
        isLocal: defaultCheapProfile.provider === 'OLLAMA',
      }
    }
    // Global default not found, fall through to other strategies
  }

  // Priority 2: User-defined connection profile (USER_DEFINED strategy)
  if (config.strategy === 'USER_DEFINED' && config.userDefinedProfileId) {
    const userProfile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (userProfile) {

      return {
        provider: userProfile.provider,
        modelName: userProfile.modelName,
        baseUrl: userProfile.baseUrl || undefined,
        connectionProfileId: userProfile.id,
        isLocal: userProfile.provider === 'OLLAMA',
      }
    }
    // Fall through to next strategy if profile not found
    logger.warn('[CheapLLM] USER_DEFINED profile not found, falling through', {
      context: 'getCheapLLMProvider',
      userDefinedProfileId: config.userDefinedProfileId,
    })
  }

  // Priority 3: Use any profile marked as "cheap" (isCheap flag)
  const cheapProfiles = availableProfiles.filter(p => p.isCheap === true)
  if (cheapProfiles.length > 0) {
    // Prefer local (Ollama) cheap profiles for zero cost
    const localCheapProfile = cheapProfiles.find(p => p.provider === 'OLLAMA')
    if (localCheapProfile) {
      return {
        provider: 'OLLAMA',
        modelName: localCheapProfile.modelName,
        baseUrl: localCheapProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: localCheapProfile.id,
        isLocal: true,
      }
    }
    // Use the first available cheap profile
    const cheapProfile = cheapProfiles[0]
    return {
      provider: cheapProfile.provider,
      modelName: cheapProfile.modelName,
      baseUrl: cheapProfile.baseUrl || undefined,
      connectionProfileId: cheapProfile.id,
      isLocal: cheapProfile.provider === 'OLLAMA',
    }
  }

  // Priority 4: Local first (prefer Ollama if available)
  if (config.strategy === 'LOCAL_FIRST' || (config.fallbackToLocal && ollamaAvailable)) {
    // Look for an Ollama profile in available profiles
    const ollamaProfile = availableProfiles.find(p => p.provider === 'OLLAMA')
    if (ollamaProfile) {
      return {
        provider: 'OLLAMA',
        modelName: ollamaProfile.modelName,
        baseUrl: ollamaProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: ollamaProfile.id,
        isLocal: true,
      }
    }

    // If LOCAL_FIRST was explicitly requested but no Ollama profile exists,
    // we should still fall through to the cheapest provider
  }

  // Priority 5: No dedicated cheap LLM available - warn and use current profile
  // Toast warning that no cheap LLM is configured
  if (onNoCheapLLM) {
    onNoCheapLLM()
  }

  // For Ollama, always use the current profile's model - all local models are "free"
  // and we can't assume what models the user has installed
  if (currentProfile.provider === 'OLLAMA') {
    return {
      provider: currentProfile.provider,
      modelName: currentProfile.modelName,
      baseUrl: currentProfile.baseUrl || undefined,
      connectionProfileId: currentProfile.id,
      isLocal: true,
    }
  }

  // Map current provider to its cheapest variant (fallback)
  const cheapModel = getCheapestModel(currentProfile.provider)

  logger.warn('[CheapLLM] Using FALLBACK to cheapest model for current provider', {
    context: 'getCheapLLMProvider',
    provider: currentProfile.provider,
    cheapModel,
    currentProfileModel: currentProfile.modelName,
  })

  return {
    provider: currentProfile.provider,
    modelName: cheapModel,
    baseUrl: currentProfile.baseUrl || undefined,
    connectionProfileId: currentProfile.id,
    isLocal: false,
  }
}

/**
 * Checks if a model is considered a "cheap" model
 * Used to validate user-defined cheap LLM profiles
 * First checks the plugin registry, falls back to hardcoded list.
 */
export function isCheapModel(provider: Provider, modelName: string): boolean {
  // First try the plugin registry
  const registryConfig = getCheapModelConfig(provider)
  const registryModels = registryConfig?.recommendedModels || []

  // Fall back to hardcoded list
  const recommendedModels = registryModels.length > 0
    ? registryModels
    : (RECOMMENDED_CHEAP_MODELS[provider] || [])

  // Check exact match first
  if (recommendedModels.includes(modelName)) {
    return true
  }

  const lowerModelName = modelName.toLowerCase()

  // Exclude known expensive models first
  const expensiveIndicators = ['opus', 'o1', 'o3', 'ultra', 'pro']
  if (expensiveIndicators.some(indicator => lowerModelName.includes(indicator))) {
    return false
  }

  // Check for mid-tier models that shouldn't be considered cheap
  // Note: "4o" alone (without "mini") is mid-tier, not cheap
  if (lowerModelName.includes('4o') && !lowerModelName.includes('mini')) {
    return false
  }
  if (lowerModelName.includes('sonnet')) {
    return false
  }

  // Check if model name contains common cheap model indicators
  const cheapIndicators = [
    'mini',
    'flash',
    'haiku',
    'turbo',
    '3.5',
    ':1b',
    ':2b',
    ':3b',
    ':7b',
    'small',
    'tiny',
    'instant',
  ]

  return cheapIndicators.some(indicator => lowerModelName.includes(indicator))
}

/**
 * Estimates the relative cost of a model (for UI display)
 * Returns a value from 1 (cheapest) to 5 (most expensive)
 */
export function estimateModelCost(provider: Provider, modelName: string): number {
  const lowerModelName = modelName.toLowerCase()

  // Local models are free
  if (provider === 'OLLAMA') {
    return 1
  }

  // High-tier models (check first as they take priority)
  const highTierIndicators = ['opus', 'o1-', 'o3-', 'ultra']
  if (highTierIndicators.some(i => lowerModelName.includes(i))) {
    return 5
  }

  // Check for cheap model indicators
  if (isCheapModel(provider, modelName)) {
    return 2
  }

  // Mid-tier models (everything else including pro, sonnet, 4o)
  const midTierIndicators = ['sonnet', '4o', 'pro', 'gemini-1.5', 'gemini-2.0-pro']
  if (midTierIndicators.some(i => lowerModelName.includes(i))) {
    return 3
  }

  // Default to mid-tier
  return 3
}

/**
 * Validates that a cheap LLM configuration is usable
 */
export function validateCheapLLMConfig(
  config: CheapLLMConfig,
  availableProfiles: ConnectionProfile[]
): { valid: boolean; error?: string } {
  if (config.strategy === 'USER_DEFINED') {
    if (!config.userDefinedProfileId) {
      return {
        valid: false,
        error: 'USER_DEFINED strategy requires userDefinedProfileId',
      }
    }

    const profile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (!profile) {
      return {
        valid: false,
        error: `Connection profile ${config.userDefinedProfileId} not found`,
      }
    }

    // Warn if the selected model is not a cheap model
    if (!isCheapModel(profile.provider, profile.modelName)) {
      // Get recommended models from registry or fallback
      const registryConfig = getCheapModelConfig(profile.provider)
      const recommendedModels = registryConfig?.recommendedModels?.length
        ? registryConfig.recommendedModels
        : RECOMMENDED_CHEAP_MODELS[profile.provider]

      return {
        valid: true, // Still valid, just a warning
        error: `Warning: ${profile.modelName} is not a recommended cheap model. ` +
          `Consider using one of: ${recommendedModels?.join(', ')}`,
      }
    }
  }

  return { valid: true }
}

// ============================================================================
// PRICING-AWARE SELECTION (Sprint 2.1)
// ============================================================================

/**
 * Extended selection result with pricing information
 */
export interface CheapLLMSelectionWithPricing extends CheapLLMSelection {
  /** Pricing information if available */
  pricing?: ModelPricing
  /** Cost tier (1-5) based on actual pricing */
  costTier?: number
  /** Savings percentage compared to the current/main model */
  savingsPercent?: number
}

/**
 * Selects the cheapest available model using real pricing data
 * This is an async version that queries the pricing cache
 *
 * Selection priority (per CHEAP-LLM.md spec):
 * 1. Global defaultCheapProfileId if set
 * 2. USER_DEFINED strategy with userDefinedProfileId
 * 3. Any profile with isCheap flag set to true
 * 4. LOCAL_FIRST or fallbackToLocal using Ollama
 * 5. Fall back to cheapest model across available providers
 *
 * @param currentProfile - The current connection profile (for comparison)
 * @param userId - User ID for API key access
 * @param config - Cheap LLM configuration
 * @param availableProfiles - All available connection profiles
 * @param onNoCheapLLM - Callback when no cheap LLM is available (for toast notification)
 * @returns The cheapest available model with pricing info
 */
export async function getCheapLLMProviderWithPricing(
  currentProfile: ConnectionProfile,
  userId: string,
  config: CheapLLMConfig = DEFAULT_CHEAP_LLM_CONFIG,
  availableProfiles: ConnectionProfile[] = [],
  onNoCheapLLM?: () => void
): Promise<CheapLLMSelectionWithPricing> {
  // Priority 1: Global default cheap profile (always takes precedence if set)
  if (config.defaultCheapProfileId) {
    const defaultCheapProfile = availableProfiles.find(p => p.id === config.defaultCheapProfileId)
    if (defaultCheapProfile) {
      const models = await getProviderPricing(defaultCheapProfile.provider, userId)
      const pricing = models.find(m => m.modelId === defaultCheapProfile.modelName)

      return {
        provider: defaultCheapProfile.provider,
        modelName: defaultCheapProfile.modelName,
        baseUrl: defaultCheapProfile.baseUrl || undefined,
        connectionProfileId: defaultCheapProfile.id,
        isLocal: defaultCheapProfile.provider === 'OLLAMA',
        pricing,
        costTier: pricing ? calculateCostTier(pricing) : undefined,
      }
    }
  }

  // Priority 2: User-defined connection profile (USER_DEFINED strategy)
  if (config.strategy === 'USER_DEFINED' && config.userDefinedProfileId) {
    const userProfile = availableProfiles.find(p => p.id === config.userDefinedProfileId)
    if (userProfile) {
      // Get pricing for the user-defined model
      const models = await getProviderPricing(userProfile.provider, userId)
      const pricing = models.find(m => m.modelId === userProfile.modelName)

      return {
        provider: userProfile.provider,
        modelName: userProfile.modelName,
        baseUrl: userProfile.baseUrl || undefined,
        connectionProfileId: userProfile.id,
        isLocal: userProfile.provider === 'OLLAMA',
        pricing,
        costTier: pricing ? calculateCostTier(pricing) : undefined,
      }
    }
  }

  // Priority 3: Use any profile marked as "cheap" (isCheap flag)
  const cheapProfiles = availableProfiles.filter(p => p.isCheap === true)
  if (cheapProfiles.length > 0) {
    // Prefer local (Ollama) cheap profiles for zero cost
    const localCheapProfile = cheapProfiles.find(p => p.provider === 'OLLAMA')
    if (localCheapProfile) {
      const models = await getProviderPricing('OLLAMA', userId)
      const pricing = models.find(m => m.modelId === localCheapProfile.modelName)

      return {
        provider: 'OLLAMA',
        modelName: localCheapProfile.modelName,
        baseUrl: localCheapProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: localCheapProfile.id,
        isLocal: true,
        pricing: pricing || {
          modelId: localCheapProfile.modelName,
          provider: 'OLLAMA',
          name: localCheapProfile.modelName,
          promptCostPer1M: 0,
          completionCostPer1M: 0,
          contextLength: null,
          fetchedAt: new Date().toISOString(),
        },
        costTier: 1, // Free
        savingsPercent: 100, // 100% savings vs any paid model
      }
    }
    // Use the first available cheap profile
    const cheapProfile = cheapProfiles[0]
    const models = await getProviderPricing(cheapProfile.provider, userId)
    const pricing = models.find(m => m.modelId === cheapProfile.modelName)

    return {
      provider: cheapProfile.provider,
      modelName: cheapProfile.modelName,
      baseUrl: cheapProfile.baseUrl || undefined,
      connectionProfileId: cheapProfile.id,
      isLocal: cheapProfile.provider === 'OLLAMA',
      pricing,
      costTier: pricing ? calculateCostTier(pricing) : undefined,
    }
  }

  // Priority 4: Local first (free models)
  if (config.strategy === 'LOCAL_FIRST' || config.fallbackToLocal) {
    const ollamaProfile = availableProfiles.find(p => p.provider === 'OLLAMA')
    if (ollamaProfile) {
      const models = await getProviderPricing('OLLAMA', userId)
      const pricing = models.find(m => m.modelId === ollamaProfile.modelName)

      return {
        provider: 'OLLAMA',
        modelName: ollamaProfile.modelName,
        baseUrl: ollamaProfile.baseUrl || 'http://localhost:11434',
        connectionProfileId: ollamaProfile.id,
        isLocal: true,
        pricing: pricing || {
          modelId: ollamaProfile.modelName,
          provider: 'OLLAMA',
          name: ollamaProfile.modelName,
          promptCostPer1M: 0,
          completionCostPer1M: 0,
          contextLength: null,
          fetchedAt: new Date().toISOString(),
        },
        costTier: 1, // Free
        savingsPercent: 100, // 100% savings vs any paid model
      }
    }
  }

  // Priority 5: Find the cheapest model across all available providers
  // Get providers we have profiles for
  const availableProviders = [...new Set(availableProfiles.map(p => p.provider))]

  // Find the absolute cheapest available model
  const cheapestModel = await findCheapestAvailableModel(userId, {
    excludeProviders: availableProviders.length > 0
      ? (['OLLAMA', 'OPENROUTER', 'OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK', 'OPENAI_COMPATIBLE'] as Provider[])
          .filter(p => !availableProviders.includes(p))
      : undefined,
  })

  if (cheapestModel) {
    // Find the connection profile for this provider
    const profile = availableProfiles.find(p => p.provider === cheapestModel.provider)

    // Get current model pricing for savings calculation
    const currentModels = await getProviderPricing(currentProfile.provider, userId)
    const currentPricing = currentModels.find(m => m.modelId === currentProfile.modelName)

    const savingsPercent = currentPricing
      ? calculateSavings(currentPricing, cheapestModel)
      : undefined

    return {
      provider: cheapestModel.provider,
      modelName: cheapestModel.modelId,
      baseUrl: profile?.baseUrl || undefined,
      connectionProfileId: profile?.id,
      isLocal: cheapestModel.provider === 'OLLAMA',
      pricing: cheapestModel,
      costTier: calculateCostTier(cheapestModel),
      savingsPercent,
    }
  }

  // Fallback: No dedicated cheap LLM available - warn and use current profile
  if (onNoCheapLLM) {
    onNoCheapLLM()
  }

  // For Ollama, always use the current profile's model - all local models are "free"
  // and we can't assume what models the user has installed
  if (currentProfile.provider === 'OLLAMA') {
    return {
      provider: currentProfile.provider,
      modelName: currentProfile.modelName,
      baseUrl: currentProfile.baseUrl || undefined,
      connectionProfileId: currentProfile.id,
      isLocal: true,
      pricing: undefined,
      costTier: 1, // Cheapest tier - local models are free
    }
  }

  // Use the name-based heuristic
  const cheapModel = getCheapestModel(currentProfile.provider)
  const models = await getProviderPricing(currentProfile.provider, userId)
  const pricing = models.find(m => m.modelId === cheapModel)

  return {
    provider: currentProfile.provider,
    modelName: cheapModel,
    baseUrl: currentProfile.baseUrl || undefined,
    connectionProfileId: currentProfile.id,
    isLocal: false,
    pricing,
    costTier: pricing ? calculateCostTier(pricing) : estimateModelCost(currentProfile.provider, cheapModel),
  }
}
