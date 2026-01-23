/**
 * Repository Factory
 *
 * Provides access to MongoDB data repositories.
 *
 * Note: JSON file storage has been deprecated. For migration from JSON to MongoDB,
 * the migrations module (migrations/) has its own copy of the JSON-store code
 * for reading legacy data.
 *
 * With the new migration system, migrations run in instrumentation.ts BEFORE
 * the server starts accepting requests, so data is always guaranteed to be
 * in the correct format.
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
 * Track if we've already waited for migrations (safety check only)
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
 *
 * With the new migration system, migrations run in instrumentation.ts
 * BEFORE the server starts accepting any requests. If migrations fail,
 * the process exits immediately.
 *
 * This function checks the MongoDB migration state directly because the
 * in-memory startupState isn't shared across worker processes.
 */
async function ensureMigrationsComplete(): Promise<void> {
  // Only check once per process
  if (migrationWaitComplete) {
    return;
  }

  // Check in-memory state first (fastest check)
  if (startupState.areMigrationsComplete()) {
    migrationWaitComplete = true;
    return;
  }

  // In multi-worker setups, the instrumentation.ts runs in a different process
  // than the request handlers. Check MongoDB migration state directly.
  try {
    const { loadMigrationState } = await import('../../migrations/state');
    const mongoState = await loadMigrationState();

    // If we have completed migrations recorded in MongoDB, we're good
    if (mongoState.completedMigrations && mongoState.completedMigrations.length > 0) {
      logger.debug('Migrations verified complete via MongoDB state', {
        context: 'repository-factory.ensureMigrationsComplete',
        completedCount: mongoState.completedMigrations.length,
        lastMigration: mongoState.completedMigrations[mongoState.completedMigrations.length - 1]?.id,
      });
      migrationWaitComplete = true;
      return;
    }
  } catch (error) {
    // If we can't check MongoDB state, fall back to in-memory check
    logger.debug('Could not check MongoDB migration state, using in-memory state', {
      context: 'repository-factory.ensureMigrationsComplete',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Fall back to the in-memory wait for edge cases
  const phase = startupState.getPhase();
  if (phase === 'pending' || phase === 'migrations' || phase === 'mongodb' || phase === 'plugins') {
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
      // Final fallback - proceed anyway since migrations likely completed in another process
      logger.warn('In-memory migration wait timed out, proceeding (migrations likely completed in instrumentation)', {
        context: 'repository-factory.ensureMigrationsComplete',
        currentPhase: startupState.getPhase(),
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
 *
 * With the new migration system, migrations run before the server accepts
 * any requests, so this is now just a safety check. The await call is kept
 * for backwards compatibility with existing code patterns.
 *
 * Use this for API routes and other request handlers.
 *
 * @returns Promise<RepositoryContainer> for MongoDB backend
 */
export async function getRepositoriesSafe(): Promise<RepositoryContainer> {
  // Safety check - migrations should already be complete
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
