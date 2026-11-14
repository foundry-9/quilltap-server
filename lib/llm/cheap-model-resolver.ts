/**
 * Run-time resolution of a provider's cheap (background) model.
 *
 * Some providers have no model name that stays valid across releases —
 * Anthropic's IDs, short ones included, are each a pinned snapshot — so the
 * cheapest model cannot be a constant in the plugin. Such a plugin declares
 * `cheapModels.resolveDefaultModel(apiKey, baseUrl)`, which reads its live
 * model list; this module caches the answer per (provider, key, base URL).
 *
 * Reads are synchronous so `getCheapLLMProvider` stays synchronous for its
 * many callers: a miss or a stale entry starts a refresh in the background
 * and returns what is cached (or null). The refresh only reads (the key
 * row and the provider's model list), so it is safe in the job child too;
 * each process keeps its own cache.
 */

import { logger } from '@/lib/logger'
import { getCheapModelConfig } from '@/lib/plugins/provider-registry'
import { getRepositories } from '@/lib/repositories/factory'
import { processSingleton } from '@/lib/utils/process-singleton'
import type { ConnectionProfile } from '@/lib/schemas/types'

/** How long a resolved model is trusted before it is looked up again. */
export const CHEAP_MODEL_TTL_MS = 12 * 60 * 60 * 1000

/** After a failed lookup, how long to wait before trying again. */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000

interface CacheEntry {
  model: string | null
  resolvedAt: number
}

interface ResolverState {
  entries: Map<string, CacheEntry>
  inFlight: Map<string, Promise<string | null>>
}

const state = processSingleton<ResolverState>('llm.cheapModelResolver', () => ({
  entries: new Map(),
  inFlight: new Map(),
}))

type ProfileForResolution = Pick<ConnectionProfile, 'provider' | 'apiKeyId' | 'baseUrl' | 'userId'>

function cacheKey(profile: ProfileForResolution): string {
  return `${profile.provider}|${profile.apiKeyId ?? ''}|${profile.baseUrl ?? ''}`
}

function isFresh(entry: CacheEntry, now: number): boolean {
  const ttl = entry.model ? CHEAP_MODEL_TTL_MS : RETRY_AFTER_FAILURE_MS
  return now - entry.resolvedAt < ttl
}

/**
 * Look the provider's cheap model up now (deduplicated per cache key) and
 * cache the result. Resolves to null when the provider declares no resolver,
 * the profile has no usable key, or the lookup fails.
 */
export function refreshCheapModel(profile: ProfileForResolution): Promise<string | null> {
  const key = cacheKey(profile)
  const pending = state.inFlight.get(key)
  if (pending) return pending

  const run = (async (): Promise<string | null> => {
    const resolver = getCheapModelConfig(profile.provider)?.resolveDefaultModel
    if (!resolver) return null
    let model: string | null = null
    try {
      let apiKey = ''
      if (profile.apiKeyId) {
        const row = await getRepositories().connections.findApiKeyByIdAndUserId(profile.apiKeyId, profile.userId)
        apiKey = row?.key_value ?? ''
      }
      if (!apiKey) {
        logger.debug('[CheapModel] No API key to look the cheap model up with', {
          context: 'cheap-model-resolver',
          provider: profile.provider,
        })
      } else {
        model = (await resolver(apiKey, profile.baseUrl ?? undefined)) || null
      }
    } catch (error) {
      logger.warn('[CheapModel] Cheap-model lookup failed', {
        context: 'cheap-model-resolver',
        provider: profile.provider,
        error: error instanceof Error ? error.message : String(error),
      })
      model = null
    }
    state.entries.set(key, { model, resolvedAt: Date.now() })
    logger.debug('[CheapModel] Cheap model resolved', {
      context: 'cheap-model-resolver',
      provider: profile.provider,
      model,
    })
    return model
  })().finally(() => {
    state.inFlight.delete(key)
  })

  state.inFlight.set(key, run)
  return run
}

/**
 * The cached cheap model for this profile's provider and key, or null when
 * none is known yet. A missing or stale entry starts a background refresh,
 * so a later call finds it; a stale model is still returned meanwhile.
 */
export function getResolvedCheapModel(profile: ProfileForResolution): string | null {
  if (!getCheapModelConfig(profile.provider)?.resolveDefaultModel) return null
  const entry = state.entries.get(cacheKey(profile))
  if (!entry || !isFresh(entry, Date.now())) {
    void refreshCheapModel(profile)
  }
  return entry?.model ?? null
}

/** Test seam: forget every cached answer. */
export function clearCheapModelCache(): void {
  state.entries.clear()
  state.inFlight.clear()
}
