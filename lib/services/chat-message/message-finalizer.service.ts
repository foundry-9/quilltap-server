/**
 * Message Finalizer Service
 *
 * Handles assistant message persistence, completion events, token tracking,
 * assistant-side RNG auto-detection, and background memory/summary triggers.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { stripCharacterNamePrefix, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { calculateMaxAvailable, CONTEXT_HISTORY_BUDGET_RATIO } from '@/lib/llm/model-context-data'
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'

import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, Character, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { GeneratedImage, NextSpeakerInfo, ProcessMessageResult, StreamingState, CompressionContext, TriggerContext, ToolMessage } from './types'
import { saveToolMessages } from './tool-execution.service'
import { encodeDoneEvent } from './streaming.service'
import {
  triggerMemoryExtraction,
  triggerInterCharacterMemory,
  triggerUserControlledCharacterMemory,
  triggerContextSummaryCheck,
  triggerChatDangerClassification,
  type MemoryChatSettings,
} from './memory-trigger.service'
import { triggerAsyncCompression } from './compression-cache.service'
import { detectAndConvertRngPatterns } from './rng-pattern-detector.service'

const logger = createServiceLogger('MessageFinalizer')

export interface FinalizeMessageResponseOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string; status?: string }
  userParticipantId: string | null
  isMultiCharacter: boolean
  isContinueMode: boolean
  generatedImagePaths: GeneratedImage[]
  toolMessages: ToolMessage[]
  preGeneratedAssistantMessageId?: string
  connectionProfile: ConnectionProfile
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  streaming: StreamingState
  compression: CompressionContext
  triggers: TriggerContext
}

/**
 * Finalize a successful assistant text response.
 */
export async function finalizeMessageResponse({
  repos,
  chatId,
  userId,
  chat,
  character,
  characterParticipant,
  userParticipantId,
  isMultiCharacter,
  isContinueMode,
  generatedImagePaths,
  toolMessages,
  preGeneratedAssistantMessageId,
  connectionProfile,
  controller,
  encoder,
  streaming,
  compression,
  triggers,
}: FinalizeMessageResponseOptions): Promise<ProcessMessageResult> {
  const { fullResponse, effectiveProfile, usage, cacheUsage, attachmentResults, rawResponse, thoughtSignature } = streaming
  const { existingMessages, content, builtContext, compressionEnabled, cheapLLMSelection, contextCompressionSettings, allProfiles } = compression
  const { dangerSettings, chatSettings, participantCharacters, resolvedIdentity, userCharacterId } = triggers
  const normalizedResponse = normalizeContentBlockFormat(fullResponse)
  const cleanedResponse = stripCharacterNamePrefix(normalizedResponse, character.name, character.aliases)

  const assistantMessageId = await saveAssistantMessage(
    repos,
    chatId,
    character,
    characterParticipant,
    cleanedResponse,
    usage,
    rawResponse,
    thoughtSignature,
    generatedImagePaths,
    toolMessages,
    preGeneratedAssistantMessageId,
    effectiveProfile.provider,
    effectiveProfile.modelName
  )

  if (compressionEnabled && cheapLLMSelection && builtContext.originalSystemPrompt) {
    const updatedMessages = [
      ...extractVisibleConversation(existingMessages),
      ...(content && !isContinueMode ? [{
        role: 'user' as const,
        content,
      }] : []),
      {
        role: 'assistant' as const,
        content: cleanedResponse,
      },
    ]

    const asyncBudgetInfo = calculateMaxAvailable(effectiveProfile.provider, effectiveProfile.modelName, effectiveProfile)
    const asyncCompressionTarget = Math.floor(asyncBudgetInfo.maxAvailable * CONTEXT_HISTORY_BUDGET_RATIO)

    triggerAsyncCompression({
      chatId,
      participantId: isMultiCharacter ? characterParticipant.id : undefined,
      messages: updatedMessages,
      systemPrompt: builtContext.originalSystemPrompt,
      compressionOptions: {
        enabled: contextCompressionSettings.enabled,
        windowSize: contextCompressionSettings.windowSize,
        compressionTargetTokens: asyncCompressionTarget,
        systemPromptTargetTokens: contextCompressionSettings.systemPromptTargetTokens,
        selection: cheapLLMSelection,
        userId,
        characterName: character.name,
        userName: 'User',
        dangerSettings,
        availableProfiles: allProfiles,
      },
    })
  }

  if (usage && (usage.promptTokens || usage.completionTokens)) {
    const costResult = await estimateMessageCost(
      effectiveProfile.provider,
      effectiveProfile.modelName,
      usage.promptTokens || 0,
      usage.completionTokens || 0,
      userId
    )
    await trackMessageTokenUsage(chatId, effectiveProfile.id, usage, costResult.cost, costResult.source)
  }

  const autoDetectRngInResponse = chatSettings?.autoDetectRng ?? true
  if (autoDetectRngInResponse && cleanedResponse) {
    const rngPatternsInResponse = detectAndConvertRngPatterns(cleanedResponse)
    if (rngPatternsInResponse.length > 0) {
      logger.info('Auto-detected RNG patterns in assistant response', {
        chatId,
        userId,
        patternCount: rngPatternsInResponse.length,
        patterns: rngPatternsInResponse.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
      })

      for (const pattern of rngPatternsInResponse) {
        const rngContext = { userId, chatId }
        const result = await executeRngTool({ type: pattern.type, rolls: pattern.rolls }, rngContext)
        const formattedResult = formatRngResults(result)

        const toolMessageId = crypto.randomUUID()
        const toolMessage = {
          id: toolMessageId,
          type: 'message' as const,
          role: 'TOOL' as const,
          content: JSON.stringify({
            tool: 'rng',
            initiatedBy: 'auto-detect-response',
            success: result.success,
            result: formattedResult,
            prompt: pattern.matchText,
            arguments: { type: pattern.type, rolls: pattern.rolls },
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        }

        await repos.chats.addMessage(chatId, toolMessage)
        toolMessages.push({
          toolName: 'rng',
          content: formattedResult,
          success: result.success,
          arguments: { type: pattern.type, rolls: pattern.rolls },
        })
      }
    }
  }

  await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

  const turnInfo = await calculateNextSpeaker(
    repos,
    chatId,
    chat,
    character,
    characterParticipant,
    userParticipantId
  )

  controller.enqueue(encodeDoneEvent(encoder, {
    messageId: assistantMessageId,
    participantId: characterParticipant.id,
    usage,
    cacheUsage,
    attachmentResults,
    toolsExecuted: toolMessages.length > 0,
    turn: turnInfo,
    provider: effectiveProfile.provider,
    modelName: effectiveProfile.modelName,
    isSilentMessage: characterParticipant.status === 'silent' || undefined,
  }))

  if (chatSettings) {
    const memoryChatSettings: MemoryChatSettings = {
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      dangerSettings,
      isDangerousChat: chat.isDangerousChat === true,
    }

    const allCharacterPronouns = isMultiCharacter
      ? Object.fromEntries(Array.from(participantCharacters.values()).map(c => [c.name, c.pronouns ?? null]))
      : undefined

    await triggerMemoryExtraction(repos, {
      characterId: character.id,
      characterName: character.name,
      characterPronouns: character.pronouns,
      personaName: resolvedIdentity.name !== 'User' ? resolvedIdentity.name : undefined,
      userCharacterId,
      allCharacterNames: isMultiCharacter ? Array.from(participantCharacters.values()).map(c => c.name) : undefined,
      allCharacterPronouns,
      chatId,
      userMessage: isContinueMode ? '[Continue/Nudge - no user message]' : content,
      assistantMessage: cleanedResponse,
      sourceMessageId: assistantMessageId,
      userId,
      connectionProfile,
      chatSettings: memoryChatSettings,
    })

    if (isMultiCharacter) {
      await triggerInterCharacterMemory(repos, {
        character,
        characterParticipantId: characterParticipant.id,
        assistantMessage: cleanedResponse,
        assistantMessageId,
        chatId,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
        existingMessages,
        participants: chat.participants,
        participantCharacters,
      })
    }

    if (!isContinueMode && chat.activeTypingParticipantId) {
      const activeTypingParticipant = chat.participants.find(
        p => p.id === chat.activeTypingParticipantId
      )

      if (
        activeTypingParticipant &&
        activeTypingParticipant.type === 'CHARACTER' &&
        activeTypingParticipant.characterId &&
        activeTypingParticipant.id !== characterParticipant.id
      ) {
        const userControlledCharacter = participantCharacters.get(activeTypingParticipant.characterId)
          || await repos.characters.findById(activeTypingParticipant.characterId)

        if (userControlledCharacter) {
          await triggerUserControlledCharacterMemory(repos, {
            userControlledCharacter,
            userControlledParticipantId: activeTypingParticipant.id,
            userTypedMessage: content,
            respondingCharacter: character,
            llmResponse: cleanedResponse,
            llmResponseMessageId: assistantMessageId,
            chatId,
            userId,
            chatSettings: memoryChatSettings,
            allCharacterNames: isMultiCharacter
              ? Array.from(participantCharacters.values()).map(c => c.name)
              : [userControlledCharacter.name, character.name],
          })
        }
      }
    }

    await triggerContextSummaryCheck(repos, {
      chatId,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      userId,
      connectionProfile,
      chatSettings: memoryChatSettings,
    })

    await triggerChatDangerClassification(repos, {
      chatId,
      userId,
      connectionProfile,
      chatSettings: memoryChatSettings,
    })

  }

  return {
    isMultiCharacter,
    hasContent: true,
    messageId: assistantMessageId,
    userParticipantId,
    isPaused: chat.isPaused,
    sceneTrackingContext: chatSettings ? {
      connectionProfile,
      memoryChatSettings: {
        cheapLLMSettings: chatSettings.cheapLLMSettings,
        dangerSettings,
        isDangerousChat: chat.isDangerousChat === true,
      },
      characterIds: Array.from(participantCharacters.values()).map(c => c.id),
    } : undefined,
  }
}

/**
 * Save assistant message to the chat and link tool/image artifacts.
 */
export async function saveAssistantMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  character: { id: string; name: string },
  characterParticipant: { id: string; status?: string },
  content: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  rawResponse: unknown,
  thoughtSignature: string | undefined,
  generatedImagePaths: GeneratedImage[],
  toolMessages: ToolMessage[],
  preGeneratedMessageId?: string,
  provider?: string,
  modelName?: string
): Promise<string> {
  const assistantMessageId = preGeneratedMessageId || crypto.randomUUID()
  const assistantAttachments = generatedImagePaths.map(img => img.id)

  const assistantMessage = {
    id: assistantMessageId,
    type: 'message' as const,
    role: 'ASSISTANT' as const,
    content,
    createdAt: new Date().toISOString(),
    tokenCount: usage?.totalTokens || null,
    promptTokens: usage?.promptTokens || null,
    completionTokens: usage?.completionTokens || null,
    rawResponse: (rawResponse as Record<string, unknown>) || null,
    attachments: assistantAttachments,
    thoughtSignature: thoughtSignature || null,
    participantId: characterParticipant.id,
    provider: provider || null,
    modelName: modelName || null,
    isSilentMessage: characterParticipant.status === 'silent' || null,
  }

  await repos.chats.addMessage(chatId, assistantMessage)

  if (toolMessages.length > 0) {
    await saveToolMessages(
      repos,
      chatId,
      '',
      toolMessages,
      generatedImagePaths,
      character.id
    )
  }

  for (const imageId of assistantAttachments) {
    try {
      await repos.files.addLink(imageId, assistantMessageId)
    } catch (error) {
      logger.warn('Failed to link image to assistant message', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return assistantMessageId
}

/**
 * Calculate the next speaker state for multi-character chats.
 */
export async function calculateNextSpeaker(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  chat: ChatMetadataBase,
  character: Character,
  characterParticipant: { id: string },
  userParticipantId: string | null
): Promise<NextSpeakerInfo> {
  const updatedMessages = await repos.chats.getMessages(chatId)
  const messageEvents = updatedMessages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]

  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    userParticipantId,
  })

  const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants)
  const charactersMap = new Map<string, Character>()

  for (const p of activeCharacterParticipants) {
    if (p.characterId) {
      const char = p.id === characterParticipant.id
        ? character
        : await repos.characters.findById(p.characterId)
      if (char) {
        charactersMap.set(p.characterId, char)
      }
    }
  }

  const nextSpeakerResult = selectNextSpeaker(
    chat.participants,
    charactersMap,
    turnState,
    userParticipantId
  )

  return {
    nextSpeakerId: nextSpeakerResult.nextSpeakerId,
    reason: nextSpeakerResult.reason,
    cycleComplete: nextSpeakerResult.cycleComplete,
    isUsersTurn: nextSpeakerResult.nextSpeakerId === null,
  }
}
