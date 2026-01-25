/**
 * Migration: Add Token Tracking Fields
 *
 * This migration adds token tracking fields to connection_profiles and chats:
 * - connection_profiles: totalTokens, totalPromptTokens, totalCompletionTokens, messageCount
 * - chats: totalPromptTokens, totalCompletionTokens, estimatedCostUSD, showSystemEventsOverride
 *
 * Migration ID: add-token-tracking-fields-v1
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
    logger.warn('MongoDB is not accessible for token tracking fields migration', {
      context: 'migration.add-token-tracking-fields',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are profiles without token tracking fields
 */
async function hasProfilesNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const profilesCollection = db.collection('connection_profiles');
    const count = await profilesCollection.countDocuments({
      totalTokens: { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check if there are chats without token tracking fields
 */
async function hasChatsNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const chatsCollection = db.collection('chats');
    const count = await chatsCollection.countDocuments({
      totalPromptTokens: { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Add Token Tracking Fields Migration
 */
export const addTokenTrackingFieldsMigration: Migration = {
  id: 'add-token-tracking-fields-v1',
  description: 'Add token tracking fields to connection profiles and chats for usage monitoring',
  introducedInVersion: '2.6.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    // Check if there are profiles or chats needing migration
    const profilesNeedMigration = await hasProfilesNeedingMigration();
    const chatsNeedMigration = await hasChatsNeedingMigration();
    const needsRun = profilesNeedMigration || chatsNeedMigration;
    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let profilesUpdated = 0;
    let chatsUpdated = 0;

    logger.info('Starting token tracking fields migration', {
      context: 'migration.add-token-tracking-fields',
    });

    try {
      const db = await getMongoDatabase();

      // Add token tracking fields to connection_profiles
      const profilesCollection = db.collection('connection_profiles');
      const profilesResult = await profilesCollection.updateMany(
        { totalTokens: { $exists: false } },
        {
          $set: {
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            messageCount: 0,
          },
        }
      );
      profilesUpdated = profilesResult.modifiedCount;
      // Add token tracking fields to chats
      const chatsCollection = db.collection('chats');
      const chatsResult = await chatsCollection.updateMany(
        { totalPromptTokens: { $exists: false } },
        {
          $set: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            estimatedCostUSD: null,
            showSystemEventsOverride: null,
          },
        }
      );
      chatsUpdated = chatsResult.modifiedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Token tracking fields migration failed', {
        context: 'migration.add-token-tracking-fields',
        error: errorMessage,
      });

      return {
        id: 'add-token-tracking-fields-v1',
        success: false,
        itemsAffected: profilesUpdated + chatsUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const durationMs = Date.now() - startTime;
    const totalAffected = profilesUpdated + chatsUpdated;

    logger.info('Token tracking fields migration completed successfully', {
      context: 'migration.add-token-tracking-fields',
      profilesUpdated,
      chatsUpdated,
      durationMs,
    });

    return {
      id: 'add-token-tracking-fields-v1',
      success: true,
      itemsAffected: totalAffected,
      message: `Added token tracking fields to ${profilesUpdated} profiles and ${chatsUpdated} chats`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
