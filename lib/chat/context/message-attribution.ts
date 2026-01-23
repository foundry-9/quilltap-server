/**
 * Message Attribution
 *
 * Handles multi-character message attribution and history access filtering.
 * Converts messages to the responding character's perspective for context building.
 */

import type { Character, ChatParticipantBase } from '@/lib/schemas/types'
import type { MultiCharacterMessage } from '@/lib/llm/message-formatter'
import { logger } from '@/lib/logger'

/**
 * Extended message format for multi-character context building
 * Includes participantId for attribution
 */
export interface MessageWithParticipant {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  /** Which participant sent this message (for multi-character attribution) */
  participantId?: string | null
  /** When the message was created (for history access filtering) */
  createdAt?: string
}

/**
 * Filter messages based on participant's history access
 * If hasHistoryAccess is false, only include messages after the participant joined
 */
export function filterMessagesByHistoryAccess(
  messages: MessageWithParticipant[],
  participant: ChatParticipantBase
): MessageWithParticipant[] {
  // If participant has full history access, return all messages
  if (participant.hasHistoryAccess) {
    logger.debug('[MessageAttribution] Participant has full history access', {
      participantId: participant.id,
    })
    return messages
  }

  // Otherwise, filter to only messages after the participant joined
  const participantJoinTime = new Date(participant.createdAt).getTime()

  const filteredMessages = messages.filter(msg => {
    if (!msg.createdAt) {
      // If no createdAt, include the message (shouldn't happen)
      return true
    }
    const msgTime = new Date(msg.createdAt).getTime()
    return msgTime >= participantJoinTime
  })

  logger.debug('[MessageAttribution] Filtered messages by history access', {
    participantId: participant.id,
    joinTime: participant.createdAt,
    originalCount: messages.length,
    filteredCount: filteredMessages.length,
  })

  return filteredMessages
}

/**
 * Get participant name for message attribution
 * Supports CHARACTER participants (both LLM and user-controlled)
 */
export function getParticipantName(
  participantId: string | null | undefined,
  participantCharacters: Map<string, Character>,
  allParticipants: ChatParticipantBase[]
): string | undefined {
  if (!participantId) {
    return undefined
  }

  // Find the participant
  const participant = allParticipants.find(p => p.id === participantId)
  if (!participant) {
    return undefined
  }

  // CHARACTER participants (both LLM and user-controlled)
  if (participant.type === 'CHARACTER' && participant.characterId) {
    const character = participantCharacters.get(participant.characterId)
    return character?.name
  }

  return undefined
}

/**
 * Attribute messages for multi-character context
 * Converts messages to the responding character's perspective:
 * - Messages from the responding character → role: assistant
 * - Messages from other characters → role: user, with name
 * - Messages from user/character → role: user, with name
 */
export function attributeMessagesForCharacter(
  messages: MessageWithParticipant[],
  respondingParticipantId: string,
  participantCharacters: Map<string, Character>,
  allParticipants: ChatParticipantBase[]
): MultiCharacterMessage[] {
  logger.debug('[MessageAttribution] Attributing messages for character', {
    respondingParticipantId,
    messageCount: messages.length,
  })

  return messages.map(msg => {
    const participantName = getParticipantName(
      msg.participantId,
      participantCharacters,
      allParticipants
    )

    // Determine role based on who sent the message
    let role: 'user' | 'assistant' = 'user'

    if (msg.participantId === respondingParticipantId) {
      // Message from the responding character → assistant role
      role = 'assistant'
    } else if (msg.role.toUpperCase() === 'ASSISTANT') {
      // Message from another character (was stored as ASSISTANT) → user role
      // The name attribution will distinguish them
      role = 'user'
    } else {
      // USER messages stay as user role
      role = 'user'
    }

    return {
      role,
      content: msg.content,
      name: participantName,
      participantId: msg.participantId || undefined,
      thoughtSignature: msg.thoughtSignature,
    }
  })
}

/**
 * Find the user participant for message attribution in multi-character mode
 * Returns the first active user-controlled CHARACTER participant
 */
export function findUserParticipantName(
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>
): string | undefined {
  // Find a user-controlled CHARACTER participant
  const userCharacterParticipant = allParticipants.find(p =>
    p.type === 'CHARACTER' && p.controlledBy === 'user' && p.isActive && p.characterId
  )
  if (userCharacterParticipant?.characterId) {
    const character = participantCharacters.get(userCharacterParticipant.characterId)
    if (character?.name) {
      return character.name
    }
  }

  return undefined
}
