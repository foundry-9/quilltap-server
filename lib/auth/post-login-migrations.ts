/**
 * Post-Login Migrations
 *
 * Handles per-user data migrations that run after successful login.
 * These migrations run for the logged-in user only and handle cases
 * where startup migrations may have missed user-specific data.
 */

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
 * Character document type for migration (includes deprecated field)
 */
interface CharacterDocWithLegacy {
  id: string;
  userId: string;
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
 * Migrate a user's characters from deprecated systemPrompt field to systemPrompts array
 *
 * This handles characters that:
 * - Have a non-empty systemPrompt field
 * - Have no entries in systemPrompts array
 *
 * The migration creates a new entry in systemPrompts with the content
 * and clears the old systemPrompt field.
 *
 * Note: This queries MongoDB directly because the systemPrompt field
 * has been removed from the TypeScript interface.
 */
async function migrateUserCharacterSystemPrompts(userId: string): Promise<void> {
  // Only run if MongoDB is enabled
  if (!isMongoDBBackendEnabled()) {
    logger.debug('MongoDB not enabled, skipping character system prompts migration', {
      context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
      userId,
    });
    return;
  }

  const startTime = Date.now();

  try {
    const db = await getMongoDatabase();
    const charactersCollection = db.collection('characters');

    // Find user's characters with systemPrompt but empty/missing systemPrompts array
    const needsMigration = await charactersCollection.find<CharacterDocWithLegacy>({
      userId,
      systemPrompt: { $exists: true, $nin: [null, ''] },
      $or: [
        { systemPrompts: { $exists: false } },
        { systemPrompts: { $size: 0 } },
      ],
    }).toArray();

    if (needsMigration.length === 0) {
      logger.debug('No characters need system prompt migration for user', {
        context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
        userId,
      });
      return;
    }

    logger.info('Migrating character system prompts for user', {
      context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
      userId,
      count: needsMigration.length,
    });

    let migratedCount = 0;
    let errorCount = 0;

    for (const character of needsMigration) {
      try {
        if (!character.systemPrompt) {
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
          migratedCount++;
          logger.debug('Migrated character system prompt', {
            context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
            characterId: character.id,
            characterName: character.name,
            newPromptId: newSystemPrompt.id,
          });
        }
      } catch (error) {
        errorCount++;
        logger.error('Failed to migrate character system prompt', {
          context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
          characterId: character.id,
          characterName: character.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info('Completed character system prompt migration for user', {
      context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
      userId,
      migratedCount,
      errorCount,
      durationMs,
    });
  } catch (error) {
    logger.error('Failed to run character system prompt migration for user', {
      context: 'post-login-migrations.migrateUserCharacterSystemPrompts',
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Run all post-login migrations for a user
 *
 * This function is called after successful authentication.
 * It runs all necessary per-user migrations in sequence.
 *
 * Migrations are designed to be idempotent and safe to run multiple times.
 */
export async function runPostLoginMigrations(userId: string): Promise<void> {
  logger.debug('Running post-login migrations', {
    context: 'post-login-migrations.runPostLoginMigrations',
    userId,
  });

  // Run character system prompt migration
  await migrateUserCharacterSystemPrompts(userId);

  // Add future per-user migrations here
}
