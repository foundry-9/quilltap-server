/**
 * Pseudo-Tool Support Module
 *
 * Provides text-based tool support for LLM models that don't have native
 * function calling capabilities. This allows models like some OpenRouter
 * models to use memory search, image generation, and web search through
 * special markers in their text responses.
 */

import { Provider } from '@/lib/schemas/types'
import { FALLBACK_PRICING } from '@/lib/llm/pricing'
import { getPricingCache } from '@/lib/llm/pricing-fetcher'
import { logger } from '@/lib/logger'

/**
 * Configuration for pseudo-tool mode
 */
export interface PseudoToolConfig {
  /** Whether pseudo-tools are enabled */
  enabled: boolean
  /** Which tools are available */
  availableTools: ('memory' | 'image' | 'search')[]
}

/**
 * Options for tool mode override on connection profiles
 */
export type ToolMode = 'auto' | 'native' | 'pseudo'

/**
 * Check if a model supports native tool/function calling
 *
 * Uses cached pricing data from OpenRouter or fallback data for other providers.
 * Returns true if model supports tools, false if it doesn't, and defaults to
 * true for unknown models (to avoid breaking existing functionality).
 */
export async function checkModelSupportsTools(
  provider: Provider,
  modelName: string,
  userId: string
): Promise<boolean> {
  try {
    // For OpenRouter, use cached pricing data which includes supportsTools
    if (provider === 'OPENROUTER') {
      const cache = await getPricingCache(userId)
      const providerData = cache.providers[provider]

      if (providerData?.models) {
        const model = providerData.models.find(m => m.modelId === modelName)
        if (model) {
          logger.debug('[PseudoToolSupport] Found model capability info', {
            provider,
            model: modelName,
            supportsTools: model.supportsTools,
          })
          return model.supportsTools ?? true
        }
      }

      // Model not found in cache - default to true to avoid breaking things
      logger.debug('[PseudoToolSupport] Model not found in cache, assuming tool support', {
        provider,
        model: modelName,
      })
      return true
    }

    // For other providers, check fallback pricing data
    const fallbackModels = FALLBACK_PRICING[provider]
    if (fallbackModels) {
      const model = fallbackModels.find(m => m.modelId === modelName)
      if (model) {
        return model.supportsTools ?? true
      }
    }

    // Unknown provider/model - default to true (native tools)
    // This ensures we don't break existing functionality
    return true
  } catch (error) {
    logger.warn('[PseudoToolSupport] Error checking model capabilities, defaulting to native tools', {
      provider,
      model: modelName,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

/**
 * Determine if pseudo-tools should be used for this request
 *
 * @param supportsNativeTools - Whether the model supports native function calling
 * @param profileOverride - Optional override from connection profile ('auto', 'native', 'pseudo')
 * @returns true if pseudo-tools should be used, false for native tools
 */
export function shouldUsePseudoTools(
  supportsNativeTools: boolean,
  profileOverride?: ToolMode
): boolean {
  // Explicit overrides take precedence
  if (profileOverride === 'native') {
    logger.debug('[PseudoToolSupport] Using native tools (profile override)')
    return false
  }
  if (profileOverride === 'pseudo') {
    logger.debug('[PseudoToolSupport] Using pseudo-tools (profile override)')
    return true
  }

  // Auto mode: use pseudo-tools only if model doesn't support native tools
  const usePseudo = !supportsNativeTools
  logger.debug('[PseudoToolSupport] Auto-detected tool mode', {
    supportsNativeTools,
    usePseudoTools: usePseudo,
  })
  return usePseudo
}

/**
 * Build the pseudo-tool configuration based on enabled options
 */
export function buildPseudoToolConfig(options: {
  imageGeneration?: boolean
  memorySearch?: boolean
  webSearch?: boolean
}): PseudoToolConfig {
  const availableTools: ('memory' | 'image' | 'search')[] = []

  if (options.memorySearch !== false) {
    availableTools.push('memory')
  }
  if (options.imageGeneration) {
    availableTools.push('image')
  }
  if (options.webSearch) {
    availableTools.push('search')
  }

  return {
    enabled: availableTools.length > 0,
    availableTools,
  }
}
