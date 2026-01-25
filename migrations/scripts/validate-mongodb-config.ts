/**
 * Migration: Validate MongoDB Configuration
 *
 * Validates MongoDB configuration and connectivity before data migration.
 * This migration ensures that all MongoDB settings are correctly configured
 * and that a connection can be established before attempting any data migration.
 */

import { logger } from '../lib/logger';
import { validateMongoDBConfig, testMongoDBConnection } from '../lib/mongodb-utils';
import type { Migration, MigrationResult } from '../types';

/**
 * Validate MongoDB configuration and connectivity migration
 */
export const validateMongoDBConfigMigration: Migration = {
  id: 'validate-mongodb-config-v1',
  description: 'Validate MongoDB configuration and connectivity before data migration',
  introducedInVersion: '2.0.0',

  async shouldRun(): Promise<boolean> {
    // Check legacy DATA_BACKEND first (backward compatibility)
    const legacyBackend = process.env.DATA_BACKEND?.toLowerCase();
    const databaseBackend = legacyBackend === 'mongodb'
      ? 'mongodb'
      : (process.env.DATABASE_BACKEND?.toLowerCase() || 'sqlite');
    // Only run if database backend is set to MongoDB
    const shouldRun = databaseBackend === 'mongodb';

    if (shouldRun) {
    } else {
    }

    return shouldRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    try {
      // Step 1: Validate configuration
      const config = validateMongoDBConfig();

      if (!config.isConfigured) {
        const errorMessage = `MongoDB configuration validation failed: ${config.errors.join('; ')}`;

        logger.error('MongoDB configuration is not valid', {
          context: 'migration.validate-mongodb-config',
          errors: config.errors,
          itemsAffected: 0,
        });

        return {
          id: 'validate-mongodb-config-v1',
          success: false,
          itemsAffected: 0,
          message: errorMessage,
          error: config.errors.join('; '),
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }
      // Step 2: Test MongoDB connection
      const connectionTest = await testMongoDBConnection();

      if (!connectionTest.success) {
        logger.error('MongoDB connection test failed', {
          context: 'migration.validate-mongodb-config',
          message: connectionTest.message,
          latencyMs: connectionTest.latencyMs,
        });

        return {
          id: 'validate-mongodb-config-v1',
          success: false,
          itemsAffected: 0,
          message: connectionTest.message,
          error: connectionTest.message,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Both validation and connection test passed
      const successMessage = `MongoDB configuration validated and connection test successful${connectionTest.latencyMs ? ` (${connectionTest.latencyMs}ms latency)` : ''}`;

      logger.info('MongoDB configuration validation and connection test passed', {
        context: 'migration.validate-mongodb-config',
        database: config.database,
        mode: config.mode,
        latencyMs: connectionTest.latencyMs,
        durationMs: Date.now() - startTime,
      });

      return {
        id: 'validate-mongodb-config-v1',
        success: true,
        itemsAffected: 1,
        message: successMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during MongoDB validation';

      logger.error('Unexpected error during MongoDB configuration validation', {
        context: 'migration.validate-mongodb-config',
        error: errorMessage,
      }, error instanceof Error ? error : undefined);

      return {
        id: 'validate-mongodb-config-v1',
        success: false,
        itemsAffected: 0,
        message: `Unexpected error during validation: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
