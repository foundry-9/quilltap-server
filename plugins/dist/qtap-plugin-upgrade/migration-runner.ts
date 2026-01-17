/**
 * Migration Runner
 *
 * Handles running migrations in the correct order and tracking completed migrations.
 * Supports both file-based (JSON) and MongoDB backends for migration state storage.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createPluginLogger } from '@quilltap/plugin-utils';
import { getMongoDatabase, isMongoDBBackend } from './lib/mongodb-utils';
import type {
  Migration,
  MigrationResult,
  MigrationState,
  MigrationRecord,
  UpgradeResult,
} from './migration-types';

const logger = createPluginLogger('qtap-plugin-upgrade');

// Path to store migration state (file-based)
const MIGRATIONS_STATE_FILE = path.join(process.cwd(), 'data', 'settings', 'migrations.json');

// MongoDB collection and document constants
const MIGRATIONS_COLLECTION = 'migrations_state';
const MIGRATIONS_DOCUMENT_ID = 'migration_state';

/**
 * Get the Quilltap version at runtime from package.json
 * This reads the file dynamically to avoid bundling the version at build time,
 * which would cause the plugin bundle to change on every version bump.
 */
function getQuilltapVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fsSync.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Load migration state from MongoDB directly
 */
async function loadMigrationStateFromMongo(): Promise<MigrationState | null> {
  try {
    const db = await getMongoDatabase();
    const collection = db.collection(MIGRATIONS_COLLECTION);
    // Use `as any` to bypass TypeScript's strict ObjectId typing for _id
    // MongoDB accepts string IDs and they work fine for our use case
    const doc = await collection.findOne({ _id: MIGRATIONS_DOCUMENT_ID as any });

    if (!doc) {
      logger.debug('No migration state found in MongoDB', {
        context: 'migration-runner.loadMigrationStateFromMongo',
      });
      return null;
    }

    logger.debug('Migration state loaded from MongoDB', {
      context: 'migration-runner.loadMigrationStateFromMongo',
      completedCount: doc.completedMigrations?.length || 0,
    });

    return {
      completedMigrations: doc.completedMigrations || [],
      lastChecked: doc.lastChecked || new Date().toISOString(),
      quilltapVersion: doc.quilltapVersion || getQuilltapVersion(),
    };
  } catch (error) {
    logger.error('Error loading migration state from MongoDB', {
      context: 'migration-runner.loadMigrationStateFromMongo',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Save migration state to MongoDB directly
 */
async function saveMigrationStateToMongo(state: MigrationState): Promise<void> {
  try {
    const db = await getMongoDatabase();
    const collection = db.collection(MIGRATIONS_COLLECTION);

    await collection.updateOne(
      { _id: MIGRATIONS_DOCUMENT_ID as any },
      {
        $set: {
          completedMigrations: state.completedMigrations,
          lastChecked: state.lastChecked,
          quilltapVersion: state.quilltapVersion,
        },
      },
      { upsert: true }
    );

    logger.debug('Migration state saved to MongoDB', {
      context: 'migration-runner.saveMigrationStateToMongo',
      completedCount: state.completedMigrations.length,
    });
  } catch (error) {
    logger.error('Error saving migration state to MongoDB', {
      context: 'migration-runner.saveMigrationStateToMongo',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load the current migration state from storage (MongoDB or file)
 */
export async function loadMigrationState(): Promise<MigrationState> {
  // Use MongoDB if configured
  if (isMongoDBBackend()) {
    try {
      const state = await loadMigrationStateFromMongo();
      if (state) {
        return state;
      }
      // No state found, return empty state
      return {
        completedMigrations: [],
        lastChecked: new Date().toISOString(),
        quilltapVersion: getQuilltapVersion(),
      };
    } catch (error) {
      logger.warn('Failed to load migration state from MongoDB, falling back to file', {
        context: 'migration-runner.loadMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based loading
    }
  }

  // File-based loading
  try {
    const content = await fs.readFile(MIGRATIONS_STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid - return empty state
    return {
      completedMigrations: [],
      lastChecked: new Date().toISOString(),
      quilltapVersion: getQuilltapVersion(),
    };
  }
}

/**
 * Save migration state to storage (MongoDB or file)
 */
export async function saveMigrationState(state: MigrationState): Promise<void> {
  // Save to MongoDB if configured
  if (isMongoDBBackend()) {
    try {
      await saveMigrationStateToMongo(state);
      return;
    } catch (error) {
      logger.warn('Failed to save migration state to MongoDB, falling back to file', {
        context: 'migration-runner.saveMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based saving
    }
  }

  // File-based saving
  const dir = path.dirname(MIGRATIONS_STATE_FILE);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    MIGRATIONS_STATE_FILE,
    JSON.stringify(state, null, 2),
    'utf-8'
  );
}

/**
 * Check if a migration has already been completed
 */
export function isMigrationCompleted(state: MigrationState, migrationId: string): boolean {
  return state.completedMigrations.some(m => m.id === migrationId);
}

/**
 * Record a completed migration
 */
export async function recordCompletedMigration(
  state: MigrationState,
  result: MigrationResult
): Promise<MigrationState> {
  const record: MigrationRecord = {
    id: result.id,
    completedAt: result.timestamp,
    quilltapVersion: getQuilltapVersion(),
    itemsAffected: result.itemsAffected,
    message: result.message,
  };

  const updatedState: MigrationState = {
    ...state,
    completedMigrations: [...state.completedMigrations, record],
    lastChecked: new Date().toISOString(),
    quilltapVersion: getQuilltapVersion(),
  };

  await saveMigrationState(updatedState);
  return updatedState;
}

/**
 * Sort migrations by dependencies
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
 * Run all pending migrations
 */
export async function runMigrations(migrations: Migration[]): Promise<UpgradeResult> {
  const startTime = Date.now();
  const results: MigrationResult[] = [];
  let migrationsRun = 0;
  let migrationsSkipped = 0;

  logger.info('Starting migration runner', {
    context: 'upgrade-plugin.runMigrations',
    totalMigrations: migrations.length,
  });

  // Load current state
  let state = await loadMigrationState();

  // Sort migrations by dependency
  const sortedMigrations = sortMigrationsByDependency(migrations);

  for (const migration of sortedMigrations) {
    // Check if already completed
    if (isMigrationCompleted(state, migration.id)) {
      logger.debug('Migration already completed, skipping', {
        context: 'upgrade-plugin.runMigrations',
        migrationId: migration.id,
      });
      migrationsSkipped++;
      continue;
    }

    // Check if migration should run
    const shouldRun = await migration.shouldRun();
    if (!shouldRun) {
      logger.debug('Migration conditions not met, skipping', {
        context: 'upgrade-plugin.runMigrations',
        migrationId: migration.id,
      });
      migrationsSkipped++;
      continue;
    }

    // Run the migration
    logger.info('Running migration', {
      context: 'upgrade-plugin.runMigrations',
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
          context: 'upgrade-plugin.runMigrations',
          migrationId: migration.id,
          itemsAffected: result.itemsAffected,
          durationMs: result.durationMs,
        });
      } else {
        logger.error('Migration failed', {
          context: 'upgrade-plugin.runMigrations',
          migrationId: migration.id,
          error: result.error,
        });
        // Stop on first failure
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration threw an exception', {
        context: 'upgrade-plugin.runMigrations',
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
      break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const allSucceeded = results.every(r => r.success);

  logger.info('Migration runner completed', {
    context: 'upgrade-plugin.runMigrations',
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    totalDurationMs,
  });

  return {
    success: allSucceeded,
    migrationsRun,
    migrationsSkipped,
    results,
    totalDurationMs,
  };
}

/**
 * Get list of pending migration IDs
 */
export async function getPendingMigrations(migrations: Migration[]): Promise<string[]> {
  const state = await loadMigrationState();
  const pending: string[] = [];

  for (const migration of migrations) {
    if (!isMigrationCompleted(state, migration.id)) {
      const shouldRun = await migration.shouldRun();
      if (shouldRun) {
        pending.push(migration.id);
      }
    }
  }

  return pending;
}
