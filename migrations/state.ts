/**
 * Migration State Management
 *
 * Handles persistence of migration state to SQLite with file fallback.
 * Tracks which migrations have been completed to prevent re-running.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { logger } from './lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  executeSQLite,
  querySQLite,
} from './lib/database-utils';
import type { MigrationState, MigrationRecord, MigrationResult } from './types';

// Path to store migration state (file-based fallback)
const MIGRATIONS_STATE_FILE = path.join(process.cwd(), 'data', 'settings', 'migrations.json');

/**
 * Get the Quilltap version at runtime from package.json
 * This reads the file dynamically to avoid bundling the version at build time.
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

// SQLite table name for migration state
const SQLITE_MIGRATIONS_TABLE = 'migrations_state';

/**
 * Ensure SQLite migrations table exists
 */
function ensureSQLiteMigrationsTable(): void {
  if (!sqliteTableExists(SQLITE_MIGRATIONS_TABLE)) {
    executeSQLite(`
      CREATE TABLE IF NOT EXISTS "${SQLITE_MIGRATIONS_TABLE}" (
        "id" TEXT PRIMARY KEY,
        "completedAt" TEXT NOT NULL,
        "quilltapVersion" TEXT NOT NULL,
        "itemsAffected" INTEGER NOT NULL DEFAULT 0,
        "message" TEXT
      )
    `);
    // Also create a metadata table for lastChecked
    executeSQLite(`
      CREATE TABLE IF NOT EXISTS "migrations_metadata" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL
      )
    `);
  }
}

/**
 * Load migration state from SQLite
 */
function loadMigrationStateFromSQLite(): MigrationState {
  ensureSQLiteMigrationsTable();

  try {
    // Load completed migrations
    const records = querySQLite<MigrationRecord>(`
      SELECT id, completedAt, quilltapVersion, itemsAffected, message
      FROM "${SQLITE_MIGRATIONS_TABLE}"
      ORDER BY completedAt ASC
    `);

    // Load metadata
    const metadataRows = querySQLite<{ key: string; value: string }>(`
      SELECT key, value FROM migrations_metadata
    `);
    const metadata = Object.fromEntries(metadataRows.map(r => [r.key, r.value]));
    return {
      completedMigrations: records,
      lastChecked: metadata.lastChecked || new Date().toISOString(),
      quilltapVersion: metadata.quilltapVersion || getQuilltapVersion(),
    };
  } catch (error) {
    logger.error('Error loading migration state from SQLite', {
      context: 'migrations.state.loadMigrationStateFromSQLite',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Save migration state to SQLite
 */
function saveMigrationStateToSQLite(state: MigrationState): void {
  ensureSQLiteMigrationsTable();

  try {
    const db = getSQLiteDatabase();

    // Use a transaction to ensure atomicity
    const saveState = db.transaction(() => {
      // Clear existing records
      db.prepare(`DELETE FROM "${SQLITE_MIGRATIONS_TABLE}"`).run();

      // Insert all migration records
      const insertStmt = db.prepare(`
        INSERT INTO "${SQLITE_MIGRATIONS_TABLE}" (id, completedAt, quilltapVersion, itemsAffected, message)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const record of state.completedMigrations) {
        insertStmt.run(
          record.id,
          record.completedAt,
          record.quilltapVersion,
          record.itemsAffected,
          record.message || null
        );
      }

      // Update metadata
      const upsertMeta = db.prepare(`
        INSERT INTO migrations_metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      upsertMeta.run('lastChecked', state.lastChecked);
      upsertMeta.run('quilltapVersion', state.quilltapVersion);
    });

    saveState();
  } catch (error) {
    logger.error('Error saving migration state to SQLite', {
      context: 'migrations.state.saveMigrationStateToSQLite',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load the current migration state from storage (SQLite or file fallback)
 */
export async function loadMigrationState(): Promise<MigrationState> {
  // Use SQLite if configured
  if (isSQLiteBackend()) {
    try {
      return loadMigrationStateFromSQLite();
    } catch (error) {
      logger.warn('Failed to load migration state from SQLite, falling back to file', {
        context: 'migrations.state.loadMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based loading
    }
  }

  // File-based loading (fallback)
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
 * Save migration state to storage (SQLite or file fallback)
 */
export async function saveMigrationState(state: MigrationState): Promise<void> {
  // Save to SQLite if configured
  if (isSQLiteBackend()) {
    try {
      saveMigrationStateToSQLite(state);
      return;
    } catch (error) {
      logger.warn('Failed to save migration state to SQLite, falling back to file', {
        context: 'migrations.state.saveMigrationState',
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to file-based saving
    }
  }

  // File-based saving (fallback)
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
 * Get the current Quilltap version
 */
export { getQuilltapVersion };
