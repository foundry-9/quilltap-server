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
 * Trigger memory extraction for a user-controlled/impersonated character
 *
 * When the user types as a character (via impersonation or user-controlled),
 * that character should also form memories about:
 * - What they "said" (the user's input as them)
 * - What other characters responded with
 *
 * This allows the character to have continuous memories even when
 * switching between user and LLM control.
 */
export async function triggerUserControlledCharacterMemory(
  repos: ReturnType<typeof getRepositories>,
  options: {
    /** The character the user was typing as */
    userControlledCharacter: Character
    /** Participant ID of the user-controlled character */
    userControlledParticipantId: string
    /** What the user typed as this character */
    userTypedMessage: string
    /** The LLM character that responded */
    respondingCharacter: Character
    /** What the LLM character said in response */
    llmResponse: string
    /** Message ID of the LLM response (for debug logs) */
    llmResponseMessageId: string
    chatId: string
    userId: string
    chatSettings: MemoryChatSettings
    /** All character names for context */
    allCharacterNames?: string[]
  }
): Promise<void> {
  try {
    if (!options.chatSettings.cheapLLMSettings) {
      logger.debug('Skipping user-controlled character memory - no cheapLLMSettings')
      return
    }

    const availableProfiles = await repos.connections.findByUserId(options.userId)

    // Get cheap LLM profile for memory extraction
    // Priority: defaultCheapProfileId (if valid) > userDefinedProfileId (if valid)
    let connectionProfile = null
    const cheapLLMSettings = options.chatSettings.cheapLLMSettings

    // Try global default first (if set and valid)
    if (cheapLLMSettings.defaultCheapProfileId) {
      connectionProfile = await repos.connections.findById(cheapLLMSettings.defaultCheapProfileId)
      if (!connectionProfile || connectionProfile.userId !== options.userId) {
        connectionProfile = null // Invalid, try next
      }
    }

    // Fall back to user-defined profile
    if (!connectionProfile && cheapLLMSettings.strategy === 'USER_DEFINED' && cheapLLMSettings.userDefinedProfileId) {
      connectionProfile = await repos.connections.findById(cheapLLMSettings.userDefinedProfileId)
      if (!connectionProfile || connectionProfile.userId !== options.userId) {
        connectionProfile = null
      }
    }

    if (!connectionProfile) {
      logger.debug('Skipping user-controlled character memory - no valid cheap LLM profile configured')
      return
    }

    logger.debug('Triggering memory extraction for user-controlled character', {
      characterId: options.userControlledCharacter.id,
      characterName: options.userControlledCharacter.name,
      respondingCharacterName: options.respondingCharacter.name,
    })

    // The user-controlled character forms memories about what they said
    // and how the other character responded
    // From their perspective: they said something (userTypedMessage) and
    // the other character responded (llmResponse)
    processMessageForMemoryAsync({
      characterId: options.userControlledCharacter.id,
      characterName: options.userControlledCharacter.name,
      // The "user message" from this character's perspective is what the other character said
      userMessage: `${options.respondingCharacter.name}: ${options.llmResponse}`,
      // The "assistant message" is what this character said (their own words)
      assistantMessage: options.userTypedMessage,
      allCharacterNames: options.allCharacterNames,
      chatId: options.chatId,
      sourceMessageId: options.llmResponseMessageId,
      userId: options.userId,
      connectionProfile,
      cheapLLMSettings: options.chatSettings.cheapLLMSettings,
      availableProfiles,
    }, async (result) => {
      logger.debug('User-controlled character memory extraction complete', {
        characterId: options.userControlledCharacter.id,
        characterName: options.userControlledCharacter.name,
        memoryCreated: result.memoryCreated,
        memoryId: result.memoryId,
        debugLogs: result.debugLogs,
      })
    })
  } catch (error) {
    logger.error('Failed to trigger user-controlled character memory', {}, error as Error)
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
