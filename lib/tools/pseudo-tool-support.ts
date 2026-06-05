/**
 * Tool Support Module
 *
 * Provides utilities for checking model tool capabilities and determining
 * whether to use native function calling or text-block tool format.
 */

import { Provider } from '@/lib/schemas/types'
import { FALLBACK_PRICING } from '@/lib/llm/pricing'
import { getPricingCache } from '@/lib/llm/pricing-fetcher'
import { logger } from '@/lib/logger'

/**
 * Options for tool mode override on connection profiles.
 *
 * - 'auto'        — pick by model capability. Native function-calling models
 *                   get the native protocol; non-native models get
 *                   simple-json.
 * - 'native'      — force native function calling. Ignored for models that
 *                   don't support it (falls back to simple-json).
 * - 'simple-json' — `<tool_call>{...}</tool_call>` JSON-in-XML pseudo-tool
 *                   format with provider stop-sequence enforcement.
 * - 'text-block'  — legacy `[[TOOL_NAME ...]]content[[/TOOL_NAME]]`
 *                   pseudo-tool format. Kept for compatibility.
 */
export type ToolMode = 'auto' | 'native' | 'simple-json' | 'text-block'

/** The concrete strategy a request resolves to. */
export type ResolvedToolMode = 'native' | 'simple-json' | 'text-block'

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

          return model.supportsTools ?? true
        }
      }

      // Model not found in cache - default to true to avoid breaking things

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
    logger.warn('[ToolSupport] Error checking model capabilities, defaulting to native tools', {
      provider,
      model: modelName,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

/**
 * Determine if text-block tools should be used for this request
 *
 * Text-block tools are the preferred text-based tool format for models
 * that lack native function calling, supporting all tools with named parameters.
 *
 * @param supportsNativeTools - Whether the model supports native function calling
 * @param profileOverride - Optional override from connection profile
 * @returns true if text-block tools should be used
 */
export function shouldUseTextBlockTools(
  supportsNativeTools: boolean,
  profileOverride?: ToolMode
): boolean {
  // Any pseudo-tool surface (simple-json OR text-block) means "not native",
  // i.e. the same downstream gating (`continuationTools: []`) applies. The
  // legacy boolean name persists for back-compat.
  const resolved = resolveToolMode(supportsNativeTools, profileOverride)
  return resolved !== 'native'
}

/**
 * Resolve the concrete strategy to use for a request.
 *
 * Precedence:
 *   1. Explicit `profileOverride` (other than 'auto') always wins. `'native'`
 *      on a non-native model falls back to 'simple-json' so the request
 *      doesn't break silently.
 *   2. 'auto' on a native model → 'native'.
 *   3. 'auto' on a non-native model → 'simple-json' (the post-flip default;
 *      see `docs/developer/features/simple-json-tool-calls.md`).
 */
export function resolveToolMode(
  supportsNativeTools: boolean,
  profileOverride?: ToolMode
): ResolvedToolMode {
  if (profileOverride === 'text-block') {
    return 'text-block'
  }
  if (profileOverride === 'simple-json') {
    return 'simple-json'
  }
  if (profileOverride === 'native') {
    // Honour the override unless the model truly can't do it.
    return supportsNativeTools ? 'native' : 'simple-json'
  }
  // 'auto' or undefined
  return supportsNativeTools ? 'native' : 'simple-json'
}
