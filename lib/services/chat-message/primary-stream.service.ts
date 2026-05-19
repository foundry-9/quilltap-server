/**
 * Primary Stream Service
 *
 * Wraps the orchestrator's initial `streamMessage` call — the very first
 * LLM turn after the slate has been assembled — plus the two recovery
 * branches that fork off of its error path:
 *
 *   1. **Tool-unsupported retry.** If the upstream rejects function calling
 *      (e.g. some Gemini 3 variants), retry the exact same request with
 *      `tools: []` once before giving up.
 *   2. **Request-limit recovery.** If the upstream signals a recoverable
 *      request error (token-limit overrun, PDF page cap, etc.), delegate
 *      to `attemptRequestLimitRecovery`. On success that returns a fully-
 *      finalized message, so the orchestrator must short-circuit; this
 *      service surfaces that via the `earlyReturn` field on its result.
 *
 * The pre-stream "Sending to..." status, the streaming/responding status
 * gate that flips on the first content chunk, and the previousResponseId
 * extraction all live here. Mutations: `streaming.fullResponse`,
 * `streaming.usage`, `streaming.cacheUsage`, `streaming.attachmentResults`,
 * `streaming.rawResponse`, `streaming.thoughtSignature`, and
 * `streaming.hasStartedStreaming` are written in place.
 *
 * `makePreservePartialOnError` builds the idempotent partial-preserver that
 * every streamMessage callsite in the orchestrator (and its extracted
 * siblings) shares. The closure preserves `streaming.fullResponse` (with an
 * OOC marker explaining the abrupt end) to the DB exactly once across the
 * whole turn — subsequent callers no-op.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeContentChunk,
  encodeStatusEvent,
  safeEnqueue,
  streamMessage,
  type StreamOptions,
} from './streaming.service'
import { saveAssistantMessage } from './message-finalizer.service'
import { attemptRequestLimitRecovery } from './recovery.service'
import { isRecoverableRequestError, isToolUnsupportedError } from '@/lib/llm/errors'
import { stripCharacterNamePrefix, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'

import type { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatMetadataBase, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { AttachedFile, ProcessMessageResult, StreamingState } from './types'

const logger = createServiceLogger('PrimaryStream')

export interface MakePreservePartialOnErrorOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  character: Character
  characterParticipant: { id: string }
  streaming: StreamingState
  preGeneratedAssistantMessageId: string
}

/**
 * Build the per-turn partial-response preserver. The returned closure is
 * idempotent across all callsites for the lifetime of the turn — the first
 * call that finds streamed content writes it to the DB with an OOC marker;
 * subsequent calls early-return so the original error still propagates.
 */
export function makePreservePartialOnError(
  opts: MakePreservePartialOnErrorOptions
): (error: unknown) => Promise<void> {
  const { repos, chatId, character, characterParticipant, streaming, preGeneratedAssistantMessageId } = opts
  let partialPreserved = false

  return async function preservePartialOnError(error: unknown): Promise<void> {
    if (partialPreserved) return
    if (!streaming.hasStartedStreaming || streaming.fullResponse.length === 0) {
      return
    }
    partialPreserved = true
    const errorReason = error instanceof Error ? error.message : String(error)
    const normalizedPartial = normalizeContentBlockFormat(streaming.fullResponse)
    const cleanedPartial = stripCharacterNamePrefix(normalizedPartial, character.name, character.aliases)
    const preservedContent = `${cleanedPartial.trimEnd()}\n\n{{OOC: stream ended abruptly (${errorReason})}}`

    try {
      const preservedMessageId = await saveAssistantMessage(
        repos,
        chatId,
        character,
        characterParticipant,
        preservedContent,
        streaming.usage,
        streaming.rawResponse,
        streaming.thoughtSignature,
        [],
        [],
        preGeneratedAssistantMessageId,
        streaming.effectiveProfile.provider,
        streaming.effectiveProfile.modelName
      )
      logger.info('Preserved partial streamed response after upstream error', {
        chatId,
        messageId: preservedMessageId,
        characterId: character.id,
        characterName: character.name,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        partialLength: streaming.fullResponse.length,
        error: errorReason,
      })
    } catch (persistError) {
      logger.error('Failed to persist partial streamed response', {
        chatId,
        characterId: character.id,
        error: persistError instanceof Error ? persistError.message : String(persistError),
        originalError: errorReason,
      })
    }
  }
}

export interface RunPrimaryStreamOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string }
  userParticipantId: string | null
  isMultiCharacter: boolean
  formattedMessages: StreamOptions['messages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  previousResponseId?: string
  preGeneratedAssistantMessageId: string
  attachedFiles: AttachedFile[]
  originalMessage?: string
  /** Connection profile used for recovery (matches `streaming.effectiveProfile`). */
  connectionProfile: ConnectionProfile
  /** Mutated in place. */
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preservePartialOnError: (error: unknown) => Promise<void>
}

export interface PrimaryStreamResult {
  /** Set when `attemptRequestLimitRecovery` handled the whole request and
   * the orchestrator should short-circuit instead of continuing into the
   * native tool loop. */
  earlyReturn?: ProcessMessageResult
}

/**
 * Run the orchestrator's primary (post-context-build) stream, including the
 * tool-unsupported retry-without-tools and the request-limit recovery
 * branches.
 */
export async function runPrimaryStream(opts: RunPrimaryStreamOptions): Promise<PrimaryStreamResult> {
  const {
    chatId, userId, chat, character, characterParticipant, userParticipantId, isMultiCharacter,
    formattedMessages, modelParams, actualTools, useNativeWebSearch,
    previousResponseId, preGeneratedAssistantMessageId,
    attachedFiles, originalMessage, connectionProfile,
    streaming, controller, encoder, preservePartialOnError,
    repos,
  } = opts

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  try {
    for await (const chunk of streamMessage({
      messages: formattedMessages,
      connectionProfile: streaming.effectiveProfile,
      apiKey: streaming.effectiveApiKey,
      modelParams,
      tools: actualTools,
      useNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
      characterId: character.id,
      previousResponseId,
    })) {
      if (chunk.content) {
        if (!streaming.hasStartedStreaming) {
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'streaming',
            message: `${character.name} is responding...`,
            characterName: character.name,
            characterId: character.id,
          }))
          streaming.hasStartedStreaming = true
        }
        streaming.fullResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        streaming.usage = chunk.usage || null
        streaming.cacheUsage = chunk.cacheUsage || null
        streaming.attachmentResults = chunk.attachmentResults || null
        streaming.rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          streaming.thoughtSignature = chunk.thoughtSignature
        }
      }
    }
  } catch (streamingError) {
    // Tool-unsupported retry: e.g. Gemini 3 variants reject function calling.
    // Retry the same request with `tools: []` once before giving up.
    if (isToolUnsupportedError(streamingError) && actualTools.length > 0) {
      logger.warn('Model does not support function calling, retrying without tools', {
        chatId,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        toolCount: actualTools.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'sending',
        message: `Retrying without tools for ${character.name}...`,
        characterName: character.name,
        characterId: character.id,
      }))

      try {
        for await (const chunk of streamMessage({
          messages: formattedMessages,
          connectionProfile: streaming.effectiveProfile,
          apiKey: streaming.effectiveApiKey,
          modelParams,
          tools: [],
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
            if (!streaming.hasStartedStreaming) {
              safeEnqueue(controller, encodeStatusEvent(encoder, {
                stage: 'streaming',
                message: `${character.name} is responding...`,
                characterName: character.name,
                characterId: character.id,
              }))
              streaming.hasStartedStreaming = true
            }
            streaming.fullResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streaming.usage = chunk.usage || null
            streaming.cacheUsage = chunk.cacheUsage || null
            streaming.attachmentResults = chunk.attachmentResults || null
            streaming.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streaming.thoughtSignature = chunk.thoughtSignature
            }
          }
        }

        logger.info('Tool-unsupported retry succeeded. Consider configuring text-block tools for this model.', {
          chatId,
          provider: streaming.effectiveProfile.provider,
          model: streaming.effectiveProfile.modelName,
          responseLength: streaming.fullResponse.length,
        })
        return {}
      } catch (retryError) {
        logger.error('Tool-unsupported retry also failed', {
          chatId,
          provider: streaming.effectiveProfile.provider,
          model: streaming.effectiveProfile.modelName,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        })
        await preservePartialOnError(retryError)
        throw retryError
      }
    }
    // Request-limit recovery: token-limit / PDF-page-cap / etc. attemptRequestLimitRecovery
    // produces a fully-finalized assistant message on success, so the
    // orchestrator must short-circuit via earlyReturn.
    else if (isRecoverableRequestError(streamingError)) {
      logger.info('Recoverable request error detected, attempting recovery', {
        chatId,
        provider: streaming.effectiveProfile.provider,
        model: streaming.effectiveProfile.modelName,
        attachmentCount: attachedFiles.length,
        error: streamingError instanceof Error ? streamingError.message : String(streamingError),
      })

      const recoveryResult = await attemptRequestLimitRecovery({
        controller,
        encoder,
        character,
        connectionProfile,
        apiKey: streaming.effectiveApiKey,
        attachedFiles,
        originalMessage,
        error: streamingError,
        repos,
        chatId,
        userId,
        characterParticipantId: characterParticipant.id,
      })

      if (recoveryResult.success) {
        logger.info('Request limit recovery successful', {
          chatId,
          messageId: recoveryResult.messageId,
          isStaticFallback: recoveryResult.isStaticFallback,
        })
        return {
          earlyReturn: {
            isMultiCharacter,
            hasContent: true,
            messageId: recoveryResult.messageId || null,
            userParticipantId,
            isPaused: chat.isPaused,
          },
        }
      }

      logger.warn('Request limit recovery failed, propagating error', { chatId })
    }

    await preservePartialOnError(streamingError)
    throw streamingError
  }

  return {}
}

/**
 * Convenience: extract the OpenAI Responses API previousResponseId from the
 * most recent assistant message in `existingMessages`. Returns `undefined`
 * for any other provider or when no chainable response is found.
 */
export function findPreviousResponseId(
  provider: string,
  existingMessages: MessageEvent[]
): string | undefined {
  if (provider !== 'OPENAI') return undefined
  for (let i = existingMessages.length - 1; i >= 0; i--) {
    const msg = existingMessages[i]
    if (msg.type === 'message' && msg.role === 'ASSISTANT' && msg.rawResponse) {
      const raw = msg.rawResponse as Record<string, unknown>
      if (typeof raw.id === 'string' && raw.id.startsWith('resp_')) {
        return raw.id
      }
    }
  }
  return undefined
}
