/**
 * Connection Profile Resolver
 *
 * Resolves the appropriate connection profile ID for a chat participant,
 * using a fallback chain when no explicit profile is set.
 */

import { logger } from '@/lib/logger';
import { ChatParticipantBase, Character } from '@/lib/schemas/types';

/**
 * Resolves which connection profile to use for a CHARACTER participant.
 *
 * Resolution order:
 * 1. participant.connectionProfileId (per-chat override)
 * 2. character.defaultConnectionProfileId (character's default)
 * 3. chatDefaultProfileId (chat-level fallback, if provided)
 * 4. Throws error if none found
 *
 * @param participant - The chat participant (must be CHARACTER type)
 * @param character - The character entity for this participant
 * @param chatDefaultProfileId - Optional chat-level fallback profile ID
 * @returns The resolved connection profile ID
 * @throws Error if no connection profile can be resolved
 */
export function resolveConnectionProfile(
  participant: ChatParticipantBase,
  character: Character,
  chatDefaultProfileId?: string
): string {
  logger.debug('Resolving connection profile for participant', {
    participantId: participant.id,
    participantType: participant.type,
    characterId: character.id,
    hasParticipantProfile: !!participant.connectionProfileId,
    hasCharacterDefault: !!character.defaultConnectionProfileId,
    hasChatDefault: !!chatDefaultProfileId,
  });

  // 1. Check participant-level override
  if (participant.connectionProfileId) {
    logger.debug('Using participant connection profile override', {
      participantId: participant.id,
      profileId: participant.connectionProfileId,
    });
    return participant.connectionProfileId;
  }

  // 2. Check character's default
  if (character.defaultConnectionProfileId) {
    logger.debug('Using character default connection profile', {
      participantId: participant.id,
      characterId: character.id,
      profileId: character.defaultConnectionProfileId,
    });
    return character.defaultConnectionProfileId;
  }

  // 3. Check chat-level fallback
  if (chatDefaultProfileId) {
    logger.debug('Using chat default connection profile', {
      participantId: participant.id,
      profileId: chatDefaultProfileId,
    });
    return chatDefaultProfileId;
  }

  // 4. No profile found - this is an error
  const errorMessage = `No connection profile found for participant ${participant.id} (character: ${character.name})`;
  logger.error('Connection profile resolution failed', {
    participantId: participant.id,
    characterId: character.id,
    characterName: character.name,
  });
  throw new Error(errorMessage);
}

/**
 * Check if a participant has a resolvable connection profile.
 *
 * Useful for validation without throwing errors.
 *
 * @param participant - The chat participant
 * @param character - The character entity (only needed for CHARACTER type)
 * @param chatDefaultProfileId - Optional chat-level fallback
 * @returns true if a profile can be resolved, false otherwise
 */
export function hasResolvableConnectionProfile(
  participant: ChatParticipantBase,
  character: Character | null,
  chatDefaultProfileId?: string
): boolean {
  // CHARACTER participants need a profile somewhere in the chain
  if (participant.connectionProfileId) {
    return true;
  }

  if (character?.defaultConnectionProfileId) {
    return true;
  }

  if (chatDefaultProfileId) {
    return true;
  }

  return false;
}
