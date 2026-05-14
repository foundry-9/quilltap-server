/**
 * Shared execution pipeline for cheap LLM tasks.
 */

import { createLLMProvider } from '@/lib/llm'
import type { LLMMessage, LLMResponse } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import type { CheapLLMTaskResult, UncensoredFallbackOptions } from './types'

/**
 * Internal type for provider response
 */
interface ProviderResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Session-level cache for profiles that don't support custom temperature
 */
const profilesWithoutCustomTemp = new Set<string>()

/**
 * Maps a cheap LLM task type to an LLM log type for logging
 */
function mapTaskTypeToLogType(taskType?: string): LLMLogType {
  const mapping: Record<string, LLMLogType> = {
    'memory-extraction-self': 'MEMORY_EXTRACTION',
    'memory-extraction-other': 'MEMORY_EXTRACTION',
    'batch-memory-extraction': 'MEMORY_EXTRACTION',
    'memory-keyword-extraction': 'MEMORY_EXTRACTION',
    'title-chat': 'TITLE_GENERATION',
    'title-from-summary': 'TITLE_GENERATION',
    'consider-title-update': 'TITLE_GENERATION',
    'compress-conversation-history': 'CONTEXT_COMPRESSION',
    'compress-system-prompt': 'CONTEXT_COMPRESSION',
    'compress-memories': 'CONTEXT_COMPRESSION',
    'summarize-chat': 'SUMMARIZATION',
    'update-context-summary': 'SUMMARIZATION',
    'fold-chat-summary': 'SUMMARIZATION',
    'memory-recap-summarization': 'SUMMARIZATION',
    'derive-scene-context': 'SUMMARIZATION',
    'outfit-selection': 'SUMMARIZATION',
    'craft-image-prompt': 'IMAGE_PROMPT_CRAFTING',
    'craft-story-background-prompt': 'IMAGE_PROMPT_CRAFTING',
    'describe-attachment': 'IMAGE_DESCRIPTION',
    'resolve-character-appearances': 'APPEARANCE_RESOLUTION',
    'sanitize-appearance': 'APPEARANCE_RESOLUTION',
    'scene-state-tracking': 'SCENE_STATE_TRACKING',
  }
  return mapping[taskType || ''] || 'SUMMARIZATION'
}

/**
 * Sends messages to a cheap LLM provider with temperature handling and logging
 * Extracted from executeCheapLLMTask to avoid tripling the code for each temperature path
 */
async function sendToProvider(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  maxTokens?: number,
  characterId?: string
): Promise<ProviderResponse> {
  const apiKey = await getApiKeyForCheapLLMSelection(selection, userId)
  if (apiKey === null) {
    throw new Error('No API key available for cheap LLM provider')
  }

  const provider = await createLLMProvider(
    selection.provider,
    selection.baseUrl
  )

  const profileKey = `${selection.provider}:${selection.modelName}`
  const effectiveMaxTokens = Math.max(maxTokens ?? 2048, 2048)

  const logCall = (response: LLMResponse, temperature?: number) => {
    logLLMCall({
      userId,
      type: mapTaskTypeToLogType(taskType),
      chatId,
      messageId,
      characterId,
      provider: selection.provider,
      modelName: selection.modelName,
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens: effectiveMaxTokens,
      },
      response: {
        content: response.content,
      },
      usage: response.usage,
    }).catch(err => {
      logger.warn('Failed to log cheap LLM call', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  // Cheap LLM tasks use strictMaxTokens to prevent providers from applying
  // model-specific minimums (e.g. reasoning model floors) that would cause
  // unnecessary verbosity and latency for background tasks
  const strictMaxTokens = true

  // Check if we already know this profile doesn't support custom temperature
  if (profilesWithoutCustomTemp.has(profileKey)) {
    const response: LLMResponse = await provider.sendMessage(
      { messages, model: selection.modelName, maxTokens: effectiveMaxTokens, strictMaxTokens },
      apiKey
    )
    logCall(response)
    return { content: response.content, usage: response.usage }
  }

  // Try with lower temperature for more consistent outputs
  try {
    const response: LLMResponse = await provider.sendMessage(
      { messages, model: selection.modelName, temperature: 0.3, maxTokens: effectiveMaxTokens, strictMaxTokens },
      apiKey
    )
    logCall(response, 0.3)
    return { content: response.content, usage: response.usage }
  } catch (error) {
    // If temperature is not supported, cache it and retry with default temperature
    const errorMessage = getErrorMessage(error, '')
    if (errorMessage.includes('temperature') || errorMessage.includes('does not support')) {
      profilesWithoutCustomTemp.add(profileKey)

      const response: LLMResponse = await provider.sendMessage(
        { messages, model: selection.modelName, maxTokens: effectiveMaxTokens, strictMaxTokens },
        apiKey
      )
      logCall(response)
      return { content: response.content, usage: response.usage }
    }
    throw error
  }
}

/**
 * Checks if an uncensored fallback should be attempted for an empty response
 * Returns a CheapLLMSelection for the uncensored provider, or null if fallback should not be attempted
 */
function shouldAttemptUncensoredFallback(
  responseContent: string,
  currentSelection: CheapLLMSelection,
  uncensoredFallback?: UncensoredFallbackOptions
): CheapLLMSelection | null {
  // No fallback if response is not empty
  if (responseContent.trim() !== '') return null

  // No fallback options provided
  if (!uncensoredFallback) return null

  const { dangerSettings, availableProfiles } = uncensoredFallback

  // Only attempt in AUTO_ROUTE mode
  if (dangerSettings.mode !== 'AUTO_ROUTE') return null

  // Need an uncensored text profile configured
  if (!dangerSettings.uncensoredTextProfileId) return null

  // Check if current profile is already dangerous-compatible
  // For dangerous chats, allow uncensored→uncensored fallback on empty (the configured
  // fallback provider may be more reliable than the current one)
  const currentProfile = availableProfiles.find(p => p.id === currentSelection.connectionProfileId)
  if (currentProfile?.isDangerousCompatible && !uncensoredFallback?.isDangerousChat) return null

  // Find the uncensored profile
  const uncensoredProfile = availableProfiles.find(p => p.id === dangerSettings.uncensoredTextProfileId)
  if (!uncensoredProfile) return null

  // Build a CheapLLMSelection for the uncensored profile
  return {
    provider: uncensoredProfile.provider,
    modelName: uncensoredProfile.modelName,
    baseUrl: uncensoredProfile.baseUrl || undefined,
    connectionProfileId: uncensoredProfile.id,
    isLocal: false,
  }
}

/**
 * Executes a cheap LLM task with the given messages
 */
export async function executeCheapLLMTask<T>(
  selection: CheapLLMSelection,
  messages: LLMMessage[],
  userId: string,
  parseResponse: (content: string) => T,
  taskType?: string,
  chatId?: string,
  messageId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  maxTokens?: number,
  characterId?: string
): Promise<CheapLLMTaskResult<T>> {
  try {
    let response = await sendToProvider(selection, messages, userId, taskType, chatId, messageId, maxTokens, characterId)

    // Check if we should retry with an uncensored provider
    const uncensoredSelection = shouldAttemptUncensoredFallback(response.content, selection, uncensoredFallback)
    if (uncensoredSelection) {
      logger.warn('[CheapLLM] Empty response detected, retrying with uncensored provider', {
        taskType,
        chatId,
        originalProvider: selection.provider,
        originalModel: selection.modelName,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
      })

      const retryResponse = await sendToProvider(uncensoredSelection, messages, userId, taskType, chatId, messageId, maxTokens, characterId)

      if (retryResponse.content.trim() === '') {
        throw new Error(`Empty response from both safe provider (${selection.provider}/${selection.modelName}) and uncensored provider (${uncensoredSelection.provider}/${uncensoredSelection.modelName})`)
      }

      logger.info('[CheapLLM] Uncensored fallback succeeded', {
        taskType,
        chatId,
        uncensoredProvider: uncensoredSelection.provider,
        uncensoredModel: uncensoredSelection.modelName,
        responseLength: retryResponse.content.length,
      })

      response = retryResponse
    }

    const result = parseResponse(response.content)

    return {
      success: true,
      result,
      usage: response.usage,
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    }
  }
}
