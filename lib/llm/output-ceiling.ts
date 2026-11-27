/**
 * Output-token ceilings, learned from the provider and applied at the door
 *
 * A connection profile's output budget is a wish; the provider decides what it
 * will accept. Z.AI answers 400 to any `max_tokens` above 131,072, and a
 * profile set past a model's real limit (943,718 on a 1M-context model, say)
 * used to fail every call that asked for its full budget. Rather than warn
 * people to fix their profiles, the host learns the real ceiling and clamps to
 * it:
 *
 *   1. **The provider's live model catalog** (`getModelCatalog`, for plugins
 *      that have one): the model's own `maxOutputTokens`, read with the call's
 *      key and base URL.
 *   2. **The provider's declared API ceiling** — `providerConfig.maxOutputTokens`
 *      in the plugin manifest, for providers with one number for every model.
 *
 * The lower of the two wins. Each (provider, base URL, key, model) is resolved
 * once per process and kept for the session; a catalog that could not be read
 * is retried after {@link FAILED_LOOKUP_RETRY_MS}, never on every call.
 *
 * Applied in one place: {@link withOutputCeiling} wraps every text provider the
 * registry creates, so `sendMessage` and `streamMessage` never send more than
 * the ceiling, whichever caller built the request.
 *
 * @module llm/output-ceiling
 */

import { createHash } from 'crypto'
import type { LLMParams, TextProvider } from '@quilltap/plugin-types'
import { logger } from '@/lib/logger'
import { processSingleton } from '@/lib/utils/process-singleton'
import { getPluginsByCapability } from '@/lib/plugins/registry'

/** How long a failed catalog read is remembered before trying again. */
export const FAILED_LOOKUP_RETRY_MS = 10 * 60 * 1000

interface CeilingEntry {
  ceiling: number | null
  /** Set when the catalog could not be read; the entry is retried after this. */
  retryAfter?: number
}

const ceilingCache = processSingleton(
  'llm.outputCeilingCache',
  () => new Map<string, CeilingEntry>()
)

const inFlight = processSingleton(
  'llm.outputCeilingInFlight',
  () => new Map<string, Promise<number | null>>()
)

/** Forget every learned ceiling (tests, and after a plugin reload). */
export function clearOutputCeilingCache(): void {
  ceilingCache.clear()
  inFlight.clear()
}

/**
 * The output-token ceiling a provider declares in its manifest for every
 * model, or null when it declares none.
 */
export function providerOutputCeiling(provider: string): number | null {
  for (const plugin of getPluginsByCapability('LLM_PROVIDER')) {
    const config = plugin.manifest.providerConfig
    if (config?.providerName !== provider) continue
    const ceiling = config.maxOutputTokens
    return typeof ceiling === 'number' && ceiling > 0 ? ceiling : null
  }
  return null
}

function keyFor(provider: string, model: string, apiKey: string, baseUrl?: string): string {
  // Never hold a raw key in a map key; a short digest tells keys apart.
  const keyDigest = apiKey ? createHash('sha256').update(apiKey).digest('hex').slice(0, 12) : 'nokey'
  return `${provider}|${baseUrl ?? ''}|${keyDigest}|${model}`
}

function lowest(...values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  return known.length > 0 ? Math.min(...known) : null
}

async function lookUp(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl: string | undefined,
): Promise<CeilingEntry> {
  const declared = providerOutputCeiling(provider)
  try {
    const { lookupLiveModelEntry } = await import('./model-catalog')
    const entry = await lookupLiveModelEntry({ provider, modelName: model, apiKey, baseUrl })
    return { ceiling: lowest(declared, entry?.maxOutputTokens) }
  } catch (error) {
    logger.debug('[OutputCeiling] Live catalog unavailable; using the declared ceiling for now', {
      provider,
      model,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ceiling: declared, retryAfter: Date.now() + FAILED_LOOKUP_RETRY_MS }
  }
}

/**
 * The most output tokens this provider will accept for this model, as far as
 * the provider has told us, or null when it has not said. Resolved once per
 * session per (provider, base URL, key, model).
 */
export async function resolveOutputCeiling(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl?: string,
): Promise<number | null> {
  const key = keyFor(provider, model, apiKey, baseUrl)
  const cached = ceilingCache.get(key)
  if (cached && (cached.retryAfter === undefined || Date.now() < cached.retryAfter)) {
    return cached.ceiling
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const lookup = lookUp(provider, model, apiKey, baseUrl)
    .then((entry) => {
      ceilingCache.set(key, entry)
      logger.debug('[OutputCeiling] Learned output ceiling', {
        provider,
        model,
        ceiling: entry.ceiling,
        provisional: entry.retryAfter !== undefined,
      })
      return entry.ceiling
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, lookup)
  return lookup
}

/** `params` with `maxTokens` lowered to the ceiling, when it is above it. */
export async function clampToOutputCeiling(
  provider: string,
  baseUrl: string | undefined,
  params: LLMParams,
  apiKey: string,
): Promise<LLMParams> {
  if (typeof params.maxTokens !== 'number') return params
  const ceiling = await resolveOutputCeiling(provider, params.model, apiKey, baseUrl)
  if (ceiling === null || params.maxTokens <= ceiling) return params
  logger.info('[OutputCeiling] Lowered max tokens to the provider ceiling', {
    provider,
    model: params.model,
    requested: params.maxTokens,
    ceiling,
  })
  return { ...params, maxTokens: ceiling }
}

/**
 * Wrap a text provider so every request it sends is clamped to the learned
 * ceiling. Every other member passes through untouched.
 */
export function withOutputCeiling(
  provider: string,
  baseUrl: string | undefined,
  target: TextProvider,
): TextProvider {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'sendMessage') {
        return async (params: LLMParams, apiKey: string) =>
          obj.sendMessage(await clampToOutputCeiling(provider, baseUrl, params, apiKey), apiKey)
      }
      if (prop === 'streamMessage') {
        return async function* (params: LLMParams, apiKey: string) {
          yield* obj.streamMessage(await clampToOutputCeiling(provider, baseUrl, params, apiKey), apiKey)
        }
      }
      const value = Reflect.get(obj, prop, receiver)
      return typeof value === 'function' ? value.bind(obj) : value
    },
  })
}
