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
 */

import { Db } from 'mongodb';
import { logger } from '@/lib/logger';
import { getMongoMigrationsRepository } from '@/lib/mongodb/repositories/migrations.repository';

const MIGRATION_ID = 'add-multi-character-fields-v1';

interface MigrationResult {
  success: boolean;
  charactersUpdated: number;
  chatsProcessed: number;
  messagesUpdated: number;
  participantsUpdated: number;
  errors: string[];
}

/**
 * Run the multi-character fields migration
 */
export async function runMultiCharacterFieldsMigration(db: Db): Promise<MigrationResult> {
  const migrationsRepo = getMongoMigrationsRepository();

  logger.info('Starting multi-character fields migration', { migrationId: MIGRATION_ID });

  // Check if already completed
  const isCompleted = await migrationsRepo.isMigrationCompleted(MIGRATION_ID);
  if (isCompleted) {
    logger.info('Migration already completed, skipping', { migrationId: MIGRATION_ID });
    return {
      success: true,
      charactersUpdated: 0,
      chatsProcessed: 0,
      messagesUpdated: 0,
      participantsUpdated: 0,
      errors: [],
    };
  }

  const result: MigrationResult = {
    success: true,
    charactersUpdated: 0,
    chatsProcessed: 0,
    messagesUpdated: 0,
    participantsUpdated: 0,
    errors: [],
  };

  try {
    // Step 1: Add talkativeness to characters
    logger.debug('Step 1: Adding talkativeness to characters without it');
    const charactersCollection = db.collection('characters');
    const characterUpdateResult = await charactersCollection.updateMany(
      { talkativeness: { $exists: false } },
      { $set: { talkativeness: 0.5 } }
    );
    result.charactersUpdated = characterUpdateResult.modifiedCount;
    logger.debug('Characters updated with talkativeness', { count: result.charactersUpdated });

    // Step 2: Process chats and their messages
    logger.debug('Step 2: Processing chats for participant field updates');
    const chatsCollection = db.collection('chats');
    const chatsCursor = chatsCollection.find({});

    while (await chatsCursor.hasNext()) {
      const chat = await chatsCursor.next();
      if (!chat) continue;

      result.chatsProcessed++;

      try {
        // Update participants to have hasHistoryAccess and joinScenario
        if (chat.participants && Array.isArray(chat.participants)) {
          let participantsModified = false;

          for (const participant of chat.participants) {
            if (participant.hasHistoryAccess === undefined) {
              participant.hasHistoryAccess = false;
              participantsModified = true;
              result.participantsUpdated++;
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
                result.messagesUpdated++;
                eventsModified = true;
              } else if (event.role === 'USER' && personaParticipant) {
                event.participantId = personaParticipant.id;
                result.messagesUpdated++;
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
          chatId: chat.id,
          error: errorMessage,
        });
        result.errors.push(`Chat ${chat.id}: ${errorMessage}`);
      }
    }

    // Record migration as completed
    const packageJson = await import('@/package.json');
    await migrationsRepo.recordCompletedMigration({
      id: MIGRATION_ID,
      completedAt: new Date().toISOString(),
      quilltapVersion: packageJson.version,
      itemsAffected: result.charactersUpdated + result.messagesUpdated + result.participantsUpdated,
      message: `Updated ${result.charactersUpdated} characters, ${result.messagesUpdated} messages, ${result.participantsUpdated} participants`,
    });

    logger.info('Multi-character fields migration completed successfully', {
      migrationId: MIGRATION_ID,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Multi-character fields migration failed', {
      migrationId: MIGRATION_ID,
      error: errorMessage,
    });
    result.success = false;
    result.errors.push(errorMessage);
  }

  return result;
}

/**
 * Check if the migration needs to be run
 */
export async function needsMultiCharacterFieldsMigration(): Promise<boolean> {
  const migrationsRepo = getMongoMigrationsRepository();
  const isCompleted = await migrationsRepo.isMigrationCompleted(MIGRATION_ID);
  return !isCompleted;
}

/**
 * Get the migration ID
 */
export function getMultiCharacterMigrationId(): string {
  return MIGRATION_ID;
}
