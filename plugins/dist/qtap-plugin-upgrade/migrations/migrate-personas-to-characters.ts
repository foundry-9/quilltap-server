/**
 * Migration: Migrate Personas to Characters
 *
 * Merges the persona concept into characters, converting all personas to
 * characters with `controlledBy: 'user'`.
 *
 * What it does:
 * 1. Converts all personas to characters with the same ID (preserving references)
 * 2. Maps persona fields to character fields (personalityTraits → personality)
 * 3. Sets controlledBy: 'user' for converted characters
 * 4. Updates chat participants from type: PERSONA to type: CHARACTER with controlledBy: 'user'
 * 5. Migrates memories: moves personaId → aboutCharacterId, then removes personaId field
 * 6. Optionally marks personas as migrated (preserves for rollback)
 *
 * This migration is idempotent - it only migrates personas that haven't been migrated yet.
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
    logger.warn('MongoDB is not accessible for personas-to-characters migration', {
      context: 'migration.migrate-personas-to-characters',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Persona document type for migration
 */
interface PersonaDoc {
  id: string;
  userId: string;
  name: string;
  title?: string | null;
  description?: string;
  personalityTraits?: string | null;
  avatarUrl?: string | null;
  defaultImageId?: string | null;
  sillyTavernData?: unknown;
  characterLinks?: string[];
  tags?: string[];
  physicalDescriptions?: unknown[];
  createdAt: string;
  updatedAt: string;
  _migratedToCharacter?: boolean;
}

/**
 * Check if there are personas that need migration
 */
async function getPersonasNeedingMigration(): Promise<PersonaDoc[]> {
  try {
    const db = await getMongoDatabase();
    const personasCollection = db.collection('personas');

    // Find personas that haven't been migrated yet
    const personas = await personasCollection.find({
      _migratedToCharacter: { $ne: true },
    }).toArray();

    return personas.map(p => ({
      id: p.id as string,
      userId: p.userId as string,
      name: p.name as string,
      title: p.title as string | null | undefined,
      description: p.description as string | undefined,
      personalityTraits: p.personalityTraits as string | null | undefined,
      avatarUrl: p.avatarUrl as string | null | undefined,
      defaultImageId: p.defaultImageId as string | null | undefined,
      sillyTavernData: p.sillyTavernData,
      characterLinks: p.characterLinks as string[] | undefined,
      tags: p.tags as string[] | undefined,
      physicalDescriptions: p.physicalDescriptions as unknown[] | undefined,
      createdAt: p.createdAt as string,
      updatedAt: p.updatedAt as string,
    }));
  } catch (error) {
    logger.error('Error checking for personas needing migration', {
      context: 'migration.migrate-personas-to-characters',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Check if there are chat participants with PERSONA type
 */
async function getChatParticipantsNeedingMigration(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const chatsCollection = db.collection('chats');

    const count = await chatsCollection.countDocuments({
      'participants.type': 'PERSONA',
    });

    return count;
  } catch (error) {
    logger.error('Error checking for chat participants needing migration', {
      context: 'migration.migrate-personas-to-characters',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Check if there are memories with personaId that need migration
 */
async function getMemoriesNeedingMigration(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const memoriesCollection = db.collection('memories');

    const count = await memoriesCollection.countDocuments({
      personaId: { $exists: true, $ne: null },
    });

    return count;
  } catch (error) {
    logger.error('Error checking for memories needing migration', {
      context: 'migration.migrate-personas-to-characters',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Convert a persona to a character document
 */
function personaToCharacter(persona: PersonaDoc): Record<string, unknown> {
  const now = new Date().toISOString();

  // Invert characterLinks to personaLinks (persona linked to those characters becomes
  // a character that was linked from those characters' personas)
  const personaLinks = (persona.characterLinks || []).map(characterId => ({
    personaId: characterId, // The character they were linked to
    isDefault: false,
  }));

  return {
    id: persona.id, // Keep same ID to preserve references
    userId: persona.userId,
    name: persona.name,
    title: persona.title || null,
    description: persona.description || null,
    personality: persona.personalityTraits || null, // Map personalityTraits → personality
    scenario: null,
    firstMessage: null,
    exampleDialogues: null,
    systemPrompts: [],
    avatarUrl: persona.avatarUrl || null,
    defaultImageId: persona.defaultImageId || null,
    defaultConnectionProfileId: null, // User-controlled characters don't need a connection profile
    defaultRoleplayTemplateId: null,
    sillyTavernData: persona.sillyTavernData || null,
    isFavorite: false,
    npc: false,
    talkativeness: 0.5,
    controlledBy: 'user', // Key change: personas become user-controlled characters
    personaLinks,
    tags: persona.tags || [],
    avatarOverrides: [],
    physicalDescriptions: persona.physicalDescriptions || [],
    createdAt: persona.createdAt,
    updatedAt: now,
  };
}

/**
 * Migrate Personas to Characters Migration
 */
export const migratePersonasToCharactersMigration: Migration = {
  id: 'migrate-personas-to-characters-v1',
  description: 'Convert personas to characters with controlledBy: user',
  introducedInVersion: '2.6.0',
  dependsOn: ['migrate-json-to-mongodb-v1'], // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB not enabled, skipping personas-to-characters migration', {
        context: 'migration.migrate-personas-to-characters',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring personas-to-characters migration', {
        context: 'migration.migrate-personas-to-characters',
      });
      return false;
    }

    // Check if there are personas, participants, or memories needing migration
    const personasCount = (await getPersonasNeedingMigration()).length;
    const participantsCount = await getChatParticipantsNeedingMigration();
    const memoriesCount = await getMemoriesNeedingMigration();

    logger.debug('Checked for personas-to-characters migration needs', {
      context: 'migration.migrate-personas-to-characters',
      personasCount,
      participantsCount,
      memoriesCount,
    });

    return personasCount > 0 || participantsCount > 0 || memoriesCount > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const stats = {
      personasMigrated: 0,
      participantsUpdated: 0,
      memoriesMigrated: 0,
    };
    const errors: Array<{ type: string; id: string; error: string }> = [];

    logger.info('Starting personas-to-characters migration', {
      context: 'migration.migrate-personas-to-characters',
    });

    try {
      const db = await getMongoDatabase();
      const personasCollection = db.collection('personas');
      const charactersCollection = db.collection('characters');
      const chatsCollection = db.collection('chats');
      const memoriesCollection = db.collection('memories');

      // ========================================
      // Step 1: Convert personas to characters
      // ========================================
      const personasToMigrate = await getPersonasNeedingMigration();

      logger.info('Found personas to migrate', {
        context: 'migration.migrate-personas-to-characters',
        count: personasToMigrate.length,
      });

      for (const persona of personasToMigrate) {
        try {
          // Check if character with this ID already exists (shouldn't happen, but safety check)
          const existingCharacter = await charactersCollection.findOne({ id: persona.id });

          if (existingCharacter) {
            logger.warn('Character already exists with persona ID, skipping persona conversion', {
              context: 'migration.migrate-personas-to-characters',
              personaId: persona.id,
              personaName: persona.name,
            });
            // Still mark the persona as migrated to avoid reprocessing
            await personasCollection.updateOne(
              { id: persona.id },
              { $set: { _migratedToCharacter: true } }
            );
            continue;
          }

          // Convert persona to character
          const characterDoc = personaToCharacter(persona);

          // Insert new character
          await charactersCollection.insertOne(characterDoc);

          // Mark persona as migrated
          await personasCollection.updateOne(
            { id: persona.id },
            { $set: { _migratedToCharacter: true } }
          );

          stats.personasMigrated++;

          logger.info('Migrated persona to character', {
            context: 'migration.migrate-personas-to-characters',
            personaId: persona.id,
            personaName: persona.name,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            type: 'persona',
            id: persona.id,
            error: errorMessage,
          });
          logger.error('Failed to migrate persona', {
            context: 'migration.migrate-personas-to-characters',
            personaId: persona.id,
            personaName: persona.name,
            error: errorMessage,
          });
        }
      }

      // ========================================
      // Step 2: Update chat participants
      // ========================================
      logger.info('Updating chat participants with PERSONA type', {
        context: 'migration.migrate-personas-to-characters',
      });

      try {
        // Find all chats with PERSONA participants
        const chatsWithPersonaParticipants = await chatsCollection.find({
          'participants.type': 'PERSONA',
        }).toArray();

        for (const chat of chatsWithPersonaParticipants) {
          try {
            const participants = chat.participants as Array<{ type: string; [key: string]: unknown }>;
            let modified = false;

            for (let i = 0; i < participants.length; i++) {
              const participant = participants[i];
              if (participant.type === 'PERSONA') {
                // Convert PERSONA participant to CHARACTER
                participants[i] = {
                  ...participant,
                  type: 'CHARACTER',
                  characterId: participant.personaId, // Persona ID is now character ID
                  personaId: null, // Clear personaId
                  controlledBy: 'user', // User-controlled
                };
                modified = true;
                stats.participantsUpdated++;
              }
            }

            if (modified) {
              await chatsCollection.updateOne(
                { id: chat.id },
                {
                  $set: {
                    participants,
                    updatedAt: new Date().toISOString(),
                  },
                }
              );

              logger.debug('Updated chat participants', {
                context: 'migration.migrate-personas-to-characters',
                chatId: chat.id,
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({
              type: 'chat',
              id: chat.id as string,
              error: errorMessage,
            });
            logger.error('Failed to update chat participants', {
              context: 'migration.migrate-personas-to-characters',
              chatId: chat.id,
              error: errorMessage,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to query chats for participant update', {
          context: 'migration.migrate-personas-to-characters',
          error: errorMessage,
        });
      }

      // ========================================
      // Step 3: Migrate memories - personaId → aboutCharacterId
      // ========================================
      logger.info('Migrating memories: personaId → aboutCharacterId', {
        context: 'migration.migrate-personas-to-characters',
      });

      try {
        // First, copy personaId to aboutCharacterId where aboutCharacterId is not set
        const copyResult = await memoriesCollection.updateMany(
          {
            personaId: { $exists: true, $ne: null },
            $or: [
              { aboutCharacterId: { $exists: false } },
              { aboutCharacterId: null },
            ],
          },
          [
            {
              $set: {
                aboutCharacterId: '$personaId',
              },
            },
          ]
        );

        logger.info('Copied personaId to aboutCharacterId', {
          context: 'migration.migrate-personas-to-characters',
          matched: copyResult.matchedCount,
          modified: copyResult.modifiedCount,
        });

        // Then, remove personaId from all memories
        const removeResult = await memoriesCollection.updateMany(
          { personaId: { $exists: true } },
          { $unset: { personaId: '' } }
        );

        stats.memoriesMigrated = removeResult.modifiedCount;

        logger.info('Removed personaId from memories', {
          context: 'migration.migrate-personas-to-characters',
          modified: removeResult.modifiedCount,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to migrate memories', {
          context: 'migration.migrate-personas-to-characters',
          error: errorMessage,
        });
        errors.push({
          type: 'memories',
          id: 'bulk-update',
          error: errorMessage,
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Personas-to-characters migration failed', {
        context: 'migration.migrate-personas-to-characters',
        error: errorMessage,
      });

      return {
        id: 'migrate-personas-to-characters-v1',
        success: false,
        itemsAffected: stats.personasMigrated + stats.participantsUpdated + stats.memoriesMigrated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const totalAffected = stats.personasMigrated + stats.participantsUpdated + stats.memoriesMigrated;
    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Personas-to-characters migration completed', {
      context: 'migration.migrate-personas-to-characters',
      stats,
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-personas-to-characters-v1',
      success,
      itemsAffected: totalAffected,
      message: success
        ? `Migrated ${stats.personasMigrated} personas to characters, updated ${stats.participantsUpdated} chat participants, migrated ${stats.memoriesMigrated} memories`
        : `Migrated with ${errors.length} errors: ${stats.personasMigrated} personas, ${stats.participantsUpdated} participants, ${stats.memoriesMigrated} memories`,
      error: errors.length > 0
        ? `Errors: ${errors.map(e => `${e.type}:${e.id}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
