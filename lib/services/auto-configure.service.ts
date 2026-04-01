/**
 * Auto-Configure Service
 *
 * Uses web search and LLM analysis to automatically determine optimal
 * settings for a connection profile based on the provider and model name.
 *
 * Flow:
 * 1. Run parallel web searches for model specs and recommended settings
 * 2. Send search results to the default (high-capability) LLM for analysis
 * 3. If the response doesn't parse, send to a cheap LLM for JSON cleanup
 * 4. Validate and return the structured result
 *
 * @module services/auto-configure
 */

import { executeWebSearchTool, formatWebSearchResults } from '@/lib/tools/handlers/web-search-handler'
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { createLLMProvider } from '@/lib/llm'
import { parseLLMJson } from '@/lib/services/ai-import.service'
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm'
import { MODEL_CLASSES, isValidModelClassName } from '@/lib/llm/model-classes'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { logger } from '@/lib/logger'
import type { LLMMessage } from '@/lib/llm/base'
import type { ConnectionProfile } from '@/lib/schemas/types'

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
  /** Recommended model class tier name */
  modelClass: string
  /** Source URLs used for the analysis */
  searchSources: string[]
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
  "isDangerousCompatible": <boolean - true if the model is known to be uncensored, unmoderated, or explicitly designed without content filters>,
  "modelClass": <string - one of: "Compact", "Standard", "Extended", "Deep">
}

For modelClass, use these tier definitions to classify the model:
${MODEL_CLASSES.map(mc => `- ${mc.name} (Tier ${mc.tier}): maxContext <= ${mc.maxContext.toLocaleString()}, maxOutput <= ${mc.maxOutput.toLocaleString()}, quality ${mc.quality}`).join('\n')}

Choose the tier whose context and output limits best fit the model's actual capabilities. If between tiers, round up.

For temperature and topP, optimize for creative writing, storytelling, and roleplay — the primary use case is an AI writing assistant. Prefer settings that produce varied, engaging prose without being incoherent.

If you cannot determine a value from the search results, use reasonable defaults based on common knowledge of the model.`
}

/**
 * Build the user prompt with search results
 */
function buildUserPrompt(
  provider: string,
  modelName: string,
  specsSearchResults: string,
  settingsSearchResults: string
): string {
  return `Analyze the following model and determine its optimal configuration:

Provider: ${provider}
Model: ${modelName}

## Search Results: Model Specifications
${specsSearchResults}

## Search Results: Recommended Settings
${settingsSearchResults}

Respond with the JSON object only.`
}

/**
 * Validate and clamp the auto-configure result to safe ranges
 */
function validateResult(raw: Record<string, unknown>): AutoConfigureResult {
  const maxContext = Math.max(1, Math.round(Number(raw.maxContext) || 4096))
  const maxTokens = Math.max(1, Math.round(Number(raw.maxTokens) || 4096))
  const temperature = Math.min(2, Math.max(0, Number(raw.temperature) || 0.7))
  const topP = Math.min(1, Math.max(0, Number(raw.topP) || 1))
  const isDangerousCompatible = Boolean(raw.isDangerousCompatible)

  let modelClass = String(raw.modelClass || 'Standard')
  if (!isValidModelClassName(modelClass)) {
    modelClass = 'Standard'
  }

  return { maxContext, maxTokens, temperature, topP, isDangerousCompatible, modelClass, searchSources: [] }
}

/**
 * Get the decrypted API key for a connection profile
 */
async function getApiKey(profile: ConnectionProfile, userId: string): Promise<string> {
  if (!profile.apiKeyId) {
    throw new Error('Default profile has no API key configured')
  }
  const repos = getUserRepositories(userId)
  const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
  if (!apiKey) {
    throw new Error('Could not retrieve API key for default profile')
  }
  return apiKey.key_value
}

/**
 * Attempt to clean up a malformed LLM response using a cheap LLM
 */
async function cleanupWithCheapLLM(
  rawResponse: string,
  defaultProfile: ConnectionProfile,
  allProfiles: ConnectionProfile[],
  userId: string
): Promise<AutoConfigureResult> {
  logger.info('[Auto-Configure] Primary parse failed, attempting cheap LLM cleanup', {
    responsePreview: rawResponse.substring(0, 200),
  })

  const cheapSelection = getCheapLLMProvider(defaultProfile, undefined, allProfiles)
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
      content: 'You are a JSON repair assistant. Extract and return ONLY a valid JSON object from the following text. The JSON must have these fields: maxContext (number), maxTokens (number), temperature (number), topP (number), isDangerousCompatible (boolean), modelClass (string). Return the JSON object only, no markdown or explanation.',
    },
    {
      role: 'user',
      content: rawResponse,
    },
  ]

  const cleanupResponse = await cheapProvider.sendMessage(
    { messages: cleanupMessages, model: cheapSelection.modelName, temperature: 0.1, maxTokens: 500 },
    cheapApiKey
  )

  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: cheapSelection.provider,
    modelName: cheapSelection.modelName,
    request: {
      messages: cleanupMessages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.1,
      maxTokens: 500,
    },
    response: { content: cleanupResponse.content },
    usage: cleanupResponse.usage,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log cheap LLM cleanup call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  const parsed = parseLLMJson<Record<string, unknown>>(cleanupResponse.content)
  return validateResult(parsed)
}

/**
 * Auto-configure a connection profile by searching for model specifications
 * and using an LLM to analyze the results.
 *
 * @param provider - The LLM provider name (e.g., 'ANTHROPIC', 'OPENAI')
 * @param modelName - The model identifier (e.g., 'claude-sonnet-4-5-20250929')
 * @param userId - The authenticated user's ID
 * @returns Recommended settings for the connection profile
 */
export async function autoConfigureProfile(
  provider: string,
  modelName: string,
  userId: string
): Promise<AutoConfigureResult> {
  logger.info('[Auto-Configure] Starting auto-configuration', { provider, modelName, userId })

  // Verify web search is available
  if (!isWebSearchConfigured()) {
    throw new Error('Web search is not configured. Please add a search provider API key in Settings to use Auto-Configure.')
  }

  const repos = getUserRepositories(userId)

  // Find the default (high-capability) profile for analysis
  const defaultProfile = await repos.connections.findDefault()
  if (!defaultProfile) {
    throw new Error('No default connection profile configured. Please set a default profile before using Auto-Configure.')
  }

  // Run two web searches in parallel
  const searchContext = { userId }
  const [specsSearch, settingsSearch] = await Promise.all([
    executeWebSearchTool(
      { query: `${provider} ${modelName} maximum context window output tokens specifications`, maxResults: 5 },
      searchContext
    ),
    executeWebSearchTool(
      { query: `${provider} ${modelName} recommended temperature top_p settings creative writing`, maxResults: 5 },
      searchContext
    ),
  ])

  // Collect source URLs for attribution
  const searchSources: string[] = []
  if (specsSearch.success && specsSearch.results) {
    searchSources.push(...specsSearch.results.map(r => r.url).filter(Boolean))
  }
  if (settingsSearch.success && settingsSearch.results) {
    searchSources.push(...settingsSearch.results.map(r => r.url).filter(Boolean))
  }

  // Format search results for the prompt
  const specsFormatted = specsSearch.success && specsSearch.results
    ? formatWebSearchResults(specsSearch.results)
    : 'No search results found for model specifications.'
  const settingsFormatted = settingsSearch.success && settingsSearch.results
    ? formatWebSearchResults(settingsSearch.results)
    : 'No search results found for recommended settings.'

  logger.debug('[Auto-Configure] Web searches completed', {
    specsResults: specsSearch.results?.length ?? 0,
    settingsResults: settingsSearch.results?.length ?? 0,
  })

  // Build the analysis prompt
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(provider, modelName, specsFormatted, settingsFormatted)

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  // Send to the default LLM for analysis
  const apiKey = await getApiKey(defaultProfile, userId)
  const llmProvider = await createLLMProvider(defaultProfile.provider, defaultProfile.baseUrl ?? undefined)

  const response = await llmProvider.sendMessage(
    { messages, model: defaultProfile.modelName, temperature: 0.2, maxTokens: 1000 },
    apiKey
  )

  logger.debug('[Auto-Configure] LLM analysis response received', {
    provider: defaultProfile.provider,
    model: defaultProfile.modelName,
    responseLength: response.content.length,
  })

  // Log the LLM call
  logLLMCall({
    userId,
    type: 'AUTO_CONFIGURE',
    provider: defaultProfile.provider,
    modelName: defaultProfile.modelName,
    request: {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.2,
      maxTokens: 1000,
    },
    response: { content: response.content },
    usage: response.usage,
  }).catch(err => {
    logger.warn('[Auto-Configure] Failed to log LLM call', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  // Parse the response
  let result: AutoConfigureResult
  try {
    const parsed = parseLLMJson<Record<string, unknown>>(response.content)
    result = validateResult(parsed)
  } catch (primaryError) {
    // If primary parse fails, try cheap LLM cleanup
    try {
      const allProfiles = await repos.connections.findAll()
      result = await cleanupWithCheapLLM(response.content, defaultProfile, allProfiles, userId)
    } catch (cleanupError) {
      logger.error('[Auto-Configure] Both primary and cleanup parsing failed', {
        provider,
        modelName,
        primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
      throw new Error('Failed to parse auto-configure results. The LLM response could not be processed.')
    }
  }

  result.searchSources = searchSources

  logger.info('[Auto-Configure] Auto-configuration complete', {
    provider,
    modelName,
    result: {
      maxContext: result.maxContext,
      maxTokens: result.maxTokens,
      temperature: result.temperature,
      topP: result.topP,
      modelClass: result.modelClass,
      isDangerousCompatible: result.isDangerousCompatible,
    },
  })

  return result
}
