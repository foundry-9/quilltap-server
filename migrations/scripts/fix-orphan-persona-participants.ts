/**
 * Migration: Fix Orphan PERSONA Participants
 *
 * Fixes issues left over from incomplete PERSONA → CHARACTER migration:
 *
 * 1. Chats with PERSONA participants where personaId/characterId is null
 *    - These participants cannot be converted to valid CHARACTER participants
 *    - Removes the invalid participant from the chat
 *    - If chat has no valid participants left, deletes the chat
 *
 * 2. Sync operations with entityType: 'PERSONA' in conflicts array
 *    - PERSONA is no longer a valid entity type
 *    - Removes PERSONA conflicts from sync_operations
 *
 * This migration is idempotent and depends on the original personas-to-characters migration.
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for fix-orphan-persona-participants migration', {
      context: 'migration.fix-orphan-persona-participants',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are chats with invalid PERSONA participants
 */
async function getChatsWithInvalidPersonaParticipants(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const chatsCollection = db.collection('chats');

    // Find chats with PERSONA participants OR participants with null characterId
    const count = await chatsCollection.countDocuments({
      $or: [
        { 'participants.type': 'PERSONA' },
        { 'participants.characterId': null },
      ],
    });

    return count;
  } catch (error) {
    logger.error('Error checking for chats with invalid participants', {
      context: 'migration.fix-orphan-persona-participants',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Check if there are sync operations with PERSONA entity types
 */
async function getSyncOpsWithPersonaEntityType(): Promise<number> {
  try {
    const db = await getMongoDatabase();
    const syncOpsCollection = db.collection('sync_operations');

    // Find sync operations with PERSONA in conflicts
    const count = await syncOpsCollection.countDocuments({
      'conflicts.entityType': 'PERSONA',
    });

    return count;
  } catch (error) {
    logger.error('Error checking for sync ops with PERSONA entity type', {
      context: 'migration.fix-orphan-persona-participants',
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Fix Orphan PERSONA Participants Migration
 */
export const fixOrphanPersonaParticipantsMigration: Migration = {
  id: 'fix-orphan-persona-participants-v1',
  description: 'Fix chat participants with PERSONA type and clean up sync operations',
  introducedInVersion: '2.7.0',
  dependsOn: ['migrate-personas-to-characters-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if there are issues to fix
    const chatsCount = await getChatsWithInvalidPersonaParticipants();
    const syncOpsCount = await getSyncOpsWithPersonaEntityType();
    return chatsCount > 0 || syncOpsCount > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const stats = {
      participantsRemoved: 0,
      participantsConverted: 0,
      chatsUpdated: 0,
      chatsDeleted: 0,
      syncOpsUpdated: 0,
    };
    const errors: Array<{ type: string; id: string; error: string }> = [];

    logger.info('Starting fix-orphan-persona-participants migration', {
      context: 'migration.fix-orphan-persona-participants',
    });

    try {
      const db = await getMongoDatabase();
      const chatsCollection = db.collection('chats');
      const syncOpsCollection = db.collection('sync_operations');

      // ========================================
      // Step 1: Fix chat participants
      // ========================================
      logger.info('Fixing invalid chat participants', {
        context: 'migration.fix-orphan-persona-participants',
      });

      // Find all chats with problematic participants
      const problematicChats = await chatsCollection.find({
        $or: [
          { 'participants.type': 'PERSONA' },
          { 'participants.characterId': null },
        ],
      }).toArray();

      logger.info('Found chats with problematic participants', {
        context: 'migration.fix-orphan-persona-participants',
        count: problematicChats.length,
      });

      for (const chat of problematicChats) {
        try {
          const participants = chat.participants as Array<{
            id: string;
            type: string;
            characterId?: string | null;
            personaId?: string | null;
            controlledBy?: string;
            [key: string]: unknown;
          }>;

          const validParticipants: typeof participants = [];
          let modified = false;

          for (const participant of participants) {
            // Check if this is a PERSONA participant that needs conversion
            if (participant.type === 'PERSONA') {
              // Try to get a valid characterId from personaId
              const characterId = participant.personaId || participant.characterId;

              if (characterId) {
                // Convert to CHARACTER
                validParticipants.push({
                  ...participant,
                  type: 'CHARACTER',
                  characterId,
                  personaId: null,
                  controlledBy: participant.controlledBy || 'user',
                });
                stats.participantsConverted++;
                modified = true;
              } else {
                // No valid ID - remove this participant
                stats.participantsRemoved++;
                modified = true;

                logger.warn('Removed invalid PERSONA participant (no characterId)', {
                  context: 'migration.fix-orphan-persona-participants',
                  chatId: chat.id,
                  participantId: participant.id,
                });
              }
            } else if (participant.characterId === null || participant.characterId === undefined) {
              // CHARACTER type but null characterId - also invalid
              stats.participantsRemoved++;
              modified = true;

              logger.warn('Removed invalid CHARACTER participant (null characterId)', {
                context: 'migration.fix-orphan-persona-participants',
                chatId: chat.id,
                participantId: participant.id,
              });
            } else {
              // Valid participant - keep it
              validParticipants.push(participant);
            }
          }

          if (modified) {
            if (validParticipants.length === 0) {
              // No valid participants - delete the chat
              await chatsCollection.deleteOne({ id: chat.id });
              stats.chatsDeleted++;

              logger.info('Deleted chat with no valid participants', {
                context: 'migration.fix-orphan-persona-participants',
                chatId: chat.id,
                chatTitle: chat.title,
              });
            } else {
              // Update with valid participants
              await chatsCollection.updateOne(
                { id: chat.id },
                {
                  $set: {
                    participants: validParticipants,
                    updatedAt: new Date().toISOString(),
                  },
                }
              );
              stats.chatsUpdated++;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            type: 'chat',
            id: chat.id as string,
            error: errorMessage,
          });
          logger.error('Failed to fix chat participants', {
            context: 'migration.fix-orphan-persona-participants',
            chatId: chat.id,
            error: errorMessage,
          });
        }
      }

      // ========================================
      // Step 2: Clean up sync operations
      // ========================================
      logger.info('Cleaning up sync operations with PERSONA entity types', {
        context: 'migration.fix-orphan-persona-participants',
      });

      try {
        // Remove PERSONA conflicts from sync operations
        const syncOpsWithPersona = await syncOpsCollection.find({
          'conflicts.entityType': 'PERSONA',
        }).toArray();

        for (const syncOp of syncOpsWithPersona) {
          try {
            const conflicts = syncOp.conflicts as Array<{ entityType: string; [key: string]: unknown }>;
            const cleanedConflicts = conflicts.filter(c => c.entityType !== 'PERSONA');

            await syncOpsCollection.updateOne(
              { id: syncOp.id },
              {
                $set: {
                  conflicts: cleanedConflicts,
                  updatedAt: new Date().toISOString(),
                },
              }
            );
            stats.syncOpsUpdated++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({
              type: 'sync_operation',
              id: syncOp.id as string,
              error: errorMessage,
            });
            logger.error('Failed to clean up sync operation', {
              context: 'migration.fix-orphan-persona-participants',
              syncOpId: syncOp.id,
              error: errorMessage,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to query sync operations', {
          context: 'migration.fix-orphan-persona-participants',
          error: errorMessage,
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Fix-orphan-persona-participants migration failed', {
        context: 'migration.fix-orphan-persona-participants',
        error: errorMessage,
      });

      return {
        id: 'fix-orphan-persona-participants-v1',
        success: false,
        itemsAffected: 0,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const totalAffected =
      stats.participantsRemoved +
      stats.participantsConverted +
      stats.chatsDeleted +
      stats.syncOpsUpdated;
    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Fix-orphan-persona-participants migration completed', {
      context: 'migration.fix-orphan-persona-participants',
      stats,
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'fix-orphan-persona-participants-v1',
      success,
      itemsAffected: totalAffected,
      message: success
        ? `Fixed ${stats.chatsUpdated} chats (${stats.participantsConverted} converted, ${stats.participantsRemoved} removed), deleted ${stats.chatsDeleted} invalid chats, cleaned ${stats.syncOpsUpdated} sync operations`
        : `Fixed with ${errors.length} errors`,
      error: errors.length > 0
        ? `Errors: ${errors.map(e => `${e.type}:${e.id}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
