/**
 * Auto-Configure Service
 *
 * Fills in a connection profile's settings for a provider and model, taking
 * known quantities from structured sources first and asking an LLM only for
 * what those cannot answer.
 *
 * Flow:
 * 1. Gather facts from `lookupModelFacts` (`lib/llm/model-catalog.ts`): what
 *    the route's own logs show of native tool calls (observed reliability),
 *    the provider's live catalog, the plugin's model table, OpenRouter's
 *    public catalog. These settle context, output, tool and image support
 *    where stated, and are never overruled by the LLM. When native tools are
 *    observed to fail, the result recommends Simple JSON.
 * 2. Web-search (when configured) for whatever the facts leave open — limits
 *    only if unknown, sampling settings always — by the upstream model's name.
 * 3. Ask the default (high-capability) LLM for the rest; a cheap LLM repairs
 *    unparseable JSON.
 * 4. Merge, derive the model class from the final limits, and report the
 *    source of every field.
 *
 * @module services/auto-configure
 */

import { executeWebSearchTool, formatWebSearchResults } from '@/lib/tools/handlers/web-search-handler'
import { withReasoningHeadroom } from '@/lib/llm/reasoning-headroom'
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { createLLMProvider } from '@/lib/llm'
import { parseLLMJson } from '@/lib/llm/llm-json'
import { getCheapLLMProvider, profileParams } from '@/lib/llm/cheap-llm'
import { MODEL_CLASSES } from '@/lib/llm/model-classes'
import { lookupModelFacts, type ModelFacts, type ModelFactSource } from '@/lib/llm/model-catalog'
import { sameRouteProfileIds } from '@/lib/llm/tool-reliability'
import { getProviderMetadata } from '@/lib/plugins/provider-registry'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { logger } from '@/lib/logger'
import type { LLMMessage } from '@/lib/llm/base'
import type { ConnectionProfile } from '@/lib/schemas/types'

/** The fields Auto-Configure sets, each reported with its source. */
export type AutoConfigureField =
  | 'maxContext'
  | 'maxTokens'
  | 'temperature'
  | 'topP'
  | 'isDangerousCompatible'
  | 'modelClass'
  | 'supportsTools'
  | 'supportsImages'

/**
 * What to configure: the profile's provider and model, plus the route it
 * reaches them by (base URL and key), which decides what its catalog says.
 */
export interface AutoConfigureTarget {
  provider: string
  modelName: string
  baseUrl?: string | null
  apiKeyId?: string | null
}

/**
 * Result of auto-configuration analysis
 */
export interface AutoConfigureResult {
  /** Maximum context window size in tokens */
  maxContext: number
  /** Maximum output/completion tokens */
  maxTokens: number
  /** Recommended temperature setting (0-2) */
  temperature: number
  /** Recommended top_p / nucleus sampling setting (0-1) */
  topP: number
  /** Whether this model is known to be uncensored / unmoderated */
  isDangerousCompatible: boolean
  /** Recommended model class tier name, derived from the limits */
  modelClass: string
  /** Native tool calling on this route: true / false when a catalog says, null when unknown */
  supportsTools: boolean | null
  /** Image input on this route: true / false when a catalog says, null when unknown */
  supportsImages: boolean | null
  /**
   * A tool-mode recommendation: 'simple-json' when the route is known to lack
   * native tool calling — a catalog says so, or its own logs show native
   * calls failing — otherwise null (leave the profile's mode alone).
   */
  pseudoToolMode: 'simple-json' | null
  /** Where each field came from */
  fieldSources: Record<AutoConfigureField, ModelFactSource>
  /** Source URLs used for the analysis */
  searchSources: string[]
  /** Why the provider's live catalog could not be read, when it was tried and failed */
  catalogError?: string
}

/** The LLM's half of the answer, before facts are laid over it. */
interface EstimatedSettings {
  maxContext: number
  maxTokens: number
  temperature: number
  topP: number
  isDangerousCompatible: boolean
}

const ESTIMATED: ModelFactSource = { kind: 'estimated', label: 'estimated from web search and model knowledge' }
const DEFAULTED: ModelFactSource = { kind: 'default', label: 'default (nothing better was available)' }
const DERIVED: ModelFactSource = { kind: 'derived', label: 'derived from the context and output limits' }

/**
 * The model class whose limits fit: the smallest tier holding both the
 * context window and the output limit, rounding up; the largest tier when
 * nothing holds them.
 */
export function deriveModelClass(maxContext: number, maxTokens: number): string {
  const ordered = [...MODEL_CLASSES].sort((a, b) => a.quality - b.quality)
  const fit = ordered.find(mc => maxContext <= mc.maxContext && maxTokens <= mc.maxOutput)
  return (fit ?? ordered[ordered.length - 1]).name
}

/**
 * The upstream model's name for searching: an aggregator's `vendor/model`
 * id names the vendor itself; a direct provider's bare id is qualified by
 * the provider's name.
 */
function searchSubject(provider: string, modelName: string): string {
  if (modelName.includes('/')) {
    return modelName.replace(/\//g, ' ').replace(/:/g, ' ').trim()
  }
  const displayName = getProviderMetadata(provider)?.displayName ?? provider
  return `${displayName} ${modelName}`
}

function describeKnownFacts(facts: ModelFacts): string {
  const lines: string[] = []
  if (facts.maxContext !== undefined) lines.push(`- maxContext: ${facts.maxContext} (from ${facts.sources.maxContext?.label})`)
  if (facts.maxTokens !== undefined) lines.push(`- maxTokens: ${facts.maxTokens} (from ${facts.sources.maxTokens?.label})`)
  return lines.length > 0 ? lines.join('\n') : '(none — estimate every field)'
}

/**
 * Build the system prompt for the analysis LLM
 */
function buildSystemPrompt(): string {
  return `You are an AI model specifications analyst. Given web search results about an LLM model, you extract precise technical specifications and recommend optimal settings.

You MUST respond with a single JSON object and nothing else. No markdown, no explanation, no code fences. Just the raw JSON object.

The JSON object must have exactly these fields:
{
  "maxContext": <number - maximum context window in tokens>,
  "maxTokens": <number - maximum output/completion tokens>,
  "temperature": <number - recommended temperature between 0 and 2, optimized for creative writing and roleplay>,
  "topP": <number - recommended top_p between 0 and 1, optimized for creative writing and roleplay>,
  "isDangerousCompatible": <boolean - true if the model is known to be uncensored, unmoderated, or explicitly designed without content filters>
}

Some fields may be given to you as known facts, read from the provider's own catalog. Repeat those values exactly; do not second-guess them.

The model may be reached through an aggregator or a router (the "Provider" below) rather than its maker. Specifications in search results usually describe the maker's own API; where they conflict with a known fact, the fact wins.

For temperature and topP, optimize for creative writing, storytelling, and roleplay — the primary use case is an AI writing assistant. Prefer settings that produce varied, engaging prose without being incoherent.

If you cannot determine a value from the search results, use reasonable defaults based on common knowledge of the model.`
}

/**
 * Build the user prompt with search results
 */
function buildUserPrompt(
  provider: string,
  modelName: string,
  facts: ModelFacts,
  specsSearchResults: string | null,
  settingsSearchResults: string
): string {
  const specsSection = specsSearchResults === null
    ? ''
    : `\n## Search Results: Model Specifications\n${specsSearchResults}\n`
  return `Analyze the following model and determine its optimal configuration:

Provider: ${provider}
Model: ${modelName}

## Known facts (authoritative)
${describeKnownFacts(facts)}
${specsSection}
## Search Results: Recommended Settings
${settingsSearchResults}

Respond with the JSON object only.`
}

/**
 * Validate and clamp the LLM's estimate to safe ranges
 */
function validateResult(raw: Record<string, unknown>): EstimatedSettings {
  const maxContext = Math.max(1, Math.round(Number(raw.maxContext) || 4096))
  const maxTokens = Math.max(1, Math.round(Number(raw.maxTokens) || 4096))
  const temperature = Math.min(2, Math.max(0, Number(raw.temperature) || 0.7))
  const topP = Math.min(1, Math.max(0, Number(raw.topP) || 1))
  const isDangerousCompatible = Boolean(raw.isDangerousCompatible)

  return { maxContext, maxTokens, temperature, topP, isDangerousCompatible }
}

/**
 * Get the decrypted API key for a connection profile.
 * Returns '' for OLLAMA (no key needed).
 */
async function getApiKey(profile: ConnectionProfile, userId: string): Promise<string> {
  if (profile.provider === 'OLLAMA') {
    return ''
  }
  if (!profile.apiKeyId) {
    throw new Error(`Profile "${profile.name}" has no API key configured`)
  }
  const repos = getUserRepositories(userId)
  const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
  if (!apiKey) {
    throw new Error(`Could not retrieve API key for profile "${profile.name}"`)
  }
  return apiKey.key_value
}

/**
 * Pick candidate profiles for auto-configure analysis, ordered by preference.
 *
 * Order:
 * 1. The default profile (respects the user's choice).
 * 2. For each other provider, its highest-`modelClass` profile.
 *
 * Profiles without an API key are skipped unless they are OLLAMA.
 */
function pickAutoConfigureCandidates(
  allProfiles: ConnectionProfile[],
  defaultProfile: ConnectionProfile
): ConnectionProfile[] {
  const tierRank = (name: string | null | undefined): number => {
    if (!name) return -1
    const mc = MODEL_CLASSES.find(c => c.name === name)
    return mc ? mc.quality : -1
  }

  const eligible = allProfiles.filter(p => p.provider === 'OLLAMA' || !!p.apiKeyId)

  // Highest-tier profile per provider (excluding the default's provider, which the default already represents).
  const bestByProvider = new Map<string, ConnectionProfile>()
  for (const p of eligible) {
    if (p.provider === defaultProfile.provider) continue
    const current = bestByProvider.get(p.provider)
    if (!current || tierRank(p.modelClass) > tierRank(current.modelClass)) {
      bestByProvider.set(p.provider, p)
    }
  }

  const others = Array.from(bestByProvider.values()).sort(
    (a, b) => tierRank(b.modelClass) - tierRank(a.modelClass)
  )

  return [defaultProfile, ...others]
}

/**
 * Attempt to clean up a malformed LLM response using a cheap LLM
 */
async function cleanupWithCheapLLM(
  rawResponse: string,
  currentProfile: ConnectionProfile,
  allProfiles: ConnectionProfile[],
  userId: string
): Promise<EstimatedSettings> {
  logger.info('[Auto-Configure] Primary parse failed, attempting cheap LLM cleanup', {
    responsePreview: rawResponse.substring(0, 200),
  })

  const cheapSelection = getCheapLLMProvider(currentProfile, undefined, allProfiles)
  const cheapProvider = await createLLMProvider(cheapSelection.provider, cheapSelection.baseUrl)

  let cheapApiKey = ''
  if (!cheapSelection.isLocal && cheapSelection.connectionProfileId) {
    const repos = getUserRepositories(userId)
    const cheapProfile = await repos.connections.findById(cheapSelection.connectionProfileId)
    if (cheapProfile?.apiKeyId) {
      const key = await repos.connections.findApiKeyById(cheapProfile.apiKeyId)
      if (key) cheapApiKey = key.key_value
    }
  }

  const cleanupMessages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a JSON repair assistant. Extract and return ONLY a valid JSON object from the following text. The JSON must have these fields: maxContext (number), maxTokens (number), temperature (number), topP (number), isDangerousCompatible (boolean). Return the JSON object only, no markdown or explanation.',
    },
    {
      role: 'user',
      content: rawResponse,
    },
  ]

  const cleanupStartedAt = Date.now()
  const cleanupResponse = await cheapProvider.sendMessage(
    { messages: cleanupMessages, model: cheapSelection.modelName, temperature: 0.1, maxTokens: withReasoningHeadroom(500), profileParameters: cheapSelection.profileParameters },
    cheapApiKey
  )
  const cleanupDurationMs = Date.now() - cleanupStartedAt

  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: cheapSelection.provider,
    modelName: cheapSelection.modelName,
    connectionProfileId: cheapSelection.connectionProfileId ?? null,
    request: {
      messages: cleanupMessages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.1,
      maxTokens: withReasoningHeadroom(500),
    },
    response: { content: cleanupResponse.content },
    usage: cleanupResponse.usage,
    cacheUsage: cleanupResponse.cacheUsage,
    durationMs: cleanupDurationMs,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log cheap LLM cleanup call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  const parsed = parseLLMJson<Record<string, unknown>>(cleanupResponse.content)
  return validateResult(parsed)
}

/**
 * Run the analysis LLM call against a single profile and parse the result.
 * Falls back to cheap-LLM JSON cleanup on parse failure. Throws on any failure.
 */
async function analyzeWithProfile(
  profile: ConnectionProfile,
  messages: LLMMessage[],
  userId: string,
  allProfiles: ConnectionProfile[]
): Promise<EstimatedSettings> {
  const apiKey = await getApiKey(profile, userId)
  const llmProvider = await createLLMProvider(profile.provider, profile.baseUrl ?? undefined)

  const startedAt = Date.now()
  const response = await llmProvider.sendMessage(
    { messages, model: profile.modelName, temperature: 0.2, maxTokens: 1000, profileParameters: profileParams(profile) },
    apiKey
  )
  const durationMs = Date.now() - startedAt

  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: profile.provider,
    modelName: profile.modelName,
    connectionProfileId: profile.id,
    request: {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.2,
      maxTokens: 1000,
    },
    response: { content: response.content },
    usage: response.usage,
    cacheUsage: response.cacheUsage,
    durationMs,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log LLM call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  try {
    const parsed = parseLLMJson<Record<string, unknown>>(response.content)
    return validateResult(parsed)
  } catch (primaryError) {
    return await cleanupWithCheapLLM(response.content, profile, allProfiles, userId).catch(cleanupError => {
      logger.warn('[Auto-Configure] Primary and cleanup parsing both failed for profile', {
        profileId: profile.id,
        provider: profile.provider,
        modelName: profile.modelName,
        primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
      throw new Error(
        `Failed to parse response from ${profile.provider}: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
      )
    })
  }
}

/**
 * The decrypted key a target reaches its provider with, or '' when it has
 * none (keyless providers, a new profile with no key chosen yet, a key that
 * no longer resolves). A missing key only costs the live catalog.
 */
async function resolveTargetApiKey(target: AutoConfigureTarget, userId: string): Promise<string> {
  if (!target.apiKeyId) return ''
  try {
    const key = await getUserRepositories(userId).connections.findApiKeyById(target.apiKeyId)
    return key?.key_value ?? ''
  } catch (error) {
    logger.warn('[Auto-Configure] Could not read the target profile\'s API key; skipping its live catalog', {
      provider: target.provider,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

/**
 * The ids of the user's profiles on the target's route (provider, model and
 * base URL), whose logs are the observed tool evidence. Empty when they
 * cannot be read: the observation is only skipped.
 */
async function resolveRouteProfileIds(target: AutoConfigureTarget, userId: string): Promise<string[]> {
  try {
    const profiles = await getUserRepositories(userId).connections.findAll()
    const ids = sameRouteProfileIds(profiles, target)
    logger.debug('[Auto-Configure] Route profiles for observed tool reliability', {
      provider: target.provider,
      modelName: target.modelName,
      profiles: ids.length,
    })
    return ids
  } catch (error) {
    logger.warn('[Auto-Configure] Could not list profiles; skipping observed tool reliability', {
      provider: target.provider,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * Ask the analysis LLMs for an estimate, trying the default profile and then
 * one profile per other provider. Returns null (with the reasons logged) when
 * no profile is configured or every candidate fails.
 */
async function estimateWithLLM(
  messages: LLMMessage[],
  userId: string
): Promise<{ estimate: EstimatedSettings | null; failures: string[] }> {
  const repos = getUserRepositories(userId)
  const defaultProfile = await repos.connections.findDefault()
  if (!defaultProfile) {
    return { estimate: null, failures: ['No default connection profile configured.'] }
  }

  const allProfiles = await repos.connections.findAll()
  const candidates = pickAutoConfigureCandidates(allProfiles, defaultProfile)
  const failures: string[] = []

  for (const candidate of candidates) {
    try {
      logger.info('[Auto-Configure] Attempting analysis', {
        provider: candidate.provider,
        modelName: candidate.modelName,
        isDefault: candidate.id === defaultProfile.id,
      })
      const estimate = await analyzeWithProfile(candidate, messages, userId, allProfiles)
      if (candidate.id !== defaultProfile.id) {
        logger.info('[Auto-Configure] Default profile failed, succeeded with fallback', {
          fallbackProvider: candidate.provider,
          fallbackModel: candidate.modelName,
        })
      }
      return { estimate, failures }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`${candidate.provider} (${candidate.modelName}): ${message}`)
      logger.warn('[Auto-Configure] Candidate failed, trying next', {
        provider: candidate.provider,
        modelName: candidate.modelName,
        error: message,
      })
    }
  }

  return { estimate: null, failures }
}

/**
 * Auto-configure a connection profile: known facts first, web search and an
 * LLM for the rest.
 *
 * Throws only when neither the facts nor any LLM could supply the context and
 * output limits; sampling settings fall back to defaults when no LLM answers.
 *
 * @param target - The profile's provider, model, base URL and key
 * @param userId - The authenticated user's ID
 * @returns Recommended settings for the connection profile, with sources
 */
export async function autoConfigureProfile(
  target: AutoConfigureTarget,
  userId: string
): Promise<AutoConfigureResult> {
  const { provider, modelName } = target
  const baseUrl = target.baseUrl || undefined
  logger.info('[Auto-Configure] Starting auto-configuration', { provider, modelName, hasBaseUrl: !!baseUrl, userId })

  // 1. Known facts.
  const [apiKey, routeProfileIds] = await Promise.all([
    resolveTargetApiKey(target, userId),
    resolveRouteProfileIds(target, userId),
  ])
  const facts = await lookupModelFacts({ provider, modelName, apiKey, baseUrl, routeProfileIds })
  const limitsKnown = facts.maxContext !== undefined && facts.maxTokens !== undefined

  // 2. Web search for what the facts leave open.
  const searchSources: string[] = []
  let specsFormatted: string | null = null
  let settingsFormatted = 'Web search is not configured; rely on common knowledge of the model.'

  if (await isWebSearchConfigured(userId)) {
    const subject = searchSubject(provider, modelName)
    const searchContext = { userId }
    const [specsSearch, settingsSearch] = await Promise.all([
      limitsKnown
        ? Promise.resolve(null)
        : executeWebSearchTool(
            { query: `${subject} context window maximum output tokens specifications`, maxResults: 5 },
            searchContext
          ),
      executeWebSearchTool(
        { query: `${subject} recommended temperature top_p settings creative writing`, maxResults: 5 },
        searchContext
      ),
    ])

    if (specsSearch?.success && specsSearch.results) {
      searchSources.push(...specsSearch.results.map(r => r.url).filter(Boolean))
    }
    if (settingsSearch.success && settingsSearch.results) {
      searchSources.push(...settingsSearch.results.map(r => r.url).filter(Boolean))
    }

    if (specsSearch) {
      specsFormatted = specsSearch.success && specsSearch.results
        ? formatWebSearchResults(specsSearch.results)
        : 'No search results found for model specifications.'
    }
    settingsFormatted = settingsSearch.success && settingsSearch.results
      ? formatWebSearchResults(settingsSearch.results)
      : 'No search results found for recommended settings.'
  } else {
    logger.info('[Auto-Configure] Web search not configured; using catalog facts and model knowledge only', {
      provider,
      modelName,
    })
  }

  // 3. The LLM's estimate.
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(provider, modelName, facts, specsFormatted, settingsFormatted) },
  ]
  const { estimate, failures } = await estimateWithLLM(messages, userId)

  if (!estimate && !limitsKnown) {
    throw new Error(
      `Auto-configure could not find this model's limits in any catalog, and no LLM could estimate them. ${failures.join('; ')}`
    )
  }

  // 4. Merge: facts outrank the estimate; the class follows the limits.
  const fieldSources = {} as Record<AutoConfigureField, ModelFactSource>
  const pick = <T>(field: AutoConfigureField, fact: T | undefined, estimated: T | undefined, fallback: T): T => {
    if (fact !== undefined) {
      fieldSources[field] = facts.sources[field as keyof ModelFacts['sources']] ?? ESTIMATED
      return fact
    }
    if (estimated !== undefined) {
      fieldSources[field] = ESTIMATED
      return estimated
    }
    fieldSources[field] = DEFAULTED
    return fallback
  }

  const maxContext = pick('maxContext', facts.maxContext, estimate?.maxContext, 4096)
  let maxTokens = pick('maxTokens', facts.maxTokens, estimate?.maxTokens, 4096)
  if (maxTokens > maxContext) maxTokens = maxContext
  const temperature = pick('temperature', undefined, estimate?.temperature, 0.7)
  const topP = pick('topP', undefined, estimate?.topP, 1)
  const isDangerousCompatible = pick('isDangerousCompatible', undefined, estimate?.isDangerousCompatible, false)

  const modelClass = deriveModelClass(maxContext, maxTokens)
  fieldSources.modelClass = DERIVED

  const supportsTools = facts.supportsTools ?? null
  fieldSources.supportsTools = facts.sources.supportsTools ?? { kind: 'default', label: 'unknown — no catalog states it' }
  const supportsImages = facts.supportsImages ?? null
  fieldSources.supportsImages = facts.sources.supportsImages ?? { kind: 'default', label: 'unknown — no catalog states it' }

  const result: AutoConfigureResult = {
    maxContext,
    maxTokens,
    temperature,
    topP,
    isDangerousCompatible,
    modelClass,
    supportsTools,
    supportsImages,
    pseudoToolMode: supportsTools === false ? 'simple-json' : null,
    fieldSources,
    searchSources,
    ...(facts.catalogError ? { catalogError: facts.catalogError } : {}),
  }

  logger.info('[Auto-Configure] Auto-configuration complete', {
    provider,
    modelName,
    usedLLM: !!estimate,
    result: {
      maxContext,
      maxTokens,
      temperature,
      topP,
      modelClass,
      isDangerousCompatible,
      supportsTools,
      supportsImages,
    },
    toolReliability: facts.toolReliability,
    sources: Object.fromEntries(Object.entries(fieldSources).map(([k, v]) => [k, v.kind])),
  })

  return result
}

/**
 * The profile changes an Auto-Configure result implies, for a stored
 * profile. Tool mode moves only toward simple-json, and only from 'auto' or
 * 'native' — a mode the operator picked by hand for a flaky route is kept.
 * Image support is written only when a catalog states it.
 */
export function profileUpdateFromAutoConfigure(
  profile: Pick<ConnectionProfile, 'parameters' | 'pseudoToolMode'>,
  result: AutoConfigureResult
): Record<string, unknown> {
  const existingParams = typeof profile.parameters === 'string'
    ? JSON.parse(profile.parameters)
    : (profile.parameters || {})
  const update: Record<string, unknown> = {
    maxContext: result.maxContext,
    maxTokens: result.maxTokens,
    modelClass: result.modelClass,
    isDangerousCompatible: result.isDangerousCompatible,
    parameters: {
      ...existingParams,
      temperature: result.temperature,
      max_tokens: result.maxTokens,
      top_p: result.topP,
    },
  }
  if (result.supportsImages !== null) {
    update.supportsImageUpload = result.supportsImages
  }
  const currentMode = profile.pseudoToolMode ?? 'auto'
  if (result.pseudoToolMode === 'simple-json' && (currentMode === 'auto' || currentMode === 'native')) {
    update.pseudoToolMode = 'simple-json'
  }
  return update
}
