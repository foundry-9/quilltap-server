/**
 * Migration: Migrate Character System Prompts
 *
 * Migrates characters from the deprecated single `systemPrompt` field
 * to the new `systemPrompts` array structure.
 *
 * What it does:
 * 1. Scans all characters in the MongoDB characters collection
 * 2. Identifies characters with a systemPrompt value but empty/no systemPrompts array
 * 3. Creates a new entry in systemPrompts array with the content, marked as default
 * 4. Clears the old systemPrompt field
 *
 * This migration is idempotent - it only migrates characters that haven't been migrated yet.
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '@/lib/logger';

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
    // Use database-level ping instead of admin ping - works without admin privileges
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for character system prompts migration', {
      context: 'migration.migrate-character-system-prompts',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Character document type for migration
 */
interface CharacterDoc {
  id: string;
  name: string;
  systemPrompt?: string | null;
  systemPrompts?: Array<{
    id: string;
    name: string;
    content: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Get characters that need migration
 * - Have a non-empty systemPrompt field
 * - Have no entries in systemPrompts array
 */
async function getCharactersNeedingMigration(): Promise<CharacterDoc[]> {
  try {
    const db = await getMongoDatabase();
    const charactersCollection = db.collection('characters');

    // Find characters with systemPrompt but empty/missing systemPrompts array
    const characters = await charactersCollection.find({
      systemPrompt: { $exists: true, $nin: [null, ''] },
      $or: [
        { systemPrompts: { $exists: false } },
        { systemPrompts: { $size: 0 } },
      ],
    }).toArray();

    return characters.map(c => ({
      id: c.id as string,
      name: c.name as string,
      systemPrompt: c.systemPrompt as string | null | undefined,
      systemPrompts: c.systemPrompts as CharacterDoc['systemPrompts'],
    }));
  } catch (error) {
    logger.error('Error checking for characters needing system prompt migration', {
      context: 'migration.migrate-character-system-prompts',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Migrate Character System Prompts Migration
 */
export const migrateCharacterSystemPromptsMigration: Migration = {
  id: 'migrate-character-system-prompts-v1',
  description: 'Migrate characters from deprecated systemPrompt field to systemPrompts array',
  introducedInVersion: '2.2.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB not enabled, skipping character system prompts migration', {
        context: 'migration.migrate-character-system-prompts',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring character system prompts migration', {
        context: 'migration.migrate-character-system-prompts',
      });
      return false;
    }

    // Check if there are characters needing migration
    const charactersNeedingMigration = await getCharactersNeedingMigration();

    logger.debug('Checked for characters needing system prompt migration', {
      context: 'migration.migrate-character-system-prompts',
      count: charactersNeedingMigration.length,
    });

    return charactersNeedingMigration.length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const migratedCharacters: string[] = [];
    const errors: Array<{ characterId: string; characterName: string; error: string }> = [];

    logger.info('Starting character system prompts migration', {
      context: 'migration.migrate-character-system-prompts',
    });

    try {
      const db = await getMongoDatabase();
      const charactersCollection = db.collection('characters');
      const charactersNeedingMigration = await getCharactersNeedingMigration();

      logger.info('Found characters needing system prompt migration', {
        context: 'migration.migrate-character-system-prompts',
        count: charactersNeedingMigration.length,
      });

      for (const character of charactersNeedingMigration) {
        try {
          if (!character.systemPrompt) {
            // Skip if no systemPrompt (shouldn't happen due to query, but safety check)
            continue;
          }

          const now = new Date().toISOString();

          // Create a new system prompt entry
          const newSystemPrompt = {
            id: crypto.randomUUID(),
            name: 'Default',
            content: character.systemPrompt,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          };

          // Update the character: add to systemPrompts array and clear systemPrompt
          const result = await charactersCollection.updateOne(
            { id: character.id },
            {
              $set: {
                systemPrompts: [newSystemPrompt],
                systemPrompt: null,
                updatedAt: now,
              },
            }
          );

          if (result.modifiedCount > 0) {
            migratedCharacters.push(character.id);
            logger.info('Migrated character system prompt', {
              context: 'migration.migrate-character-system-prompts',
              characterId: character.id,
              characterName: character.name,
              newPromptId: newSystemPrompt.id,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            characterId: character.id,
            characterName: character.name,
            error: errorMessage,
          });
          logger.error('Failed to migrate character system prompt', {
            context: 'migration.migrate-character-system-prompts',
            characterId: character.id,
            characterName: character.name,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Character system prompts migration failed', {
        context: 'migration.migrate-character-system-prompts',
        error: errorMessage,
      });

      return {
        id: 'migrate-character-system-prompts-v1',
        success: false,
        itemsAffected: migratedCharacters.length,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    return {
      id: 'migrate-character-system-prompts-v1',
      success,
      itemsAffected: migratedCharacters.length,
      message: success
        ? `Migrated ${migratedCharacters.length} characters to new system prompts structure`
        : `Migrated ${migratedCharacters.length} characters with ${errors.length} errors`,
      error: errors.length > 0
        ? `Failed characters: ${errors.map(e => `${e.characterName} (${e.characterId}): ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
