/**
 * Startup Module Exports
 *
 * Centralized exports for all startup/initialization functionality.
 */

import { getMongoDatabase, setupMongoDBShutdownHandlers } from '@/lib/mongodb/client';
import { validateMongoDBConfig, testMongoDBConnection } from '@/lib/mongodb/config';
import { ensureIndexes } from '@/lib/mongodb/indexes';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

// Plugin initialization
export {
  initializePlugins,
  isPluginSystemInitialized,
  resetPluginSystem,
  getPluginSystemState,
  type PluginInitializationResult,
} from './plugin-initialization';

/**
 * Result of service initialization attempt
 */
export interface ServiceInitializationResult {
  service: string;
  initialized: boolean;
  message: string;
  latencyMs?: number;
}

/**
 * Initialize MongoDB if enabled in configuration
 *
 * Checks DATA_BACKEND environment variable to determine if MongoDB
 * should be initialized. If enabled, validates configuration, tests
 * connection, ensures indexes are created, and sets up shutdown handlers.
 */
export async function initializeMongoDBIfNeeded(): Promise<ServiceInitializationResult> {
  const startTime = Date.now();
  const dataBackend = process.env.DATA_BACKEND?.toLowerCase() || 'sqlite';

  logger.debug('Checking MongoDB initialization requirement', { dataBackend });

  // Check if MongoDB is enabled
  if (dataBackend !== 'mongodb' && dataBackend !== 'dual') {
    logger.debug('MongoDB not enabled', { dataBackend });
    return {
      service: 'mongodb',
      initialized: false,
      message: 'MongoDB not enabled',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    logger.info('Initializing MongoDB', { dataBackend });

    // Validate configuration
    logger.debug('Validating MongoDB configuration');
    validateMongoDBConfig();

    // Test connection
    logger.debug('Testing MongoDB connection');
    await testMongoDBConnection();

    // Get database and ensure indexes
    logger.debug('Getting MongoDB database connection');
    const db = await getMongoDatabase();

    logger.debug('Ensuring MongoDB indexes');
    await ensureIndexes(db);

    // Note: Migrations are now handled by the upgrade plugin during plugin initialization
    // See: plugins/dist/qtap-plugin-upgrade/

    // Setup shutdown handlers
    logger.debug('Setting up MongoDB shutdown handlers');
    setupMongoDBShutdownHandlers();

    const latency = Date.now() - startTime;
    logger.info('MongoDB initialized successfully', { latencyMs: latency });

    return {
      service: 'mongodb',
      initialized: true,
      message: 'MongoDB initialized successfully',
      latencyMs: latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    logger.error('MongoDB initialization failed', { error: errorMessage, latencyMs: latency });

    return {
      service: 'mongodb',
      initialized: false,
      message: `MongoDB initialization failed: ${errorMessage}`,
      latencyMs: latency,
    };
  }
}

/**
 * Initialize file storage if enabled
 *
 * Initializes the file storage manager which handles all storage operations
 * across configured mount points and backends.
 */
export async function initializeFileStorageIfNeeded(): Promise<ServiceInitializationResult> {
  const startTime = Date.now();

  logger.debug('Checking file storage initialization requirement');

  try {
    logger.info('Initializing file storage manager');

    // Initialize the file storage manager
    logger.debug('Initializing file storage manager instance');
    await fileStorageManager.initialize();

    const latency = Date.now() - startTime;
    logger.info('File storage initialized successfully', { latencyMs: latency });

    return {
      service: 'file-storage',
      initialized: true,
      message: 'File storage initialized successfully',
      latencyMs: latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    logger.error('File storage initialization failed', { error: errorMessage, latencyMs: latency });

    return {
      service: 'file-storage',
      initialized: false,
      message: `File storage initialization failed: ${errorMessage}`,
      latencyMs: latency,
    };
  }
}

/**
 * Initialize all services in parallel where possible
 *
 * Coordinates initialization of MongoDB, file storage, and the plugin system.
 * Services are initialized in parallel to minimize startup time.
 */
export async function initializeAllServices(): Promise<{
  mongodb: ServiceInitializationResult;
  fileStorage: ServiceInitializationResult;
  plugins: any; // Using any to avoid circular dependency with PluginInitializationResult
}> {
  logger.info('Starting service initialization');

  try {
    // Initialize MongoDB and file storage in parallel
    const [mongodbResult, fileStorageResult] = await Promise.all([
      initializeMongoDBIfNeeded(),
      initializeFileStorageIfNeeded(),
    ]);

    // Import plugins initialization dynamically to avoid circular deps
    const { initializePlugins } = await import('./plugin-initialization');

    // Initialize plugins
    logger.debug('Initializing plugin system');
    const pluginsResult = await initializePlugins();

    logger.info('All services initialized', {
      mongodb: { initialized: mongodbResult.initialized, service: mongodbResult.service },
      fileStorage: { initialized: fileStorageResult.initialized, service: fileStorageResult.service },
      plugins: { success: pluginsResult.success },
    });

    return {
      mongodb: mongodbResult,
      fileStorage: fileStorageResult,
      plugins: pluginsResult,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Service initialization failed', { error: errorMessage });
    throw error;
  }
}
