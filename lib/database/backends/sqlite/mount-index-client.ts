/**
 * Mount Index SQLite Client Module
 *
 * Provides a dedicated singleton better-sqlite3 database connection for
 * the mount index database. This isolates mount tracking data from the
 * main database so corruption in the mount index DB can never threaten
 * characters, chats, messages, or memories.
 *
 * Features:
 * - Separate WAL + busy_timeout + cache + mmap configuration
 * - Foreign keys ENABLED (mount index has inter-table relationships)
 * - Graceful degradation: if the DB fails to open, the app continues
 *   with mount indexing silently disabled (all safeQuery fallbacks handle this)
 * - globalThis persistence to survive Next.js HMR
 *
 * @module lib/database/backends/sqlite/mount-index-client
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { stopMountIndexPeriodicCheckpoints, runMountIndexShutdownCheckpoint } from './mount-index-protection';

const moduleLogger = logger.child({ module: 'database:mount-index-client' });

// ============================================================================
// HMR-Safe Global State
// ============================================================================

declare global {
  var __quilltapMountIndexDatabase: DatabaseType | undefined;
  var __quilltapMountIndexDegraded: boolean | undefined;
}

// ============================================================================
// Client Management
// ============================================================================

/**
 * Initialize and return the mount index database connection.
 *
 * Uses the same pragma set as the main DB. Foreign keys are enabled
 * because the mount index has inter-table relationships.
 *
 * @param config - SQLite config (path should point to the mount index DB)
 * @returns The database instance, or null if opening failed (degraded mode)
 */
export function getMountIndexSQLiteClient(config: SQLiteConfig): DatabaseType | null {
  if (globalThis.__quilltapMountIndexDatabase) {
    return globalThis.__quilltapMountIndexDatabase;
  }

  moduleLogger.info('Initializing mount index database connection', {
    path: config.path,
    walMode: config.walMode,
  });

  try {
    const db = new Database(config.path);

    // SQLCipher key MUST be the first pragma before any other operations.
    const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
    if (sqlcipherKey) {
      const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
      moduleLogger.debug('SQLCipher key set on mount index database');
    }

    // Configure pragmas
    if (config.walMode) {
      db.pragma('journal_mode = WAL');
    }
    db.pragma(`synchronous = ${config.synchronous}`);
    db.pragma(`busy_timeout = ${config.busyTimeout}`);
    db.pragma(`cache_size = ${config.cacheSize}`);
    db.pragma('mmap_size = 268435456'); // 256MB
    db.pragma('temp_store = MEMORY');

    // Enable foreign keys — mount index has inter-table relationships
    db.pragma('foreign_keys = ON');

    globalThis.__quilltapMountIndexDatabase = db;
    globalThis.__quilltapMountIndexDegraded = false;

    moduleLogger.info('Mount index database connection established', {
      path: config.path,
    });

    return db;
  } catch (error) {
    moduleLogger.error('Failed to initialize mount index database — entering degraded mode', {
      path: config.path,
      error: error instanceof Error ? error.message : String(error),
    });
    globalThis.__quilltapMountIndexDegraded = true;
    return null;
  }
}

/**
 * Close the mount index database connection.
 *
 * Stops periodic checkpoints, runs a TRUNCATE checkpoint, optimizes, and
 * closes the connection. Never throws.
 */
export function closeMountIndexSQLiteClient(): void {
  const db = globalThis.__quilltapMountIndexDatabase;
  if (!db) {
    return;
  }

  try {
    moduleLogger.info('Closing mount index database connection');

    stopMountIndexPeriodicCheckpoints();
    runMountIndexShutdownCheckpoint(db);

    try {
      db.pragma('optimize');
    } catch {
      // Best-effort
    }

    db.close();
    moduleLogger.info('Mount index database connection closed');
  } catch (error) {
    moduleLogger.error('Error closing mount index database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — shutdown must proceed
  } finally {
    globalThis.__quilltapMountIndexDatabase = undefined;
  }
}

/**
 * Get the raw mount index database instance for backup / protection access.
 *
 * @returns The database handle, or null if not initialized or degraded
 */
export function getRawMountIndexDatabase(): DatabaseType | null {
  return globalThis.__quilltapMountIndexDatabase ?? null;
}

/**
 * Check whether the mount index database is in degraded mode.
 *
 * When degraded, the repository will throw on getCollection() and all
 * safeQuery fallbacks will kick in (returning empty arrays, 0 counts, etc.).
 */
export function isMountIndexDegraded(): boolean {
  return globalThis.__quilltapMountIndexDegraded ?? false;
}
