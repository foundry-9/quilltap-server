/**
 * User Identity Resolver Service
 *
 * Resolves the user's identity for chat context through a fallback chain:
 * 1. Chat already has a user-controlled character participant → use it
 * 2. Only one user-controlled character exists system-wide → auto-select it
 * 3. User profile has a name → use that
 * 4. Fall back to "User"
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase } from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/chat.types'

const logger = createServiceLogger('UserIdentityResolver')

export interface ResolvedUserIdentity {
  name: string
  description: string
  /** The character ID if identity was resolved from a user-controlled character */
  characterId?: string
  /** How the identity was resolved */
  source: 'chat-participant' | 'single-user-character' | 'user-profile' | 'default'
}

/**
 * Resolve the user's identity for Salon chat through a fallback chain.
 *
 * Priority:
 * 1. User-controlled character participant already in the chat
 * 2. Exactly one user-controlled character in the system → auto-select
 * 3. User profile name
 * 4. Generic "User" fallback
 */
export async function resolveUserIdentity(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
  chat: ChatMetadataBase
): Promise<ResolvedUserIdentity> {
  // Step 1: Check if the chat already has a user-controlled character participant
  const userControlledParticipant = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId && isParticipantPresent(p.status)
  )

  if (userControlledParticipant?.characterId) {
    const character = await repos.characters.findById(userControlledParticipant.characterId)
    if (character) {
      logger.debug('Resolved user identity from chat participant', {
        chatId: chat.id,
        characterId: character.id,
        name: character.name,
      })
      return {
        name: character.name,
        description: character.description || '',
        characterId: character.id,
        source: 'chat-participant',
      }
    }
  }

  // Step 2: Check if exactly one user-controlled character exists system-wide
  const userControlledCharacters = await repos.characters.findUserControlled(userId)

  if (userControlledCharacters.length === 1) {
    const character = userControlledCharacters[0]
    logger.debug('Auto-selected sole user-controlled character', {
      chatId: chat.id,
      characterId: character.id,
      name: character.name,
    })
    return {
      name: character.name,
      description: character.description || '',
      characterId: character.id,
      source: 'single-user-character',
    }
  }

  if (userControlledCharacters.length > 1) {
    logger.debug('Multiple user-controlled characters exist, falling through to profile', {
      chatId: chat.id,
      count: userControlledCharacters.length,
    })
  }

  // Step 3: Fall back to user profile name
  const userProfile = await repos.users.findById(userId)
  if (userProfile?.name) {
    logger.debug('Resolved user identity from profile', {
      chatId: chat.id,
      name: userProfile.name,
    })
    return {
      name: userProfile.name,
      description: '',
      source: 'user-profile',
    }
  }

  // Step 4: Default fallback
  logger.debug('Using default user identity', { chatId: chat.id })
  return {
    name: 'User',
    description: '',
    source: 'default',
  }
}
