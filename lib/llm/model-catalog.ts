/**
 * Model Catalog Facts
 *
 * What is *known* about a model as served by a given provider, gathered from
 * structured sources before anything is guessed. Used by connection-profile
 * Auto-Configure, which asks an LLM only for what this cannot answer.
 *
 * Sources, strongest first (a field takes the first source that states it):
 *
 * 0. **Observed tool reliability** — for `supportsTools` only: whether native
 *    tool calls have actually worked on this route, read from the LLM logs of
 *    the profiles that share its provider, model and base URL
 *    (`lib/llm/tool-reliability.ts`). Used only when the evidence is
 *    decisive, and then it outranks every catalog: a catalog says what a
 *    route claims, the logs what it did.
 * 1. **The provider's live catalog** — the plugin's `getModelCatalog`, read
 *    with the profile's own key and base URL. True of this model *on this
 *    route*, so it is the only source trusted for tool and image support on a
 *    provider other than OpenRouter.
 * 2. **The plugin's static model table** — `getModelInfo()`.
 * 3. **OpenRouter's public catalog** — the upstream model's published limits.
 *    Used for context and output only (plus tool / image support when the
 *    profile's provider *is* OpenRouter): what OpenRouter's route supports is
 *    not evidence about another provider's.
 *
 * @module llm/model-catalog
 */

import { createHash } from 'crypto'
import type { ModelInfo } from '@quilltap/plugin-types'
import {
  getProviderMetadata,
  getProviderModelCatalog,
  getStaticModelInfo,
  hasModelCatalog,
} from '@/lib/plugins/provider-registry'
import { findOpenRouterPublicModel } from '@/lib/llm/pricing-fetcher'
import { processSingleton } from '@/lib/utils/process-singleton'
import { describeToolReliability, observeToolReliability, type ToolReliabilitySummary } from '@/lib/llm/tool-reliability'
import { logger } from '@/lib/logger'

/** The facts a structured source can settle. */
export type ModelFactField = 'maxContext' | 'maxTokens' | 'supportsTools' | 'supportsImages' | 'supportsThinking'

/** Where a value came from, shown beside it in the profile editor. */
export type ModelFactSourceKind =
  | 'observed'
  | 'provider-catalog'
  | 'plugin-table'
  | 'openrouter-public'
  | 'derived'
  | 'estimated'
  | 'default'

export interface ModelFactSource {
  kind: ModelFactSourceKind
  /** Human-readable source, e.g. "NanoGPT's model catalog" */
  label: string
}

export interface ModelFacts {
  maxContext?: number
  maxTokens?: number
  supportsTools?: boolean
  supportsImages?: boolean
  supportsThinking?: boolean
  /** One entry per field that is set above */
  sources: Partial<Record<ModelFactField, ModelFactSource>>
  /** Why the live catalog could not be read, when it was tried and failed */
  catalogError?: string
  /** What the route's own logs showed of native tool calls, when they were read */
  toolReliability?: ToolReliabilitySummary
}

export interface ModelFactsQuery {
  provider: string
  modelName: string
  /** Decrypted key for the profile's provider ('' when keyless or unknown) */
  apiKey: string
  baseUrl?: string
  /**
   * The connection profiles that reach this provider and model by this base
   * URL (`sameRouteProfileIds`). Their logs are the observed evidence; empty
   * or absent, nothing is observed.
   */
  routeProfileIds?: readonly string[]
}

const CATALOG_TTL_MS = 60 * 60 * 1000

interface CachedCatalog {
  models: ModelInfo[]
  fetchedAt: number
}

const catalogCache = processSingleton(
  'llm.modelCatalogCache',
  () => new Map<string, CachedCatalog>()
)

function cacheKey(provider: string, apiKey: string, baseUrl?: string): string {
  // Never hold a raw key in a map key; a short digest is enough to tell keys apart.
  const keyDigest = apiKey ? createHash('sha256').update(apiKey).digest('hex').slice(0, 12) : 'nokey'
  return `${provider}|${baseUrl ?? ''}|${keyDigest}`
}

/** Drop every cached catalog (tests, and after a key change). */
export function clearModelCatalogCache(): void {
  catalogCache.clear()
}

async function readLiveCatalog(query: ModelFactsQuery): Promise<ModelInfo[] | null> {
  if (!hasModelCatalog(query.provider)) return null

  const key = cacheKey(query.provider, query.apiKey, query.baseUrl)
  const cached = catalogCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    logger.debug('[ModelCatalog] Live catalog served from cache', {
      provider: query.provider,
      models: cached.models.length,
    })
    return cached.models
  }

  const models = await getProviderModelCatalog(query.provider, query.apiKey, query.baseUrl)
  if (!models) return null
  catalogCache.set(key, { models, fetchedAt: Date.now() })
  logger.debug('[ModelCatalog] Live catalog fetched', { provider: query.provider, models: models.length })
  return models
}

/**
 * The provider's own live-catalog entry for a model, or null when the plugin
 * has no catalog or the model is not in it. Shares the catalog cache above.
 * Throws when the catalog cannot be read.
 */
export async function lookupLiveModelEntry(query: ModelFactsQuery): Promise<ModelInfo | null> {
  const live = await readLiveCatalog(query)
  if (!live) return null
  return findModelEntry(live, query.modelName) ?? null
}

/**
 * Find a model in a list by the id a profile names: exact, then
 * case-insensitive, then the part after a `vendor/` prefix when exactly one
 * entry has it.
 */
export function findModelEntry<T extends { id: string }>(models: readonly T[], modelName: string): T | undefined {
  const exact = models.find(m => m.id === modelName)
  if (exact) return exact

  const wanted = modelName.trim().toLowerCase()
  const folded = models.find(m => m.id.toLowerCase() === wanted)
  if (folded) return folded

  const bare = (id: string) => id.toLowerCase().slice(id.lastIndexOf('/') + 1)
  const wantedBare = bare(wanted)
  const byBare = models.filter(m => bare(m.id) === wantedBare)
  return byBare.length === 1 ? byBare[0] : undefined
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** Fill each unset field of `facts` from `entry`, recording `source`. */
function absorb(
  facts: ModelFacts,
  entry: Partial<Record<ModelFactField, unknown>>,
  source: ModelFactSource,
  allowed: readonly ModelFactField[]
): void {
  for (const field of allowed) {
    if (facts[field] !== undefined) continue
    const raw = entry[field]
    if (raw === undefined || raw === null) continue
    if (field === 'maxContext' || field === 'maxTokens') {
      const n = positiveInt(raw)
      if (n === undefined) continue
      facts[field] = n
    } else {
      if (typeof raw !== 'boolean') continue
      facts[field] = raw
    }
    facts.sources[field] = source
  }
}

function fromModelInfo(info: ModelInfo): Partial<Record<ModelFactField, unknown>> {
  return {
    maxContext: info.contextWindow,
    maxTokens: info.maxOutputTokens,
    supportsTools: info.supportsTools,
    supportsImages: info.supportsImages,
    supportsThinking: info.supportsThinking,
  }
}

const ALL_FIELDS: readonly ModelFactField[] = [
  'maxContext',
  'maxTokens',
  'supportsTools',
  'supportsImages',
  'supportsThinking',
]

/**
 * Gather what the structured sources know about a model on a provider.
 * Never throws: a source that fails is skipped (a live-catalog failure is
 * reported in `catalogError`).
 */
export async function lookupModelFacts(query: ModelFactsQuery): Promise<ModelFacts> {
  const facts: ModelFacts = { sources: {} }
  const providerLabel = getProviderMetadata(query.provider)?.displayName ?? query.provider

  // 0. Observed tool reliability — decisive evidence only, `supportsTools` only.
  if (query.routeProfileIds && query.routeProfileIds.length > 0) {
    const observed = await observeToolReliability(query.routeProfileIds)
    facts.toolReliability = observed
    if (observed.verdict !== 'inconclusive') {
      facts.supportsTools = observed.verdict === 'reliable'
      facts.sources.supportsTools = { kind: 'observed', label: describeToolReliability(observed) }
    }
  }

  // 1. The provider's live catalog.
  try {
    const live = await readLiveCatalog(query)
    if (live) {
      const entry = findModelEntry(live, query.modelName)
      if (entry) {
        absorb(facts, fromModelInfo(entry), { kind: 'provider-catalog', label: `${providerLabel}'s model catalog` }, ALL_FIELDS)
      } else {
        logger.debug('[ModelCatalog] Model not in live catalog', {
          provider: query.provider,
          modelName: query.modelName,
          catalogSize: live.length,
        })
      }
    }
  } catch (error) {
    facts.catalogError = error instanceof Error ? error.message : String(error)
    logger.warn('[ModelCatalog] Live catalog unavailable', {
      provider: query.provider,
      error: facts.catalogError,
    })
  }

  // 2. The plugin's static table.
  const staticEntry = findModelEntry(getStaticModelInfo(query.provider), query.modelName)
  if (staticEntry) {
    absorb(facts, fromModelInfo(staticEntry), { kind: 'plugin-table', label: `the ${providerLabel} plugin's model table` }, ALL_FIELDS)
  }

  // 3. OpenRouter's public catalog — upstream limits; route capabilities only for OpenRouter itself.
  const needsUpstream = facts.maxContext === undefined || facts.maxTokens === undefined
    || (query.provider === 'OPENROUTER' && (facts.supportsTools === undefined || facts.supportsImages === undefined))
  if (needsUpstream) {
    try {
      const upstream = await findOpenRouterPublicModel(query.provider, query.modelName)
      if (upstream) {
        const allowed: ModelFactField[] = query.provider === 'OPENROUTER'
          ? ['maxContext', 'maxTokens', 'supportsTools', 'supportsImages']
          : ['maxContext', 'maxTokens']
        absorb(
          facts,
          {
            maxContext: upstream.contextLength,
            maxTokens: upstream.maxCompletionTokens,
            supportsTools: upstream.supportsTools,
            supportsImages: upstream.supportsVision,
          },
          { kind: 'openrouter-public', label: `OpenRouter's public catalog (${upstream.modelId})` },
          allowed
        )
      }
    } catch (error) {
      logger.debug('[ModelCatalog] OpenRouter public lookup failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.debug('[ModelCatalog] Facts gathered', {
    provider: query.provider,
    modelName: query.modelName,
    known: Object.keys(facts.sources),
    catalogError: facts.catalogError,
    toolReliability: facts.toolReliability?.verdict,
  })
  return facts
}
