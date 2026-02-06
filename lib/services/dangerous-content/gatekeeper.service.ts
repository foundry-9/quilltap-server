/**
 * Dangerous Content Gatekeeper Service
 *
 * Uses the cheap LLM to classify content for dangerous/sensitive material.
 * Follows the same cheap LLM execution pattern as lib/memory/cheap-llm-tasks.ts.
 *
 * Fail-safe: Any error returns { isDangerous: false } - never blocks the user.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { getErrorMessage } from '@/lib/errors'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import { createHash } from 'node:crypto'

const logger = createServiceLogger('DangerousContentGatekeeper')

/**
 * Result of content classification
 */
export interface DangerClassificationResult {
  /** Whether the content was classified as dangerous */
  isDangerous: boolean
  /** Overall danger score (0-1) */
  score: number
  /** Per-category breakdown */
  categories: Array<{ category: string; score: number; label: string }>
  /** Token usage for cost tracking */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/**
 * Simple LRU cache for classification results by content hash
 */
const classificationCache = new Map<string, { result: DangerClassificationResult; timestamp: number }>()
const CACHE_MAX_SIZE = 200
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get a cached classification result
 */
function getCachedResult(contentHash: string): DangerClassificationResult | null {
  const cached = classificationCache.get(contentHash)
  if (!cached) return null

  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    classificationCache.delete(contentHash)
    return null
  }

  return cached.result
}

/**
 * Cache a classification result
 */
function cacheResult(contentHash: string, result: DangerClassificationResult): void {
  // Evict oldest entries if at capacity
  if (classificationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = classificationCache.keys().next().value
    if (firstKey) classificationCache.delete(firstKey)
  }

  classificationCache.set(contentHash, { result, timestamp: Date.now() })
}

/**
 * Default classification system prompt
 */
const CLASSIFICATION_SYSTEM_PROMPT = `You are a content safety classifier. Analyze the following user message and determine if it contains dangerous, sensitive, or potentially policy-violating content.

CATEGORIES TO CHECK:
- nsfw: Sexual or explicitly adult content
- violence: Graphic violence, gore, or descriptions of harm
- hate_speech: Hateful, discriminatory, or dehumanizing language
- self_harm: Content encouraging or depicting self-harm
- illegal_activity: Content describing or encouraging illegal activities
- disturbing: Deeply disturbing, shocking, or upsetting content

For each applicable category, provide a confidence score from 0.0 to 1.0.

Respond with JSON ONLY (no markdown, no explanation):
{
  "isDangerous": true/false,
  "score": 0.0-1.0,
  "categories": [
    { "category": "nsfw", "score": 0.0-1.0, "label": "Brief description" }
  ]
}

If the content is completely safe and benign, respond:
{ "isDangerous": false, "score": 0.0, "categories": [] }

Be accurate - don't over-flag normal creative writing, worldbuilding, or historical references.
Only flag content that would genuinely require an uncensored model to handle.`

/**
 * Gets the decrypted API key for a cheap LLM selection
 */
async function getApiKeyForSelection(
  selection: CheapLLMSelection,
  userId: string
): Promise<string | null> {
  if (selection.isLocal) {
    return ''
  }

  if (!selection.connectionProfileId) {
    return null
  }

  const repos = getRepositories()
  const profile = await repos.connections.findById(selection.connectionProfileId)
  if (!profile?.apiKeyId) {
    return null
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
  if (!apiKey) {
    return null
  }

  return decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId)
}

/**
 * Classify content for dangerous/sensitive material using the cheap LLM
 *
 * @param content - The text content to classify
 * @param cheapLLMSelection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param settings - The dangerous content settings
 * @param chatId - Optional chat ID for logging
 * @returns Classification result (fail-safe: returns not dangerous on any error)
 */
export async function classifyContent(
  content: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  settings: DangerousContentSettings,
  chatId?: string
): Promise<DangerClassificationResult> {
  const safeFallback: DangerClassificationResult = {
    isDangerous: false,
    score: 0,
    categories: [],
  }

  try {
    // Check cache first
    const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 16)
    const cached = getCachedResult(contentHash)
    if (cached) {
      logger.debug('[Gatekeeper] Cache hit for content classification', {
        contentHash,
        isDangerous: cached.isDangerous,
      })
      return cached
    }

    // Get API key
    const apiKey = await getApiKeyForSelection(cheapLLMSelection, userId)
    if (apiKey === null) {
      logger.warn('[Gatekeeper] No API key available for classification, failing safe')
      return safeFallback
    }

    // Build classification prompt
    let systemPrompt = CLASSIFICATION_SYSTEM_PROMPT
    if (settings.customClassificationPrompt) {
      systemPrompt += `\n\nADDITIONAL INSTRUCTIONS:\n${settings.customClassificationPrompt}`
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Classify the following content:\n\n${content}` },
    ]

    // Create provider and send message
    const provider = await createLLMProvider(
      cheapLLMSelection.provider,
      cheapLLMSelection.baseUrl
    )

    const response = await provider.sendMessage(
      {
        messages,
        model: cheapLLMSelection.modelName,
        temperature: 0.1, // Low temperature for consistent classification
        maxTokens: 500,
      },
      apiKey
    )

    // Log the classification call (fire and forget)
    logLLMCall({
      userId,
      type: 'DANGER_CLASSIFICATION',
      chatId,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.1,
        maxTokens: 500,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
    }).catch(err => {
      logger.warn('[Gatekeeper] Failed to log classification call', {
        error: err instanceof Error ? err.message : String(err),
      })
    })

    // Parse the response
    const result = parseClassificationResponse(response.content, settings.threshold)
    result.usage = response.usage

    // Cache the result
    cacheResult(contentHash, result)

    logger.info('[Gatekeeper] Content classified', {
      chatId,
      isDangerous: result.isDangerous,
      score: result.score,
      categoryCount: result.categories.length,
      categories: result.categories.map(c => c.category),
    })

    return result
  } catch (error) {
    logger.error('[Gatekeeper] Classification failed, failing safe', {
      chatId,
      error: getErrorMessage(error),
    })
    return safeFallback
  }
}

/**
 * Parse the LLM's classification response
 */
function parseClassificationResponse(
  responseContent: string,
  threshold: number
): DangerClassificationResult {
  try {
    // Clean the response
    let cleanContent = responseContent.trim()
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleanContent)

    const score = typeof parsed.score === 'number' ? parsed.score : 0
    const categories = Array.isArray(parsed.categories)
      ? parsed.categories.map((c: Record<string, unknown>) => ({
          category: String(c.category || 'unknown'),
          score: typeof c.score === 'number' ? c.score : 0,
          label: String(c.label || ''),
        }))
      : []

    return {
      isDangerous: score >= threshold,
      score,
      categories,
    }
  } catch {
    // JSON parsing failed - fail safe
    return {
      isDangerous: false,
      score: 0,
      categories: [],
    }
  }
}
