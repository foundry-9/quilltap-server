/**
 * Startup Module Exports
 *
 * Centralized exports for all startup/initialization functionality.
 */

import { fileStorageManager } from '@/lib/file-storage/manager';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';

// Plugin initialization
export {
  initializePlugins,
  isPluginSystemInitialized,
  resetPluginSystem,
  getPluginSystemState,
  type PluginInitializationResult,
} from './plugin-initialization';

// Startup state tracking
export { startupState, type StartupPhase } from './startup-state';

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
 * Initialize file storage if enabled
 *
 * Initializes the file storage manager which handles all storage operations
 * across configured mount points and backends.
 */
export async function initializeFileStorageIfNeeded(): Promise<ServiceInitializationResult> {
  const startTime = Date.now();
  try {
    logger.info('Initializing file storage manager');

    // Initialize the file storage manager
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
 * Coordinates initialization of file storage and the plugin system.
 * Services are initialized in parallel to minimize startup time.
 */
export async function initializeAllServices(): Promise<{
  fileStorage: ServiceInitializationResult;
  plugins: any; // Using any to avoid circular dependency with PluginInitializationResult
}> {
  logger.info('Starting service initialization');

  try {
    // Initialize file storage
    const fileStorageResult = await initializeFileStorageIfNeeded();

    // Import plugins initialization dynamically to avoid circular deps
    const { initializePlugins } = await import('./plugin-initialization');

    // Initialize plugins
    const pluginsResult = await initializePlugins();

    logger.info('All services initialized', {
      fileStorage: { initialized: fileStorageResult.initialized, service: fileStorageResult.service },
      plugins: { success: pluginsResult.success },
    });

    return {
      fileStorage: fileStorageResult,
      plugins: pluginsResult,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Service initialization failed', { error: errorMessage });
    throw error;
  }
}
