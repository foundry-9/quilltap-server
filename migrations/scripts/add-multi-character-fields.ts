/**
 * Migration: Add Multi-Character Chat Fields
 *
 * This migration adds fields required for multi-character chat support:
 * 1. Adds `talkativeness: 0.5` to all existing characters that don't have it
 * 2. Backfills `participantId` on existing messages:
 *    - For ASSISTANT messages: Set to the first CHARACTER participant's ID
 *    - For USER messages: Set to the first PERSONA participant's ID (if exists)
 * 3. Adds `hasHistoryAccess: false` and `joinScenario: null` to existing participants
 *
 * Migration ID: add-multi-character-fields-v1
 *
 * Note: This migration was moved from lib/mongodb/migrations/ to consolidate
 * all migration logic in the upgrade plugin.
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
    // Use database-level ping instead of admin ping - works without admin privileges
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for multi-character fields migration', {
      context: 'migration.add-multi-character-fields',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are characters without talkativeness field
 */
async function hasCharactersNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const charactersCollection = db.collection('characters');
    const count = await charactersCollection.countDocuments({
      talkativeness: { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check if there are chats with participants needing migration
 */
async function hasChatsNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const chatsCollection = db.collection('chats');
    // Check for chats with participants missing hasHistoryAccess
    const count = await chatsCollection.countDocuments({
      'participants.hasHistoryAccess': { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Add Multi-Character Fields Migration
 */
export const addMultiCharacterFieldsMigration: Migration = {
  id: 'add-multi-character-fields-v1',
  description: 'Add talkativeness to characters and participantId/hasHistoryAccess to chat participants',
  introducedInVersion: '2.4.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],  // Run after data migration to MongoDB

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if there's work to do
    const [hasCharacters, hasChats] = await Promise.all([
      hasCharactersNeedingMigration(),
      hasChatsNeedingMigration(),
    ]);

    const needsRun = hasCharacters || hasChats;
    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let charactersUpdated = 0;
    let chatsProcessed = 0;
    let messagesUpdated = 0;
    let participantsUpdated = 0;
    const errors: string[] = [];

    logger.info('Starting multi-character fields migration', {
      context: 'migration.add-multi-character-fields',
    });

    try {
      const db = await getMongoDatabase();

      // Step 1: Add talkativeness to characters
      const charactersCollection = db.collection('characters');
      const characterUpdateResult = await charactersCollection.updateMany(
        { talkativeness: { $exists: false } },
        { $set: { talkativeness: 0.5 } }
      );
      charactersUpdated = characterUpdateResult.modifiedCount;
      // Step 2: Process chats and their messages
      const chatsCollection = db.collection('chats');
      const chatsCursor = chatsCollection.find({});

      while (await chatsCursor.hasNext()) {
        const chat = await chatsCursor.next();
        if (!chat) continue;

        chatsProcessed++;

        try {
          // Update participants to have hasHistoryAccess and joinScenario
          if (chat.participants && Array.isArray(chat.participants)) {
            let participantsModified = false;

            for (const participant of chat.participants) {
              if (participant.hasHistoryAccess === undefined) {
                participant.hasHistoryAccess = false;
                participantsModified = true;
                participantsUpdated++;
              }
              if (participant.joinScenario === undefined) {
                participant.joinScenario = null;
                participantsModified = true;
              }
            }

            if (participantsModified) {
              await chatsCollection.updateOne(
                { _id: chat._id },
                { $set: { participants: chat.participants } }
              );
            }

            // Find CHARACTER and PERSONA participants for message backfill
            const characterParticipant = chat.participants.find(
              (p: { type: string }) => p.type === 'CHARACTER'
            );
            const personaParticipant = chat.participants.find(
              (p: { type: string }) => p.type === 'PERSONA'
            );

            // Backfill participantId on messages in this chat's events
            if (chat.events && Array.isArray(chat.events)) {
              let eventsModified = false;

              for (const event of chat.events) {
                if (event.type !== 'message') continue;
                if (event.participantId !== undefined) continue; // Already has participantId

                if (event.role === 'ASSISTANT' && characterParticipant) {
                  event.participantId = characterParticipant.id;
                  messagesUpdated++;
                  eventsModified = true;
                } else if (event.role === 'USER' && personaParticipant) {
                  event.participantId = personaParticipant.id;
                  messagesUpdated++;
                  eventsModified = true;
                } else if (event.role === 'SYSTEM' || event.role === 'TOOL') {
                  event.participantId = null;
                  eventsModified = true;
                }
              }

              if (eventsModified) {
                await chatsCollection.updateOne(
                  { _id: chat._id },
                  { $set: { events: chat.events } }
                );
              }
            }
          }
        } catch (chatError) {
          const errorMessage = chatError instanceof Error ? chatError.message : String(chatError);
          logger.error('Error processing chat in migration', {
            context: 'migration.add-multi-character-fields',
            chatId: chat.id,
            error: errorMessage,
          });
          errors.push(`Chat ${chat.id}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Multi-character fields migration failed', {
        context: 'migration.add-multi-character-fields',
        error: errorMessage,
      });

      return {
        id: 'add-multi-character-fields-v1',
        success: false,
        itemsAffected: charactersUpdated + messagesUpdated + participantsUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;
    const totalAffected = charactersUpdated + messagesUpdated + participantsUpdated;

    logger.info('Multi-character fields migration completed', {
      context: 'migration.add-multi-character-fields',
      success,
      charactersUpdated,
      chatsProcessed,
      messagesUpdated,
      participantsUpdated,
      durationMs,
    });

    return {
      id: 'add-multi-character-fields-v1',
      success,
      itemsAffected: totalAffected,
      message: success
        ? `Updated ${charactersUpdated} characters, ${messagesUpdated} messages, ${participantsUpdated} participants`
        : `Updated ${totalAffected} items with ${errors.length} errors`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
