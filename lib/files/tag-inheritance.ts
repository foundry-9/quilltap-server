/**
 * Tag Inheritance for Files
 *
 * When files are added to the system (uploaded, imported, or generated),
 * they should inherit tags from the entities they are linked to.
 * This module provides the logic to look up and merge tags from
 * characters, personas, chats, and other taggable entities.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';

/**
 * Get inherited tags from linked entities.
 *
 * For each entity ID in linkedEntityIds, looks up the entity
 * (character, persona, chat, connection profile, image profile, embedding profile)
 * and collects all their tags into a merged set.
 *
 * @param linkedEntityIds - Array of entity UUIDs that a file is linked to
 * @param userId - The user ID to verify ownership of entities
 * @returns Array of unique tag UUIDs inherited from all linked entities
 */
export async function getInheritedTags(
  linkedEntityIds: string[],
  userId: string
): Promise<string[]> {
  if (!linkedEntityIds || linkedEntityIds.length === 0) {
    logger.debug('No linked entities for tag inheritance', {
      context: 'tag-inheritance',
    });
    return [];
  }

  const repos = getRepositories();
  const allTags = new Set<string>();
  const checkedEntities: string[] = [];

  for (const entityId of linkedEntityIds) {
    try {
      // Try character
      const character = await repos.characters.findById(entityId);
      if (character && character.userId === userId) {
        character.tags?.forEach(tag => allTags.add(tag));
        checkedEntities.push(`character:${entityId}`);
        logger.debug('Inherited tags from character', {
          context: 'tag-inheritance',
          characterId: entityId,
          tagCount: character.tags?.length ?? 0,
        });
        continue;
      }

      // Try persona
      const persona = await repos.personas.findById(entityId);
      if (persona && persona.userId === userId) {
        persona.tags?.forEach(tag => allTags.add(tag));
        checkedEntities.push(`persona:${entityId}`);
        logger.debug('Inherited tags from persona', {
          context: 'tag-inheritance',
          personaId: entityId,
          tagCount: persona.tags?.length ?? 0,
        });
        continue;
      }

      // Try chat
      const chat = await repos.chats.findById(entityId);
      if (chat && chat.userId === userId) {
        chat.tags?.forEach(tag => allTags.add(tag));
        checkedEntities.push(`chat:${entityId}`);
        logger.debug('Inherited tags from chat', {
          context: 'tag-inheritance',
          chatId: entityId,
          tagCount: chat.tags?.length ?? 0,
        });
        continue;
      }

      // Try connection profile
      const connectionProfile = await repos.connections.findById(entityId);
      if (connectionProfile && connectionProfile.userId === userId) {
        connectionProfile.tags?.forEach((tag: string) => allTags.add(tag));
        checkedEntities.push(`connectionProfile:${entityId}`);
        logger.debug('Inherited tags from connection profile', {
          context: 'tag-inheritance',
          connectionProfileId: entityId,
          tagCount: connectionProfile.tags?.length ?? 0,
        });
        continue;
      }

      // Try image profile
      const imageProfile = await repos.imageProfiles.findById(entityId);
      if (imageProfile && imageProfile.userId === userId) {
        imageProfile.tags?.forEach(tag => allTags.add(tag));
        checkedEntities.push(`imageProfile:${entityId}`);
        logger.debug('Inherited tags from image profile', {
          context: 'tag-inheritance',
          imageProfileId: entityId,
          tagCount: imageProfile.tags?.length ?? 0,
        });
        continue;
      }

      // Try embedding profile
      const embeddingProfile = await repos.embeddingProfiles.findById(entityId);
      if (embeddingProfile && embeddingProfile.userId === userId) {
        embeddingProfile.tags?.forEach(tag => allTags.add(tag));
        checkedEntities.push(`embeddingProfile:${entityId}`);
        logger.debug('Inherited tags from embedding profile', {
          context: 'tag-inheritance',
          embeddingProfileId: entityId,
          tagCount: embeddingProfile.tags?.length ?? 0,
        });
        continue;
      }

      // Entity not found in any repository - might be a message ID or other non-taggable entity
      logger.debug('Entity not found for tag inheritance (may be a message or other non-taggable entity)', {
        context: 'tag-inheritance',
        entityId,
      });
    } catch (error) {
      logger.debug('Error looking up entity for tag inheritance', {
        context: 'tag-inheritance',
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const inheritedTags = Array.from(allTags);

  logger.debug('Tag inheritance complete', {
    context: 'tag-inheritance',
    linkedEntityCount: linkedEntityIds.length,
    checkedEntities,
    inheritedTagCount: inheritedTags.length,
  });

  return inheritedTags;
}

/**
 * Merge existing tags with inherited tags, removing duplicates.
 *
 * @param existingTags - Tags already on the file
 * @param inheritedTags - Tags inherited from linked entities
 * @returns Merged array of unique tag UUIDs
 */
export function mergeTags(existingTags: string[], inheritedTags: string[]): string[] {
  const merged = new Set<string>([...existingTags, ...inheritedTags]);
  return Array.from(merged);
}
