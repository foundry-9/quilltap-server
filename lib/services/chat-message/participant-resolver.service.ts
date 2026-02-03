/**
 * Participant Resolver Service
 *
 * Handles resolution of responding participants in chat messages,
 * including character lookup and connection profile resolution.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver'
import {
  findUserParticipant,
  isMultiCharacterChat,
  getActiveCharacterParticipants,
} from '@/lib/chat/turn-manager'
import type { getRepositories } from '@/lib/repositories/factory'
import type {
  ChatMetadataBase,
  ChatParticipantBase,
  Character,
  ConnectionProfile,
} from '@/lib/schemas/types'

const logger = createServiceLogger('ParticipantResolverService')

/**
 * Result of participant resolution
 */
export interface ParticipantResolutionResult {
  /** The character participant who will respond */
  characterParticipant: ChatParticipantBase
  /** The character data */
  character: Character
  /** The connection profile to use */
  connectionProfile: ConnectionProfile
  /** Decrypted API key (or empty string for keyless providers) */
  apiKey: string
  /** Image profile ID if configured */
  imageProfileId: string | null
  /** The user participant (persona) */
  userParticipant: ChatParticipantBase | null
  /** User participant ID */
  userParticipantId: string | null
  /** Whether this is a multi-character chat */
  isMultiCharacter: boolean
}

/**
 * All participant data for multi-character chats
 */
export interface AllParticipantsData {
  /** Map of character IDs to Character data */
  participantCharacters: Map<string, Character>
}

/**
 * Resolve the responding participant for a chat message
 */
export async function resolveRespondingParticipant(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  userId: string,
  requestedRespondingParticipantId?: string,
  isContinueMode: boolean = false
): Promise<ParticipantResolutionResult> {

  // Get user participant (persona) for turn management
  const userParticipant = findUserParticipant(chat.participants)
  const userParticipantId = userParticipant?.id ?? null

  // Get character participant - use specified participant for continue mode, otherwise first active character
  let characterParticipant: ChatParticipantBase | undefined

  if (requestedRespondingParticipantId) {
    // Continue mode with specific participant requested - find them
    characterParticipant = chat.participants.find(
      p => p.id === requestedRespondingParticipantId && p.type === 'CHARACTER' && p.isActive && p.characterId
    )
    if (!characterParticipant) {
      logger.warn('Requested responding participant not found or inactive', {
        chatId: chat.id,
        requestedParticipantId: requestedRespondingParticipantId,
      })
      // Fall back to first active character
      characterParticipant = chat.participants.find(
        p => p.type === 'CHARACTER' && p.isActive && p.characterId
      )
    }
  } else {
    // Normal mode or continue mode without specific participant - use first active character
    characterParticipant = chat.participants.find(
      p => p.type === 'CHARACTER' && p.isActive && p.characterId
    )
  }

  if (!characterParticipant?.characterId) {
    throw new Error('No active character in chat')
  }

  // Get character
  const character = await repos.characters.findById(characterParticipant.characterId)
  if (!character) {
    throw new Error('Character not found')
  }

  logger.info('Selected responding character', {
    chatId: chat.id,
    participantId: characterParticipant.id,
    characterId: characterParticipant.characterId,
    characterName: character.name,
    isContinueMode,
    requestedParticipantId: requestedRespondingParticipantId,
  })

  // Resolve connection profile using fallback chain
  let resolvedConnectionProfileId: string
  try {
    resolvedConnectionProfileId = resolveConnectionProfile(characterParticipant, character)
  } catch {
    logger.error('Failed to resolve connection profile', {
      participantId: characterParticipant.id,
      characterId: character.id,
      characterName: character.name,
    })
    throw new Error('No connection profile configured for character')
  }

  // Get connection profile with API key
  const connectionProfile = await repos.connections.findById(resolvedConnectionProfileId)
  if (!connectionProfile) {
    throw new Error('Connection profile not found')
  }

  // Get API key if needed
  let apiKey = ''
  if (connectionProfile.apiKeyId) {
    const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (apiKeyData) {
      // Import here to avoid circular dependencies
      const { decryptApiKey } = await import('@/lib/encryption')
      apiKey = decryptApiKey(
        apiKeyData.ciphertext,
        apiKeyData.iv,
        apiKeyData.authTag,
        userId
      )
    }
  }

  // Get image profile from the chat level (shared by all participants)
  const imageProfileId = chat.imageProfileId || null

  // Detect if this is a multi-character chat
  const isMultiCharacter = isMultiCharacterChat(chat.participants)

  return {
    characterParticipant,
    character,
    connectionProfile,
    apiKey,
    imageProfileId,
    userParticipant,
    userParticipantId,
    isMultiCharacter,
  }
}

/**
 * Load all participant data for multi-character chats
 */
export async function loadAllParticipantData(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  primaryCharacter: Character
): Promise<AllParticipantsData> {

  const participantCharacters = new Map<string, Character>()

  // Load all characters
  for (const p of chat.participants) {
    if (p.type === 'CHARACTER' && p.characterId && p.isActive) {
      if (p.characterId === primaryCharacter.id) {
        // Reuse already-loaded character
        participantCharacters.set(p.characterId, primaryCharacter)
      } else {
        const char = await repos.characters.findById(p.characterId)
        if (char) {
          participantCharacters.set(p.characterId, char)
        }
      }
    }
  }

  return { participantCharacters }
}


/**
 * Get roleplay template for a chat, with fallback to user default
 */
export async function getRoleplayTemplate(
  repos: ReturnType<typeof getRepositories>,
  chat: ChatMetadataBase,
  chatSettings: { defaultRoleplayTemplateId?: string } | null
): Promise<{ systemPrompt: string } | null> {
  let roleplayTemplateId = chat.roleplayTemplateId

  // If chat doesn't have a template set (older or imported chat), inherit from user default
  if (roleplayTemplateId === undefined || roleplayTemplateId === null) {
    const userDefaultTemplateId = chatSettings?.defaultRoleplayTemplateId
    if (userDefaultTemplateId) {

      await repos.chats.update(chat.id, { roleplayTemplateId: userDefaultTemplateId })
      roleplayTemplateId = userDefaultTemplateId
    }
  }

  if (!roleplayTemplateId) {
    return null
  }

  const roleplayTemplate = await repos.roleplayTemplates.findById(roleplayTemplateId)
  if (!roleplayTemplate) {
    return null
  }

  return { systemPrompt: roleplayTemplate.systemPrompt }
}

export { getActiveCharacterParticipants }
