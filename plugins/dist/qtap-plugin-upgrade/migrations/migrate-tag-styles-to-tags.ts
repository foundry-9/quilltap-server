/**
 * Migration: Move Tag Visual Styles to Tags
 *
 * Migrates tag visual styles (emoji, colors, etc.) from ChatSettings.tagStyles
 * to the individual Tag entities. This consolidates tag styling data with the
 * tag itself, making it easier to backup and restore.
 *
 * What it does:
 * 1. Reads all ChatSettings documents that have tagStyles defined
 * 2. For each tag style entry, updates the corresponding Tag with the visualStyle
 * 3. Clears the tagStyles from ChatSettings after successful migration
 *
 * This migration is idempotent - running it multiple times has no negative effect.
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '@/lib/logger';
import type { TagVisualStyle } from '@/lib/schemas/types';

/**
 * Check if MongoDB backend is enabled
 */
function isMongoDBBackendEnabled(): boolean {
  const backend = process.env.DATA_BACKEND || '';
  return backend === 'mongodb' || backend === 'dual';
}

/**
 * Get MongoDB database instance
 */
async function getMongoDatabase() {
  const { getMongoDatabase: getDb } = await import('@/lib/mongodb/client');
  return getDb();
}

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.admin().ping();
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for tag styles migration', {
      context: 'migration.migrate-tag-styles-to-tags',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

interface ChatSettingsWithTagStyles {
  id: string;
  userId: string;
  tagStyles: Record<string, TagVisualStyle>;
}

/**
 * Get ChatSettings documents that have tagStyles defined
 */
async function getChatSettingsWithTagStyles(): Promise<ChatSettingsWithTagStyles[]> {
  try {
    const db = await getMongoDatabase();
    const chatSettingsCollection = db.collection('chat_settings');

    // Find chat_settings that have tagStyles with at least one entry
    const settings = await chatSettingsCollection.find({
      tagStyles: { $exists: true, $ne: {} },
    }).toArray();

    return settings
      .filter(s => s.tagStyles && Object.keys(s.tagStyles).length > 0)
      .map(s => ({
        id: s.id as string,
        userId: s.userId as string,
        tagStyles: s.tagStyles as Record<string, TagVisualStyle>,
      }));
  } catch (error) {
    logger.error('Error getting chat settings with tag styles', {
      context: 'migration.migrate-tag-styles-to-tags',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Check if any tags already have visual styles (migration already partially run)
 */
async function countTagsWithVisualStyles(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const tagsCollection = db.collection('tags');

    const count = await tagsCollection.countDocuments({
      visualStyle: { $exists: true, $ne: null },
    });

    return count;
  } catch (error) {
    logger.error('Error counting tags with visual styles', {
      context: 'migration.migrate-tag-styles-to-tags',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Migrate Tag Styles to Tags Migration
 */
export const migrateTagStylesToTagsMigration: Migration = {
  id: 'migrate-tag-styles-to-tags-v1',
  description: 'Move tag visual styles from ChatSettings to individual Tag entities',
  introducedInVersion: '2.5.1',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB not enabled, skipping tag styles migration', {
        context: 'migration.migrate-tag-styles-to-tags',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring tag styles migration', {
        context: 'migration.migrate-tag-styles-to-tags',
      });
      return false;
    }

    // Check if there are ChatSettings with tagStyles to migrate
    const settingsWithStyles = await getChatSettingsWithTagStyles();

    logger.debug('Checked for chat settings with tag styles', {
      context: 'migration.migrate-tag-styles-to-tags',
      count: settingsWithStyles.length,
    });

    // Run if there are styles to migrate
    return settingsWithStyles.length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let updatedTags = 0;
    let processedSettings = 0;
    const errors: Array<{ tagId: string; error: string }> = [];

    logger.info('Starting tag styles to tags migration', {
      context: 'migration.migrate-tag-styles-to-tags',
    });

    try {
      const db = await getMongoDatabase();
      const tagsCollection = db.collection('tags');
      const chatSettingsCollection = db.collection('chat_settings');

      const settingsWithStyles = await getChatSettingsWithTagStyles();

      logger.info('Found chat settings with tag styles', {
        context: 'migration.migrate-tag-styles-to-tags',
        count: settingsWithStyles.length,
      });

      for (const settings of settingsWithStyles) {
        const { userId, tagStyles } = settings;

        for (const [tagId, visualStyle] of Object.entries(tagStyles)) {
          try {
            // Check if tag exists
            const tag = await tagsCollection.findOne({ id: tagId, userId });

            if (!tag) {
              logger.debug('Tag not found, skipping style migration', {
                context: 'migration.migrate-tag-styles-to-tags',
                tagId,
                userId,
              });
              continue;
            }

            // Only update if tag doesn't already have a visual style
            if (tag.visualStyle) {
              logger.debug('Tag already has visual style, skipping', {
                context: 'migration.migrate-tag-styles-to-tags',
                tagId,
              });
              continue;
            }

            // Update the tag with the visual style
            const result = await tagsCollection.updateOne(
              { id: tagId },
              {
                $set: {
                  visualStyle,
                  updatedAt: new Date().toISOString(),
                },
              }
            );

            if (result.modifiedCount > 0) {
              updatedTags++;
              logger.debug('Updated tag with visual style', {
                context: 'migration.migrate-tag-styles-to-tags',
                tagId,
                visualStyle,
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({
              tagId,
              error: errorMessage,
            });
            logger.error('Failed to update tag visual style', {
              context: 'migration.migrate-tag-styles-to-tags',
              tagId,
              error: errorMessage,
            });
          }
        }

        // Clear tagStyles from ChatSettings after successful migration
        // Keep empty object to indicate migration was done
        try {
          await chatSettingsCollection.updateOne(
            { id: settings.id },
            {
              $set: {
                tagStyles: {},
                updatedAt: new Date().toISOString(),
              },
            }
          );
          processedSettings++;
          logger.debug('Cleared tagStyles from ChatSettings', {
            context: 'migration.migrate-tag-styles-to-tags',
            chatSettingsId: settings.id,
            userId,
          });
        } catch (error) {
          logger.warn('Failed to clear tagStyles from ChatSettings', {
            context: 'migration.migrate-tag-styles-to-tags',
            chatSettingsId: settings.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Tag styles migration failed', {
        context: 'migration.migrate-tag-styles-to-tags',
        error: errorMessage,
      });

      return {
        id: 'migrate-tag-styles-to-tags-v1',
        success: false,
        itemsAffected: updatedTags,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Tag styles to tags migration completed', {
      context: 'migration.migrate-tag-styles-to-tags',
      success,
      updatedTags,
      processedSettings,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-tag-styles-to-tags-v1',
      success,
      itemsAffected: updatedTags,
      message: success
        ? `Migrated visual styles to ${updatedTags} tags from ${processedSettings} user settings`
        : `Updated ${updatedTags} tags with ${errors.length} errors`,
      error: errors.length > 0
        ? `Failed tags: ${errors.slice(0, 5).map(e => `${e.tagId}: ${e.error}`).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
