/**
 * Repository Factory
 *
 * Provides access to backend-agnostic data repositories.
 * Automatically selects the appropriate backend (MongoDB or SQLite)
 * based on the DATABASE_BACKEND configuration.
 *
 * With the new migration system, migrations run in instrumentation.ts BEFORE
 * the server starts accepting requests, so data is always guaranteed to be
 * in the correct format.
 */

import { logger } from '@/lib/logger';
import {
  getRepositories as getDatabaseRepos,
  RepositoryContainer as DatabaseRepositoryContainer,
} from '@/lib/database/repositories';
import {
  getUserRepositories,
  clearUserRepositoryCache,
  type UserScopedRepositoryContainer,
} from './user-scoped';
import { startupState } from '@/lib/startup/startup-state';

/**
 * Type alias for repository container
 * Uses the database abstraction container as the canonical interface
 */
export type RepositoryContainer = DatabaseRepositoryContainer;

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
 * @returns The configured backend type ('mongodb' or 'sqlite')
 */
export function getDataBackend(): 'mongodb' | 'sqlite' {
  // Import here to avoid circular dependencies
  const { getDatabaseConfig } = require('@/lib/database/config');
  const config = getDatabaseConfig();
  logger.debug('Retrieved data backend configuration', { backend: config.backend });
  return config.backend;
}

/**
 * Check if MongoDB is the active backend
 * @returns True if using MongoDB backend
 */
export function isMongoDBEnabled(): boolean {
  const backend = getDataBackend();
  logger.debug('Checked MongoDB enabled status', { enabled: backend === 'mongodb', backend });
  return backend === 'mongodb';
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
 * Get the repository container
 *
 * Uses the database abstraction layer which automatically selects
 * the appropriate backend based on configuration.
 *
 * @returns RepositoryContainer for the configured backend
 */
export function getRepositories(): RepositoryContainer {
  // Return cached repositories if already initialized
  if (cachedRepositories) {
    return cachedRepositories;
  }

  const backend = getDataBackend();
  logger.info('Initializing backend repositories', { backend });
  cachedRepositories = getDatabaseRepos();
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
