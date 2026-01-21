/**
 * Migration Runner
 *
 * Handles running data migrations at server startup.
 * Migrations MUST complete successfully before Next.js accepts any requests.
 * If migrations fail, the process exits with code 1.
 *
 * This ensures data compatibility before any API requests can access the database.
 */

import { logger } from './lib/logger';
import { getMongoDatabase, isMongoDBBackend, closeMongoDB } from './lib/mongodb-utils';
import { loadMigrationState, isMigrationCompleted, recordCompletedMigration } from './state';
import type { Migration, MigrationResult, MigrationState, MigrationRunResult } from './types';

// Import all migrations
import { migrations } from './scripts';

// Re-export types for external use
export type { Migration, MigrationResult, MigrationState, MigrationRunResult };

/**
 * Sort migrations by dependencies using topological sort
 */
function sortMigrationsByDependency(migrations: Migration[]): Migration[] {
  const sorted: Migration[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(migration: Migration): void {
    if (visited.has(migration.id)) return;
    if (visiting.has(migration.id)) {
      throw new Error(`Circular dependency detected in migrations: ${migration.id}`);
    }

    visiting.add(migration.id);

    // Visit dependencies first
    if (migration.dependsOn) {
      for (const depId of migration.dependsOn) {
        const dep = migrations.find(m => m.id === depId);
        if (dep) {
          visit(dep);
        }
      }
    }

    visiting.delete(migration.id);
    visited.add(migration.id);
    sorted.push(migration);
  }

  for (const migration of migrations) {
    visit(migration);
  }

  return sorted;
}

/**
 * Wait for MongoDB to be accessible with retries
 */
async function waitForMongoDBReady(maxRetries: number = 10, retryDelayMs: number = 1000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const db = await getMongoDatabase();
      await db.command({ ping: 1 });

      logger.debug('MongoDB is ready for migrations', {
        context: 'migrations.waitForMongoDBReady',
        attempt,
      });
      return true;
    } catch (error) {
      logger.debug('MongoDB not ready yet, retrying', {
        context: 'migrations.waitForMongoDBReady',
        attempt,
        maxRetries,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.error('MongoDB not accessible after retries', {
    context: 'migrations.waitForMongoDBReady',
    maxRetries,
  });
  return false;
}

/**
 * MigrationRunner class
 *
 * Orchestrates the execution of all migrations at server startup.
 * Ensures migrations run in dependency order and tracks completion state.
 */
export class MigrationRunner {
  private migrations: Migration[];

  constructor() {
    this.migrations = migrations;
  }

  /**
   * Run all pending migrations
   *
   * @returns MigrationRunResult with success status and details
   */
  async runMigrations(): Promise<MigrationRunResult> {
    const startTime = Date.now();
    const results: MigrationResult[] = [];
    let migrationsRun = 0;
    let migrationsSkipped = 0;
    const failed: string[] = [];

    logger.info('Starting migration runner', {
      context: 'migrations.runMigrations',
      totalMigrations: this.migrations.length,
    });

    // Check if MongoDB is configured and wait for it to be ready
    if (isMongoDBBackend()) {
      logger.info('Waiting for MongoDB to be ready', {
        context: 'migrations.runMigrations',
      });

      const mongoReady = await waitForMongoDBReady();
      if (!mongoReady) {
        const error = 'MongoDB not accessible - cannot run migrations';
        logger.error(error, {
          context: 'migrations.runMigrations',
        });
        return {
          success: false,
          migrationsRun: 0,
          migrationsSkipped: 0,
          results: [],
          totalDurationMs: Date.now() - startTime,
          failed: [],
          error,
        };
      }
    }

    // Load current state
    let state = await loadMigrationState();

    // Sort migrations by dependency
    const sortedMigrations = sortMigrationsByDependency(this.migrations);

    logger.debug('Migrations sorted by dependency', {
      context: 'migrations.runMigrations',
      order: sortedMigrations.map(m => m.id),
    });

    for (const migration of sortedMigrations) {
      // Check if already completed
      if (isMigrationCompleted(state, migration.id)) {
        logger.debug('Migration already completed, skipping', {
          context: 'migrations.runMigrations',
          migrationId: migration.id,
        });
        migrationsSkipped++;
        continue;
      }

      // Check if migration should run
      try {
        const shouldRun = await migration.shouldRun();
        if (!shouldRun) {
          logger.debug('Migration conditions not met, skipping', {
            context: 'migrations.runMigrations',
            migrationId: migration.id,
          });
          migrationsSkipped++;
          continue;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Error checking if migration should run', {
          context: 'migrations.runMigrations',
          migrationId: migration.id,
          error: errorMessage,
        });
        // Skip this migration if we can't determine if it should run
        migrationsSkipped++;
        continue;
      }

      // Run the migration
      logger.info('Running migration', {
        context: 'migrations.runMigrations',
        migrationId: migration.id,
        description: migration.description,
      });

      try {
        const result = await migration.run();
        results.push(result);

        if (result.success) {
          state = await recordCompletedMigration(state, result);
          migrationsRun++;
          logger.info('Migration completed successfully', {
            context: 'migrations.runMigrations',
            migrationId: migration.id,
            itemsAffected: result.itemsAffected,
            durationMs: result.durationMs,
          });
        } else {
          failed.push(migration.id);
          logger.error('Migration failed', {
            context: 'migrations.runMigrations',
            migrationId: migration.id,
            error: result.error,
            message: result.message,
          });
          // Stop on first failure - critical migrations must succeed
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Migration threw an exception', {
          context: 'migrations.runMigrations',
          migrationId: migration.id,
          error: errorMessage,
        });

        results.push({
          id: migration.id,
          success: false,
          itemsAffected: 0,
          message: 'Migration failed with exception',
          error: errorMessage,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        failed.push(migration.id);
        // Stop on exception
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const allSucceeded = failed.length === 0;

    logger.info('Migration runner completed', {
      context: 'migrations.runMigrations',
      success: allSucceeded,
      migrationsRun,
      migrationsSkipped,
      failed: failed.length > 0 ? failed : undefined,
      totalDurationMs,
    });

    return {
      success: allSucceeded,
      migrationsRun,
      migrationsSkipped,
      results,
      totalDurationMs,
      failed: failed.length > 0 ? failed : undefined,
    };
  }

  /**
   * Get list of all available migrations
   */
  getAllMigrations(): Migration[] {
    return this.migrations;
  }

  /**
   * Get list of pending migration IDs
   */
  async getPendingMigrations(): Promise<string[]> {
    const state = await loadMigrationState();
    const pending: string[] = [];

    for (const migration of this.migrations) {
      if (!isMigrationCompleted(state, migration.id)) {
        try {
          const shouldRun = await migration.shouldRun();
          if (shouldRun) {
            pending.push(migration.id);
          }
        } catch {
          // If we can't check, assume it needs to run
          pending.push(migration.id);
        }
      }
    }

    return pending;
  }

  /**
   * Get current migration state
   */
  async getMigrationState(): Promise<MigrationState> {
    return loadMigrationState();
  }

  /**
   * Close any open database connections
   */
  async cleanup(): Promise<void> {
    await closeMongoDB();
  }
}

// Export singleton instance for convenience
export const migrationRunner = new MigrationRunner();
