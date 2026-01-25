/**
 * Migration: Add useNativeWebSearch Field
 *
 * This migration adds the useNativeWebSearch field to connection_profiles.
 * This decouples the web search tool (allowWebSearch) from native provider
 * web search integration (useNativeWebSearch).
 *
 * - allowWebSearch: Controls whether the search_web tool is provided to the LLM
 * - useNativeWebSearch: Controls whether to use the provider's native web search
 *
 * Default is false (tool-only) so existing profiles get the new tool-based behavior.
 *
 * Migration ID: add-use-native-web-search-field-v1
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
    logger.warn('MongoDB is not accessible for useNativeWebSearch field migration', {
      context: 'migration.add-use-native-web-search-field',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if there are profiles without useNativeWebSearch field
 */
async function hasProfilesNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const profilesCollection = db.collection('connection_profiles');
    const count = await profilesCollection.countDocuments({
      useNativeWebSearch: { $exists: false },
    });
    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Add useNativeWebSearch Field Migration
 */
export const addUseNativeWebSearchFieldMigration: Migration = {
  id: 'add-use-native-web-search-field-v1',
  description: 'Add useNativeWebSearch field to connection profiles to decouple tool from native web search',
  introducedInVersion: '2.7.0',
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

    // Check if there are profiles needing migration
    const needsRun = await hasProfilesNeedingMigration();
    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let profilesUpdated = 0;

    logger.info('Starting useNativeWebSearch field migration', {
      context: 'migration.add-use-native-web-search-field',
    });

    try {
      const db = await getMongoDatabase();

      // Add useNativeWebSearch field to connection_profiles
      // Default to false so existing profiles get tool-based web search
      const profilesCollection = db.collection('connection_profiles');
      const profilesResult = await profilesCollection.updateMany(
        { useNativeWebSearch: { $exists: false } },
        {
          $set: {
            useNativeWebSearch: false,
          },
        }
      );
      profilesUpdated = profilesResult.modifiedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('useNativeWebSearch field migration failed', {
        context: 'migration.add-use-native-web-search-field',
        error: errorMessage,
      });

      return {
        id: 'add-use-native-web-search-field-v1',
        success: false,
        itemsAffected: profilesUpdated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const durationMs = Date.now() - startTime;

    logger.info('useNativeWebSearch field migration completed successfully', {
      context: 'migration.add-use-native-web-search-field',
      profilesUpdated,
      durationMs,
    });

    return {
      id: 'add-use-native-web-search-field-v1',
      success: true,
      itemsAffected: profilesUpdated,
      message: `Added useNativeWebSearch field to ${profilesUpdated} connection profiles`,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
