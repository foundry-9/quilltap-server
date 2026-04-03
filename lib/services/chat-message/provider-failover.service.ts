/**
 * Provider Failover Service
 *
 * Handles empty-response retries: first retrying the same provider for likely transient
 * issues, then optionally failing over to an uncensored provider when Concierge
 * Auto-Route is enabled.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

import {
  streamMessage,
  encodeStatusEvent,
  safeEnqueue,
  encodeContentChunk,
} from './streaming.service'
import type { EmptyResponseRecoveryResult } from './types'

const logger = createServiceLogger('ProviderFailover')

export interface AttemptEmptyResponseRecoveryOptions {
  fullResponse: string
  toolMessagesLength: number
  contentWasFlaggedDangerous: boolean
  dangerSettings: DangerousContentSettings
  effectiveProfile: ConnectionProfile
  effectiveApiKey: string
  connectionProfile: ConnectionProfile
  formattedMessages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  hasStartedStreaming: boolean
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
}

interface RestreamResult {
  fullResponse: string
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
  hasStartedStreaming: boolean
}

/**
 * Attempt to recover from an empty assistant response.
 */
export async function attemptEmptyResponseRecovery({
  fullResponse,
  toolMessagesLength,
  contentWasFlaggedDangerous,
  dangerSettings,
  effectiveProfile,
  effectiveApiKey,
  connectionProfile,
  formattedMessages,
  modelParams,
  actualTools,
  useNativeWebSearch,
  userId,
  chatId,
  character,
  controller,
  encoder,
  preGeneratedAssistantMessageId,
  hasStartedStreaming,
  usage,
  cacheUsage,
  attachmentResults,
  rawResponse,
  thoughtSignature,
}: AttemptEmptyResponseRecoveryOptions): Promise<EmptyResponseRecoveryResult> {
  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false

  if (fullResponse.trim().length !== 0 || toolMessagesLength > 0) {
    return {
      fullResponse,
      effectiveProfile,
      effectiveApiKey,
      usage,
      cacheUsage,
      attachmentResults,
      rawResponse,
      thoughtSignature,
      hasStartedStreaming,
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
    }
  }

  if (!contentWasFlaggedDangerous) {
    sameProviderRetryAttempted = true
    logger.warn('[EmptyResponse] Empty response from provider that passed moderation, retrying same provider', {
      chatId,
      provider: effectiveProfile.provider,
      model: effectiveProfile.modelName,
    })

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'retrying',
      message: 'Empty response received — retrying...',
      characterName: character.name,
      characterId: character.id,
    }))

    try {
      const retryResult = await restreamResponse({
        fullResponse,
        connectionProfile: effectiveProfile,
        apiKey: effectiveApiKey,
        formattedMessages,
        modelParams,
        actualTools,
        useNativeWebSearch,
        userId,
        chatId,
        character,
        controller,
        encoder,
        preGeneratedAssistantMessageId,
        hasStartedStreaming,
        usage,
        cacheUsage,
        attachmentResults,
        rawResponse,
        thoughtSignature,
      })

      fullResponse = retryResult.fullResponse
      usage = retryResult.usage
      cacheUsage = retryResult.cacheUsage
      attachmentResults = retryResult.attachmentResults
      rawResponse = retryResult.rawResponse
      thoughtSignature = retryResult.thoughtSignature
      hasStartedStreaming = retryResult.hasStartedStreaming

      if (fullResponse.trim().length > 0) {
        logger.info('[EmptyResponse] Same-provider retry succeeded', {
          chatId,
          provider: effectiveProfile.provider,
          model: effectiveProfile.modelName,
          responseLength: fullResponse.length,
        })
      } else {
        logger.warn('[EmptyResponse] Same-provider retry also returned empty', {
          chatId,
          provider: effectiveProfile.provider,
          model: effectiveProfile.modelName,
        })
      }
    } catch (retryError) {
      logger.error('[EmptyResponse] Same-provider retry failed', {
        chatId,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      })
    }
  }

  if (
    fullResponse.trim().length === 0 &&
    dangerSettings.mode === 'AUTO_ROUTE' &&
    dangerSettings.uncensoredTextProfileId
  ) {
    uncensoredRetryAttempted = true
    logger.warn('[DangerousContent] Empty response detected, attempting uncensored retry', {
      chatId,
      originalProvider: effectiveProfile.provider,
      originalModel: effectiveProfile.modelName,
      contentWasFlaggedDangerous,
      sameProviderRetryAttempted,
    })

    try {
      const routeResult = await resolveProviderForDangerousContent(
        effectiveProfile,
        effectiveApiKey,
        dangerSettings,
        userId
      )

      if (routeResult.rerouted && routeResult.connectionProfile.id === effectiveProfile.id) {
        logger.debug('[DangerousContent] Uncensored fallback resolved to same profile, skipping retry', {
          chatId,
          profileId: effectiveProfile.id,
        })
      } else if (routeResult.rerouted) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'rerouting',
          message: 'Retrying with uncensored provider...',
          characterName: character.name,
          characterId: character.id,
        }))

        const retryResult = await restreamResponse({
          fullResponse,
          connectionProfile: routeResult.connectionProfile,
          apiKey: routeResult.apiKey,
          formattedMessages,
          modelParams,
          actualTools,
          useNativeWebSearch,
          userId,
          chatId,
          character,
          controller,
          encoder,
          preGeneratedAssistantMessageId,
          hasStartedStreaming,
          usage,
          cacheUsage,
          attachmentResults,
          rawResponse,
          thoughtSignature,
        })

        fullResponse = retryResult.fullResponse
        usage = retryResult.usage
        cacheUsage = retryResult.cacheUsage
        attachmentResults = retryResult.attachmentResults
        rawResponse = retryResult.rawResponse
        thoughtSignature = retryResult.thoughtSignature
        hasStartedStreaming = retryResult.hasStartedStreaming

        if (fullResponse.trim().length > 0) {
          effectiveProfile = routeResult.connectionProfile
          effectiveApiKey = routeResult.apiKey

          logger.info('[DangerousContent] Uncensored retry succeeded', {
            chatId,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
            responseLength: fullResponse.length,
          })
        } else {
          logger.error('[DangerousContent] Both safe and uncensored providers returned empty', {
            chatId,
            safeProvider: connectionProfile.provider,
            safeModel: connectionProfile.modelName,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
          })
        }
      }
    } catch (retryError) {
      logger.error('[DangerousContent] Uncensored retry failed', {
        chatId,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      })
    }
  }

  return {
    fullResponse,
    effectiveProfile,
    effectiveApiKey,
    usage,
    cacheUsage,
    attachmentResults,
    rawResponse,
    thoughtSignature,
    hasStartedStreaming,
    uncensoredRetryAttempted,
    sameProviderRetryAttempted,
  }
}

export function getEmptyResponseReason({
  uncensoredRetryAttempted,
  sameProviderRetryAttempted,
  contentWasFlaggedDangerous,
}: {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  contentWasFlaggedDangerous: boolean
}): string {
  if (uncensoredRetryAttempted && sameProviderRetryAttempted) {
    return 'The AI model returned an empty response after retrying, and an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
  }

  if (uncensoredRetryAttempted) {
    return 'The AI model returned an empty response, and retrying with an uncensored provider also returned empty. This may indicate the content was filtered by both providers.'
  }

  if (contentWasFlaggedDangerous) {
    return 'The AI model returned an empty response, likely because the Concierge flagged this content as dangerous and the provider refused to generate a response. Consider enabling Auto-Route mode in the Concierge settings to automatically reroute dangerous content to an uncensored provider.'
  }

  if (sameProviderRetryAttempted) {
    return 'The AI model returned an empty response twice. This may be a temporary issue with the provider. Please try resending your message.'
  }

  return 'The AI model returned an empty response. This is a known issue with some providers. Please try resending your message.'
}

async function restreamResponse({
  fullResponse,
  connectionProfile,
  apiKey,
  formattedMessages,
  modelParams,
  actualTools,
  useNativeWebSearch,
  userId,
  chatId,
  character,
  controller,
  encoder,
  preGeneratedAssistantMessageId,
  hasStartedStreaming,
  usage,
  cacheUsage,
  attachmentResults,
  rawResponse,
  thoughtSignature,
}: {
  fullResponse: string
  connectionProfile: ConnectionProfile
  apiKey: string
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  hasStartedStreaming: boolean
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
}): Promise<RestreamResult> {
  for await (const chunk of streamMessage({
    messages: formattedMessages,
    connectionProfile,
    apiKey,
    modelParams,
    tools: actualTools,
    useNativeWebSearch,
    userId,
    messageId: preGeneratedAssistantMessageId,
    chatId,
  })) {
    if (chunk.content) {
      if (!hasStartedStreaming) {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage: 'streaming',
          message: `${character.name} is responding...`,
          characterName: character.name,
          characterId: character.id,
        }))
        hasStartedStreaming = true
      }
      fullResponse += chunk.content
      controller.enqueue(encodeContentChunk(encoder, chunk.content))
    }

    if (chunk.done) {
      usage = chunk.usage || null
      cacheUsage = chunk.cacheUsage || null
      attachmentResults = chunk.attachmentResults || null
      rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) {
        thoughtSignature = chunk.thoughtSignature
      }
    }
  }

  return {
    fullResponse,
    usage,
    cacheUsage,
    attachmentResults,
    rawResponse,
    thoughtSignature,
    hasStartedStreaming,
  }
}
