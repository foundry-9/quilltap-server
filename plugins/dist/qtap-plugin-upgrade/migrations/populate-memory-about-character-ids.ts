/**
 * Migration: Populate Memory About Character IDs
 *
 * This migration retroactively populates the aboutCharacterId field for existing
 * memories that have chatId but null aboutCharacterId. It looks up the chat to
 * find the user-controlled character and sets aboutCharacterId to that character's ID.
 *
 * This fixes memories created before the aboutCharacterId field was properly
 * populated during memory extraction.
 *
 * Migration ID: populate-memory-about-character-ids-v1
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '../lib/plugin-logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';

const MIGRATION_CONTEXT = 'migration.populate-memory-about-character-ids';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for populate-memory-about-character-ids migration', {
      context: MIGRATION_CONTEXT,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are memories needing migration (null aboutCharacterId with chatId)
 */
async function hasMemoriesNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const memoriesCollection = db.collection('memories');
    const count = await memoriesCollection.countDocuments({
      aboutCharacterId: null,
      chatId: { $ne: null },
    });
    return count > 0;
  } catch (error) {
    logger.debug('Error checking memories for populate-about-character-ids migration', {
      context: MIGRATION_CONTEXT,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Populate Memory About Character IDs Migration
 */
export const populateMemoryAboutCharacterIdsMigration: Migration = {
  id: 'populate-memory-about-character-ids-v1',
  description: 'Populate aboutCharacterId for existing memories by looking up user-controlled characters in chats',
  introducedInVersion: '2.6.0',
  dependsOn: ['add-inter-character-memory-fields-v1'],  // Run after the field exists

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      logger.debug('MongoDB not enabled, skipping populate-memory-about-character-ids migration', {
        context: MIGRATION_CONTEXT,
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring populate-memory-about-character-ids migration', {
        context: MIGRATION_CONTEXT,
      });
      return false;
    }

    // Check if there are memories needing migration
    const needsRun = await hasMemoriesNeedingMigration();

    logger.debug('Checked for populate-memory-about-character-ids migration need', {
      context: MIGRATION_CONTEXT,
      needsRun,
    });

    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let memoriesUpdated = 0;
    let memoriesSkipped = 0;
    let chatsNotFound = 0;
    let noUserCharacter = 0;

    logger.info('Starting populate-memory-about-character-ids migration', {
      context: MIGRATION_CONTEXT,
    });

    try {
      const db = await getMongoDatabase();
      const memoriesCollection = db.collection('memories');
      const chatsCollection = db.collection('chats');

      // Build a map of chatId -> user-controlled characterId for efficiency
      // First, get all distinct chatIds from memories that need migration
      const memoriesNeedingMigration = await memoriesCollection.find({
        aboutCharacterId: null,
        chatId: { $ne: null },
      }).toArray();

      logger.info('Found memories needing migration', {
        context: MIGRATION_CONTEXT,
        count: memoriesNeedingMigration.length,
      });

      // Get unique chat IDs
      const chatIds = [...new Set(memoriesNeedingMigration.map(m => m.chatId).filter(Boolean))];

      logger.debug('Found unique chat IDs to process', {
        context: MIGRATION_CONTEXT,
        chatCount: chatIds.length,
      });

      // Build chatId -> userCharacterId map
      const chatToUserCharacterMap = new Map<string, string>();

      for (const chatId of chatIds) {
        const chat = await chatsCollection.findOne({ id: chatId });
        if (!chat) {
          chatsNotFound++;
          continue;
        }

        // Find the user-controlled character in the chat
        // Priority: explicitly user-controlled CHARACTER participant
        const participants = chat.participants || [];
        const userControlledParticipant = participants.find(
          (p: { type: string; controlledBy?: string; characterId?: string | null }) =>
            p.type === 'CHARACTER' &&
            p.controlledBy === 'user' &&
            p.characterId
        );

        if (userControlledParticipant && userControlledParticipant.characterId) {
          chatToUserCharacterMap.set(chatId, userControlledParticipant.characterId);
        } else {
          noUserCharacter++;
        }
      }

      logger.debug('Built chat to user-character map', {
        context: MIGRATION_CONTEXT,
        mappedChats: chatToUserCharacterMap.size,
        chatsNotFound,
        noUserCharacter,
      });

      // Now update memories in batches
      for (const memory of memoriesNeedingMigration) {
        const chatId = memory.chatId;
        if (!chatId) {
          memoriesSkipped++;
          continue;
        }

        const userCharacterId = chatToUserCharacterMap.get(chatId);
        if (!userCharacterId) {
          memoriesSkipped++;
          continue;
        }

        // Update the memory
        await memoriesCollection.updateOne(
          { id: memory.id },
          { $set: { aboutCharacterId: userCharacterId } }
        );
        memoriesUpdated++;
      }

      logger.info('Memories updated with aboutCharacterId', {
        context: MIGRATION_CONTEXT,
        updated: memoriesUpdated,
        skipped: memoriesSkipped,
        chatsNotFound,
        noUserCharacter,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Populate-memory-about-character-ids migration failed', {
        context: MIGRATION_CONTEXT,
        error: errorMessage,
      });

      return {
        id: 'populate-memory-about-character-ids-v1',
        success: false,
        itemsAffected: memoriesUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const durationMs = Date.now() - startTime;

    logger.info('Populate-memory-about-character-ids migration completed successfully', {
      context: MIGRATION_CONTEXT,
      memoriesUpdated,
      memoriesSkipped,
      chatsNotFound,
      noUserCharacter,
      durationMs,
    });

    return {
      id: 'populate-memory-about-character-ids-v1',
      success: true,
      itemsAffected: memoriesUpdated,
      message: `Populated aboutCharacterId for ${memoriesUpdated} memories (skipped ${memoriesSkipped}, ${chatsNotFound} chats not found, ${noUserCharacter} chats without user character)`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
