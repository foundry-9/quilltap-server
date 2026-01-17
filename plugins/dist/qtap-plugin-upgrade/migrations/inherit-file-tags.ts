/**
 * Migration: Inherit File Tags
 *
 * Backfills tags for existing files based on their `linkedTo` associations.
 * Files should inherit tags from the entities they are linked to
 * (characters, personas, chats, connection profiles, etc.).
 *
 * What it does:
 * 1. Scans all files in the MongoDB files collection
 * 2. For each file with linkedTo entries, looks up the linked entities
 * 3. Collects all tags from those entities
 * 4. Merges with any existing tags on the file
 * 5. Updates the file with the inherited tags
 *
 * This migration is idempotent - running it multiple times will just
 * re-merge the tags, which has no negative effect.
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '../lib/plugin-logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    // Use database-level ping instead of admin ping - works without admin privileges
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for file tags migration', {
      context: 'migration.inherit-file-tags',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

interface FileWithLinks {
  id: string;
  userId: string;
  linkedTo: string[];
  tags: string[];
}

/**
 * Get files that have linkedTo entries
 */
async function getFilesWithLinks(): Promise<FileWithLinks[]> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');

    // Find files that have at least one linkedTo entry
    const files = await filesCollection.find({
      linkedTo: { $exists: true, $ne: [], $type: 'array' },
    }).toArray();

    return files.map(f => ({
      id: f.id as string,
      userId: f.userId as string,
      linkedTo: (f.linkedTo || []) as string[],
      tags: (f.tags || []) as string[],
    }));
  } catch (error) {
    logger.error('Error getting files with links', {
      context: 'migration.inherit-file-tags',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Look up tags for an entity (character, persona, chat, etc.)
 */
async function getEntityTags(entityId: string, userId: string): Promise<string[]> {
  try {
    const db = await getMongoDatabase();

    // Try characters
    const character = await db.collection('characters').findOne({ id: entityId, userId });
    if (character && Array.isArray(character.tags)) {
      return character.tags as string[];
    }

    // Try personas
    const persona = await db.collection('personas').findOne({ id: entityId, userId });
    if (persona && Array.isArray(persona.tags)) {
      return persona.tags as string[];
    }

    // Try chats
    const chat = await db.collection('chats').findOne({ id: entityId, userId });
    if (chat && Array.isArray(chat.tags)) {
      return chat.tags as string[];
    }

    // Try connection_profiles
    const connectionProfile = await db.collection('connection_profiles').findOne({ id: entityId, userId });
    if (connectionProfile && Array.isArray(connectionProfile.tags)) {
      return connectionProfile.tags as string[];
    }

    // Try image_profiles
    const imageProfile = await db.collection('image_profiles').findOne({ id: entityId, userId });
    if (imageProfile && Array.isArray(imageProfile.tags)) {
      return imageProfile.tags as string[];
    }

    // Try embedding_profiles
    const embeddingProfile = await db.collection('embedding_profiles').findOne({ id: entityId, userId });
    if (embeddingProfile && Array.isArray(embeddingProfile.tags)) {
      return embeddingProfile.tags as string[];
    }

    // Entity not found (might be a message ID or other non-taggable entity)
    return [];
  } catch (error) {
    logger.debug('Error looking up entity tags', {
      context: 'migration.inherit-file-tags',
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get inherited tags for a file from all its linked entities
 */
async function getInheritedTagsForFile(file: FileWithLinks): Promise<string[]> {
  const allTags = new Set<string>();

  // Add existing tags
  for (const tag of file.tags) {
    allTags.add(tag);
  }

  // Look up tags from each linked entity
  for (const entityId of file.linkedTo) {
    const entityTags = await getEntityTags(entityId, file.userId);
    for (const tag of entityTags) {
      allTags.add(tag);
    }
  }

  return Array.from(allTags);
}

/**
 * Inherit File Tags Migration
 */
export const inheritFileTagsMigration: Migration = {
  id: 'inherit-file-tags-v1',
  description: 'Inherit tags from linked entities to files',
  introducedInVersion: '2.2.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      logger.debug('MongoDB not enabled, skipping file tags migration', {
        context: 'migration.inherit-file-tags',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring file tags migration', {
        context: 'migration.inherit-file-tags',
      });
      return false;
    }

    // Check if there are files with linkedTo entries
    const filesWithLinks = await getFilesWithLinks();

    logger.debug('Checked for files with linked entities', {
      context: 'migration.inherit-file-tags',
      count: filesWithLinks.length,
    });

    // Run if there are files with links
    // (even if they already have tags, we should ensure they have inherited tags)
    return filesWithLinks.length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let updatedFiles = 0;
    let skippedFiles = 0;
    const errors: Array<{ fileId: string; error: string }> = [];

    logger.info('Starting file tags inheritance migration', {
      context: 'migration.inherit-file-tags',
    });

    try {
      const db = await getMongoDatabase();
      const filesCollection = db.collection('files');
      const filesWithLinks = await getFilesWithLinks();

      logger.info('Found files with linked entities', {
        context: 'migration.inherit-file-tags',
        count: filesWithLinks.length,
      });

      for (const file of filesWithLinks) {
        try {
          // Get inherited tags
          const inheritedTags = await getInheritedTagsForFile(file);

          // Check if there are new tags to add
          const existingTagSet = new Set(file.tags);
          const newTags = inheritedTags.filter(t => !existingTagSet.has(t));

          if (newTags.length === 0) {
            // No new tags to add
            skippedFiles++;
            continue;
          }

          // Update the file with merged tags
          const result = await filesCollection.updateOne(
            { id: file.id },
            {
              $set: {
                tags: inheritedTags,
                updatedAt: new Date().toISOString(),
              },
            }
          );

          if (result.modifiedCount > 0) {
            updatedFiles++;
            logger.debug('Updated file with inherited tags', {
              context: 'migration.inherit-file-tags',
              fileId: file.id,
              previousTagCount: file.tags.length,
              newTagCount: inheritedTags.length,
              addedTags: newTags.length,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            fileId: file.id,
            error: errorMessage,
          });
          logger.error('Failed to update file tags', {
            context: 'migration.inherit-file-tags',
            fileId: file.id,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('File tags migration failed', {
        context: 'migration.inherit-file-tags',
        error: errorMessage,
      });

      return {
        id: 'inherit-file-tags-v1',
        success: false,
        itemsAffected: updatedFiles,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('File tags inheritance migration completed', {
      context: 'migration.inherit-file-tags',
      success,
      updatedFiles,
      skippedFiles,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'inherit-file-tags-v1',
      success,
      itemsAffected: updatedFiles,
      message: success
        ? `Updated ${updatedFiles} files with inherited tags (${skippedFiles} already up-to-date)`
        : `Updated ${updatedFiles} files with ${errors.length} errors`,
      error: errors.length > 0
        ? `Failed files: ${errors.slice(0, 5).map(e => `${e.fileId}: ${e.error}`).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
