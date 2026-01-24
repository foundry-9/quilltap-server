/**
 * Migration: Create LLM Logs Collection
 *
 * This migration creates the llm_logs collection with appropriate indexes
 * for LLM request/response logging functionality.
 *
 * Migration ID: add-llm-logs-collection-v1
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
    logger.warn('MongoDB is not accessible for LLM logs collection migration', {
      context: 'migration.add-llm-logs-collection',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if collection already has indexes
 */
async function hasIndexes(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const llmLogsCollection = db.collection('llm_logs');

    // Get existing indexes
    const indexes = await llmLogsCollection.listIndexes().toArray();

    // Check if we have more than just the default _id index
    return indexes.length > 1;
  } catch (error) {
    logger.debug('Error checking llm_logs collection indexes', {
      context: 'migration.add-llm-logs-collection',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Create LLM Logs Collection Migration
 */
export const addLLMLogsCollectionMigration: Migration = {
  id: 'add-llm-logs-collection-v1',
  description: 'Create llm_logs collection with indexes for LLM request/response logging',
  introducedInVersion: '2.8.0',
  dependsOn: ['migrate-json-to-mongodb-v3'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      logger.debug('MongoDB not enabled, skipping LLM logs collection migration', {
        context: 'migration.add-llm-logs-collection',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring LLM logs collection migration', {
        context: 'migration.add-llm-logs-collection',
      });
      return false;
    }

    // Only run if indexes don't already exist (first time setup)
    const hasExistingIndexes = await hasIndexes();
    if (hasExistingIndexes) {
      logger.debug('LLM logs collection already has indexes, skipping migration', {
        context: 'migration.add-llm-logs-collection',
      });
      return false;
    }

    return true;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let indexesCreated = 0;
    const errors: string[] = [];

    logger.info('Starting LLM logs collection migration', {
      context: 'migration.add-llm-logs-collection',
    });

    try {
      const db = await getMongoDatabase();
      const llmLogsCollection = db.collection('llm_logs');

      logger.debug('Creating indexes on llm_logs collection', {
        context: 'migration.add-llm-logs-collection',
      });

      // Compound index on userId and createdAt for listing user logs by date
      try {
        await llmLogsCollection.createIndex(
          { userId: 1, createdAt: -1 },
          { background: true, name: 'userId_createdAt_idx' }
        );
        indexesCreated++;
        logger.debug('Created index: userId + createdAt (desc)', {
          context: 'migration.add-llm-logs-collection',
        });
      } catch (indexError) {
        const errorMessage = indexError instanceof Error ? indexError.message : String(indexError);
        errors.push(`userId + createdAt index: ${errorMessage}`);
        logger.warn('Failed to create userId + createdAt index', {
          context: 'migration.add-llm-logs-collection',
          error: errorMessage,
        });
      }

      // Index on messageId for finding logs by message (sparse)
      try {
        await llmLogsCollection.createIndex(
          { messageId: 1 },
          { sparse: true, background: true, name: 'messageId_idx' }
        );
        indexesCreated++;
        logger.debug('Created index: messageId (sparse)', {
          context: 'migration.add-llm-logs-collection',
        });
      } catch (indexError) {
        const errorMessage = indexError instanceof Error ? indexError.message : String(indexError);
        errors.push(`messageId index: ${errorMessage}`);
        logger.warn('Failed to create messageId index', {
          context: 'migration.add-llm-logs-collection',
          error: errorMessage,
        });
      }

      // Index on chatId for finding logs by chat (sparse)
      try {
        await llmLogsCollection.createIndex(
          { chatId: 1 },
          { sparse: true, background: true, name: 'chatId_idx' }
        );
        indexesCreated++;
        logger.debug('Created index: chatId (sparse)', {
          context: 'migration.add-llm-logs-collection',
        });
      } catch (indexError) {
        const errorMessage = indexError instanceof Error ? indexError.message : String(indexError);
        errors.push(`chatId index: ${errorMessage}`);
        logger.warn('Failed to create chatId index', {
          context: 'migration.add-llm-logs-collection',
          error: errorMessage,
        });
      }

      // Index on characterId for finding logs by character (sparse)
      try {
        await llmLogsCollection.createIndex(
          { characterId: 1 },
          { sparse: true, background: true, name: 'characterId_idx' }
        );
        indexesCreated++;
        logger.debug('Created index: characterId (sparse)', {
          context: 'migration.add-llm-logs-collection',
        });
      } catch (indexError) {
        const errorMessage = indexError instanceof Error ? indexError.message : String(indexError);
        errors.push(`characterId index: ${errorMessage}`);
        logger.warn('Failed to create characterId index', {
          context: 'migration.add-llm-logs-collection',
          error: errorMessage,
        });
      }

      // Compound index on userId and type for filtering by type
      try {
        await llmLogsCollection.createIndex(
          { userId: 1, type: 1 },
          { background: true, name: 'userId_type_idx' }
        );
        indexesCreated++;
        logger.debug('Created index: userId + type', {
          context: 'migration.add-llm-logs-collection',
        });
      } catch (indexError) {
        const errorMessage = indexError instanceof Error ? indexError.message : String(indexError);
        errors.push(`userId + type index: ${errorMessage}`);
        logger.warn('Failed to create userId + type index', {
          context: 'migration.add-llm-logs-collection',
          error: errorMessage,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LLM logs collection migration failed', {
        context: 'migration.add-llm-logs-collection',
        error: errorMessage,
      });

      return {
        id: 'add-llm-logs-collection-v1',
        success: false,
        itemsAffected: indexesCreated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('LLM logs collection migration completed', {
      context: 'migration.add-llm-logs-collection',
      success,
      indexesCreated,
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'add-llm-logs-collection-v1',
      success,
      itemsAffected: indexesCreated,
      message: `Created ${indexesCreated} indexes on llm_logs collection${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
