/**
 * Repository Factory
 *
 * Provides access to MongoDB data repositories.
 *
 * Note: JSON file storage has been deprecated. For migration from JSON to MongoDB,
 * use the qtap-plugin-upgrade migration plugin which has its own copy of the
 * JSON-store code for reading legacy data.
 */

import { logger } from '@/lib/logger';
import {
  getRepositories as getMongoRepos,
  RepositoryContainer as MongoRepositoryContainer,
} from '@/lib/mongodb/repositories';
import {
  getUserRepositories,
  clearUserRepositoryCache,
  type UserScopedRepositoryContainer,
} from './user-scoped';
import { startupState } from '@/lib/startup/startup-state';

/**
 * Type alias for repository container
 * Uses the MongoDB container as the canonical interface
 */
export type RepositoryContainer = MongoRepositoryContainer;

/**
 * Lazy-loaded repository cache
 */
let cachedRepositories: RepositoryContainer | null = null;

/**
 * Track if we've already waited for migrations
 */
let migrationWaitComplete = false;

/**
 * Get the configured data backend
 * @returns Always returns 'mongodb' - JSON backend is deprecated
 * @deprecated This function always returns 'mongodb'. Use getRepositories() directly.
 */
export function getDataBackend(): 'mongodb' {
  logger.debug('Retrieved data backend configuration', { backend: 'mongodb' });
  return 'mongodb';
}

/**
 * Check if MongoDB is the active backend
 * @returns Always returns true - MongoDB is the only supported backend
 * @deprecated This function always returns true. MongoDB is now required.
 */
export function isMongoDBEnabled(): boolean {
  logger.debug('Checked MongoDB enabled status', { enabled: true, backend: 'mongodb' });
  return true;
}

/**
 * Ensure migrations have completed before serving data
 * This is a safety net in case instrumentation.ts timing is off
 */
async function ensureMigrationsComplete(): Promise<void> {
  // Only wait once
  if (migrationWaitComplete) {
    return;
  }

  // Check if migrations are already complete
  if (startupState.areMigrationsComplete()) {
    migrationWaitComplete = true;
    return;
  }

  // Check if startup is still in progress
  const phase = startupState.getPhase();
  if (phase === 'pending' || phase === 'mongodb' || phase === 'plugins') {
    logger.info('Waiting for migrations to complete before serving data', {
      context: 'repository-factory.ensureMigrationsComplete',
      currentPhase: phase,
    });

    // Wait for migrations (with 30 second timeout)
    const migrationsComplete = await startupState.waitForMigrations(30000);

    if (migrationsComplete) {
      logger.info('Migrations complete, proceeding with data access', {
        context: 'repository-factory.ensureMigrationsComplete',
      });
    } else {
      logger.warn('Migrations may not have completed, proceeding with data access anyway', {
        context: 'repository-factory.ensureMigrationsComplete',
        currentPhase: startupState.getPhase(),
        migrationsComplete: startupState.areMigrationsComplete(),
      });
    }
  }

  migrationWaitComplete = true;
}

/**
 * Get the repository container (MongoDB)
 *
 * @returns RepositoryContainer for MongoDB backend
 */
export function getRepositories(): RepositoryContainer {
  // Return cached repositories if already initialized
  if (cachedRepositories) {
    return cachedRepositories;
  }

  logger.info('Initializing MongoDB backend repositories');
  cachedRepositories = getMongoRepos();
  return cachedRepositories;
}

/**
 * Get the repository container with migration safety check
 * This ensures migrations have completed before serving data
 *
 * Use this for API routes and other request handlers that need
 * to ensure data integrity.
 *
 * @returns Promise<RepositoryContainer> for MongoDB backend
 */
export async function getRepositoriesSafe(): Promise<RepositoryContainer> {
  // Ensure migrations are complete before returning repositories
  await ensureMigrationsComplete();

  return getRepositories();
}

/**
 * Reset repository caches
 * Useful for testing or resetting state
 */
export function resetRepositories(): void {
  cachedRepositories = null;
  clearUserRepositoryCache();
  logger.info('Repository caches cleared');
}

// Re-export user-scoped repository functions
export { getUserRepositories, clearUserRepositoryCache };
export type { UserScopedRepositoryContainer };
