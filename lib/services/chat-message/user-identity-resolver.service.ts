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
import { isParticipantPresent, operatorSpeaksWithoutSeat } from '@/lib/schemas/chat.types'
import { findActiveUserParticipant } from '@/lib/chat/turn-manager'

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
  chat: ChatMetadataBase,
  activeTypingParticipantId?: string | null
): Promise<ResolvedUserIdentity> {
  // Step 1: Check if the chat already has a user-controlled character participant.
  // When several characters are user-controlled, prefer the one the human is
  // currently "Speaking As" so the responder's view of "who you're talking to"
  // matches the active speaker rather than the first participant in order.
  const userControlledParticipant = findActiveUserParticipant(
    chat.participants,
    activeTypingParticipantId,
    chat.impersonatingParticipantIds
  )

  if (userControlledParticipant?.characterId) {
    const character = await repos.characters.findById(userControlledParticipant.characterId)
    if (character) {
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
    return {
      name: character.name,
      description: character.description || '',
      characterId: character.id,
      source: 'single-user-character',
    }
  }

  // Step 3: Fall back to user profile name
  const userProfile = await repos.users.findById(userId)
  if (userProfile?.name) {
    return {
      name: userProfile.name,
      description: '',
      source: 'user-profile',
    }
  }

  // Step 4: Default fallback
  return {
    name: 'User',
    description: '',
    source: 'default',
  }
}

/**
 * Whether the persona `resolveUserIdentity` returned is in the room — seated,
 * or the unseated voice of the operator's messages. A persona reached through
 * the system-wide fallback (step 2) in an autonomous room is neither: nobody
 * types as them there, so they are as off the scene as any other absent
 * character, even though `{{user}}` still names them (bug 172).
 *
 * Callers holding a resolved identity ask this rather than reading `source`
 * (the continuation's left-behind notice). The per-turn off-scene scan holds
 * only the persona's name, excludes seated characters by id, and so asks the
 * underlying `operatorSpeaksWithoutSeat` directly.
 */
export function isUserPersonaInRoom(
  chat: Pick<ChatMetadataBase, 'chatType'>,
  identity: ResolvedUserIdentity
): boolean {
  if (!identity.characterId) return false
  if (identity.source === 'chat-participant') return true
  const inRoom = operatorSpeaksWithoutSeat(chat.chatType)
  logger.debug('Unseated persona presence resolved', {
    characterId: identity.characterId,
    chatType: chat.chatType,
    inRoom,
  })
  return inRoom
}
