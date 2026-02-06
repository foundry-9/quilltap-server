/**
 * Memory Trigger Service
 *
 * Handles async memory processing triggers after message completion.
 * Includes memory extraction, inter-character memory, and context summary checks.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { processMessageForMemoryAsync, processInterCharacterMemoryAsync } from '@/lib/memory'
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary'
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { enqueueChatDangerClassification } from '@/lib/background-jobs/queue-service'
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
    /** User character ID - who the memory is about (the user-controlled character) */
    userCharacterId?: string
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

      return
    }

    processMessageForMemoryAsync({
      characterId: options.characterId,
      characterName: options.characterName,
      personaName: options.personaName,
      userCharacterId: options.userCharacterId,
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

      // Create system event for token tracking if tokens were used
      if (result.usage && (result.usage.promptTokens > 0 || result.usage.completionTokens > 0)) {
        try {
          // Estimate cost for the memory extraction operation
          const costResult = await estimateMessageCost(
            options.connectionProfile.provider,
            options.connectionProfile.modelName,
            result.usage.promptTokens || 0,
            result.usage.completionTokens || 0,
            options.userId
          )
          await createMemoryExtractionEvent(
            options.chatId,
            result.usage,
            options.connectionProfile.provider,
            options.connectionProfile.modelName,
            costResult.cost
          )
        } catch (e) {
          logger.error('Failed to create memory extraction system event', {}, e as Error)
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

      return
    }

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

/**
 * Trigger chat-level danger classification if needed
 *
 * Uses the compressed context summary to classify the entire chat.
 * Key behaviors:
 * - Bails if dangerous content mode is OFF
 * - Once classified as dangerous, stays dangerous (sticky)
 * - Re-checks when message count changes (new messages)
 * - Skips if no context summary available yet
 */
export async function triggerChatDangerClassification(
  repos: ReturnType<typeof getRepositories>,
  options: {
    chatId: string
    userId: string
    connectionProfile: ConnectionProfile
    chatSettings: MemoryChatSettings
  }
): Promise<void> {
  try {
    // Resolve danger settings — bail if mode is OFF
    const chatSettings = await repos.chatSettings.findByUserId(options.userId)
    const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings)
    if (dangerSettings.mode === 'OFF') {
      return
    }

    // Get the chat
    const chat = await repos.chats.findById(options.chatId)
    if (!chat) {
      return
    }

    // Sticky: if already classified as dangerous, never re-check
    if (chat.isDangerousChat === true) {
      logger.debug('Chat already classified as dangerous (sticky), skipping', {
        chatId: options.chatId,
      })
      return
    }

    // If already classified at this message count, skip (no new messages)
    if (
      chat.dangerClassifiedAt &&
      chat.dangerClassifiedAtMessageCount === chat.messageCount
    ) {
      logger.debug('Chat already classified at current message count, skipping', {
        chatId: options.chatId,
        messageCount: chat.messageCount,
      })
      return
    }

    // No context summary → nothing to classify yet
    if (!chat.contextSummary) {
      return
    }

    // Enqueue the classification job
    const result = await enqueueChatDangerClassification(options.userId, {
      chatId: options.chatId,
      connectionProfileId: options.connectionProfile.id,
    })

    if (result.isNew) {
      logger.debug('Enqueued chat danger classification job', {
        chatId: options.chatId,
        jobId: result.jobId,
      })
    }
  } catch (error) {
    logger.error('Failed to trigger chat danger classification', {}, error as Error)
  }
}
