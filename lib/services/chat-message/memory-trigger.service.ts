/**
 * Memory Trigger Service
 *
 * Handles async memory processing triggers after message completion.
 * Includes memory extraction, inter-character memory, and context summary checks.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { processMessageForMemoryAsync, processInterCharacterMemoryAsync } from '@/lib/memory'
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary'
import type { getRepositories } from '@/lib/repositories/factory'
import type { Character, ConnectionProfile, ChatParticipantBase, MessageEvent, CheapLLMSettings } from '@/lib/schemas/types'

const logger = createServiceLogger('MemoryTriggerService')

/**
 * Chat settings for memory processing
 */
export interface MemoryChatSettings {
  cheapLLMSettings?: CheapLLMSettings
}

/**
 * Trigger memory extraction for a message
 */
export async function triggerMemoryExtraction(
  repos: ReturnType<typeof getRepositories>,
  options: {
    characterId: string
    characterName: string
    personaName?: string
    allCharacterNames?: string[]
    chatId: string
    userMessage: string
    assistantMessage: string
    sourceMessageId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  }
): Promise<void> {
  try {
    const availableProfiles = await repos.connections.findByUserId(options.userId)

    if (!options.chatSettings.cheapLLMSettings) {
      logger.debug('Skipping memory extraction - no cheapLLMSettings')
      return
    }

    processMessageForMemoryAsync({
      characterId: options.characterId,
      characterName: options.characterName,
      personaName: options.personaName,
      allCharacterNames: options.allCharacterNames,
      chatId: options.chatId,
      userMessage: options.userMessage,
      assistantMessage: options.assistantMessage,
      sourceMessageId: options.sourceMessageId,
      userId: options.userId,
      connectionProfile: options.connectionProfile,
      cheapLLMSettings: options.chatSettings.cheapLLMSettings,
      availableProfiles,
    }, async (result) => {
      // Store memory debug logs in the assistant message if available
      if (result.debugLogs && result.debugLogs.length > 0 && options.sourceMessageId) {
        try {
          await repos.chats.updateMessage(
            options.chatId,
            options.sourceMessageId,
            { debugMemoryLogs: result.debugLogs }
          )
        } catch (e) {
          logger.error('Failed to store memory debug logs', {}, e as Error)
        }
      }
    })
  } catch (error) {
    logger.error('Failed to trigger memory extraction', {}, error as Error)
  }
}

/**
 * Trigger inter-character memory extraction for multi-character chats
 */
export async function triggerInterCharacterMemory(
  repos: ReturnType<typeof getRepositories>,
  options: {
    character: Character
    characterParticipantId: string
    assistantMessage: string
    assistantMessageId: string
    chatId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
    existingMessages: MessageEvent[]
    participants: ChatParticipantBase[]
    participantCharacters: Map<string, Character>
  }
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {
      logger.debug('Skipping inter-character memory extraction - no cheapLLMSettings')
      return
    }

    const availableProfiles = await repos.connections.findByUserId(options.userId)

    // Get the last messages from other characters to form memories about them
    const otherCharacterMessages = options.existingMessages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        return msg.role === 'ASSISTANT' && msg.participantId && msg.participantId !== options.characterParticipantId
      })
      .slice(-5) // Look at last 5 assistant messages from others

    for (const otherMsg of otherCharacterMessages) {
      const otherParticipantId = otherMsg.participantId
      if (!otherParticipantId) continue

      // Find the other participant and their character
      const otherParticipant = options.participants.find(p => p.id === otherParticipantId)
      if (!otherParticipant || otherParticipant.type !== 'CHARACTER' || !otherParticipant.characterId) continue

      const otherCharacter = options.participantCharacters.get(otherParticipant.characterId)
      if (!otherCharacter) continue

      // Extract memory that this character has about the other character
      processInterCharacterMemoryAsync({
        observerCharacterId: options.character.id,
        observerCharacterName: options.character.name,
        observerMessage: options.assistantMessage,
        subjectCharacterId: otherCharacter.id,
        subjectCharacterName: otherCharacter.name,
        subjectMessage: otherMsg.content,
        chatId: options.chatId,
        sourceMessageId: options.assistantMessageId,
        userId: options.userId,
        connectionProfile: options.connectionProfile,
        cheapLLMSettings: options.chatSettings.cheapLLMSettings,
        availableProfiles,
      })
    }

    logger.debug('Triggered inter-character memory extraction', {
      characterId: options.character.id,
      otherCharacterCount: otherCharacterMessages.length,
    })
  } catch (error) {
    logger.error('Failed to trigger inter-character memory extraction', {}, error as Error)
  }
}

/**
 * Trigger context summary check and generation if needed
 */
export async function triggerContextSummaryCheck(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    provider: string
    modelName: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  }
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {
      logger.debug('Skipping context summary check - no cheapLLMSettings')
      return
    }

    const availableProfiles = await repos.connections.findByUserId(options.userId)

    checkAndGenerateSummaryIfNeeded(
      options.chatId,
      options.provider,
      options.modelName,
      options.userId,
      options.connectionProfile,
      options.chatSettings.cheapLLMSettings,
      availableProfiles
    )
  } catch (error) {
    logger.error('Failed to trigger context summary check', {}, error as Error)
  }
}
