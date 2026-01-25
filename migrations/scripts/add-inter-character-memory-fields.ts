/**
 * Migration: Add Inter-Character Memory Fields
 *
 * This migration adds the aboutCharacterId field to memories to support
 * character-to-character memories in multi-character chats.
 *
 * Migration ID: add-inter-character-memory-fields-v1
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
    logger.warn('MongoDB is not accessible for inter-character memory fields migration', {
      context: 'migration.add-inter-character-memory-fields',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are memories without aboutCharacterId field
 */
async function hasMemoriesNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const memoriesCollection = db.collection('memories');
    const count = await memoriesCollection.countDocuments({
      aboutCharacterId: { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Add Inter-Character Memory Fields Migration
 */
export const addInterCharacterMemoryFieldsMigration: Migration = {
  id: 'add-inter-character-memory-fields-v1',
  description: 'Add aboutCharacterId field to memories for character-to-character memories',
  introducedInVersion: '2.4.0',
  dependsOn: ['migrate-json-to-mongodb-v1', 'add-multi-character-fields-v1'],  // Run after multi-character fields

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if there are memories needing migration
    const needsRun = await hasMemoriesNeedingMigration();
    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let memoriesUpdated = 0;

    logger.info('Starting inter-character memory fields migration', {
      context: 'migration.add-inter-character-memory-fields',
    });

    try {
      const db = await getMongoDatabase();

      // Add aboutCharacterId: null to all existing memories that don't have it
      const memoriesCollection = db.collection('memories');
      const updateResult = await memoriesCollection.updateMany(
        { aboutCharacterId: { $exists: false } },
        { $set: { aboutCharacterId: null } }
      );
      memoriesUpdated = updateResult.modifiedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Inter-character memory fields migration failed', {
        context: 'migration.add-inter-character-memory-fields',
        error: errorMessage,
      });

      return {
        id: 'add-inter-character-memory-fields-v1',
        success: false,
        itemsAffected: memoriesUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const durationMs = Date.now() - startTime;

    logger.info('Inter-character memory fields migration completed successfully', {
      context: 'migration.add-inter-character-memory-fields',
      memoriesUpdated,
      durationMs,
    });

    return {
      id: 'add-inter-character-memory-fields-v1',
      success: true,
      itemsAffected: memoriesUpdated,
      message: `Added aboutCharacterId field to ${memoriesUpdated} memories`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
