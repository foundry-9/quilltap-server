/**
 * SQLite Database Protection Module
 *
 * Provides database protection lifecycle functions:
 * - Integrity checking on startup
 * - Periodic WAL checkpoints to keep WAL file size manageable
 * - Shutdown checkpoint to fully merge WAL into main database
 * - Pre-backup checkpoint to ensure logical backups read consistent data
 *
 * All functions accept a Database instance as parameter to avoid circular
 * imports with client.ts.
 *
 * @module lib/database/backends/sqlite/protection
 */

import { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'database:protection' });

// ============================================================================
// HMR-Safe Global State
// ============================================================================

// Store interval on globalThis so it survives Next.js hot module replacement
declare global {
  var __quilltapCheckpointInterval: ReturnType<typeof setInterval> | undefined;
}

/** Periodic checkpoint interval: 5 minutes */
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// Integrity Check
// ============================================================================

/**
 * Run a quick integrity check on the database.
 *
 * Uses PRAGMA quick_check which is faster than full integrity_check but still
 * catches most corruption (B-tree structure, cell content, free-list
 * consistency). Returns true if the database is healthy, false otherwise.
 *
 * @param db - The better-sqlite3 database instance
 * @returns true if integrity check passes, false otherwise
 */
export function runIntegrityCheck(db: DatabaseType): boolean {
  try {
    const result = db.pragma('quick_check', { simple: true }) as string;
    const passed = result === 'ok';

    if (passed) {
      moduleLogger.info('Database integrity check passed');
    } else {
      moduleLogger.error('Database integrity check FAILED', {
        result,
      });
    }

    return passed;
  } catch (error) {
    moduleLogger.error('Database integrity check threw an error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ============================================================================
// Periodic WAL Checkpoints
// ============================================================================

/**
 * Start periodic PASSIVE WAL checkpoints.
 *
 * Runs PRAGMA wal_checkpoint(PASSIVE) every 5 minutes to keep the WAL file
 * from growing unboundedly. PASSIVE checkpoints transfer pages from the WAL
 * to the main database file without blocking readers or writers.
 *
 * Uses globalThis.__quilltapCheckpointInterval to survive Next.js HMR.
 * Calls .unref() on the interval so it doesn't prevent process exit.
 *
 * @param db - The better-sqlite3 database instance
 */
export function startPeriodicCheckpoints(db: DatabaseType): void {
  // Clear any existing interval (HMR safety)
  stopPeriodicCheckpoints();

  moduleLogger.info('Starting periodic WAL checkpoints', {
    intervalMs: CHECKPOINT_INTERVAL_MS,
  });

  const interval = setInterval(() => {
    try {
      moduleLogger.debug('Running periodic WAL checkpoint (PASSIVE)');
      const result = db.pragma('wal_checkpoint(PASSIVE)');
      moduleLogger.debug('Periodic WAL checkpoint completed', { result });
    } catch (error) {
      moduleLogger.error('Periodic WAL checkpoint failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, CHECKPOINT_INTERVAL_MS);

  // Don't let this interval prevent Node.js from exiting
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  globalThis.__quilltapCheckpointInterval = interval;
}

/**
 * Stop periodic WAL checkpoints.
 *
 * Clears the interval if one is running. Safe to call multiple times.
 */
export function stopPeriodicCheckpoints(): void {
  if (globalThis.__quilltapCheckpointInterval) {
    clearInterval(globalThis.__quilltapCheckpointInterval);
    globalThis.__quilltapCheckpointInterval = undefined;
    moduleLogger.debug('Stopped periodic WAL checkpoints');
  }
}

// ============================================================================
// Shutdown Checkpoint
// ============================================================================

/**
 * Run a TRUNCATE WAL checkpoint for clean shutdown.
 *
 * TRUNCATE mode writes all WAL pages back to the database file and then
 * truncates the WAL file to zero length. This ensures the database is fully
 * self-contained in the main .db file after shutdown.
 *
 * This function never throws — errors are logged and swallowed because we
 * don't want a checkpoint failure to prevent shutdown.
 *
 * @param db - The better-sqlite3 database instance
 */
export function runShutdownCheckpoint(db: DatabaseType): void {
  try {
    moduleLogger.info('Running shutdown WAL checkpoint (TRUNCATE)');
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    moduleLogger.info('Shutdown WAL checkpoint completed', { result });
  } catch (error) {
    moduleLogger.error('Shutdown WAL checkpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — shutdown must proceed
  }
}

// ============================================================================
// Backup Checkpoint
// ============================================================================

/**
 * Run a PASSIVE WAL checkpoint before logical backups.
 *
 * Flushes as much of the WAL as possible into the main database file so that
 * the logical backup (which reads through repositories) sees the most
 * up-to-date data. Uses PASSIVE mode to avoid blocking other operations.
 *
 * This function never throws — errors are logged and swallowed.
 *
 * @param db - The better-sqlite3 database instance
 */
export function runBackupCheckpoint(db: DatabaseType): void {
  try {
    moduleLogger.info('Running pre-backup WAL checkpoint (PASSIVE)');
    const result = db.pragma('wal_checkpoint(PASSIVE)');
    moduleLogger.info('Pre-backup WAL checkpoint completed', { result });
  } catch (error) {
    moduleLogger.error('Pre-backup WAL checkpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Never throw — backup should proceed regardless
  }
}
