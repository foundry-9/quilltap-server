/**
 * SQLite Client Module
 *
 * Provides a singleton better-sqlite3 database connection with
 * proper configuration for WAL mode, foreign keys, and other pragmas.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { SQLiteConfig } from '../../config';
import { logger } from '@/lib/logger';
import { stopPeriodicCheckpoints, runShutdownCheckpoint } from './protection';
import { closeLLMLogsSQLiteClient } from './llm-logs-client';

// ============================================================================
// Singleton State
// ============================================================================

let sqliteDatabase: DatabaseType | null = null;
let isInitialized = false;
let shutdownHandlersRegistered = false;

// ============================================================================
// Client Management
// ============================================================================

/**
 * Initialize and return the SQLite database connection
 */
export function getSQLiteClient(config: SQLiteConfig): DatabaseType {
  if (sqliteDatabase && isInitialized) {
    return sqliteDatabase;
  }

  logger.info('Initializing SQLite database connection', {
    path: config.path,
    walMode: config.walMode,
  });

  try {
    // Create or open the database
    sqliteDatabase = new Database(config.path, {
      // verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
    });

    // Configure pragmas
    configurePragmas(sqliteDatabase, config);

    isInitialized = true;

    logger.info('SQLite database connection established', {
      path: config.path,
    });

    return sqliteDatabase;
  } catch (error) {
    logger.error('Failed to initialize SQLite database', {
      path: config.path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Configure SQLite pragmas for optimal performance
 */
function configurePragmas(db: DatabaseType, config: SQLiteConfig): void {
  // Enable foreign key constraints
  if (config.foreignKeys) {
    db.pragma('foreign_keys = ON');
  }

  // Set journal mode (WAL for better concurrency)
  if (config.walMode) {
    db.pragma('journal_mode = WAL');
  } else {
    db.pragma(`journal_mode = ${config.journalMode}`);
  }

  // Set synchronous mode
  db.pragma(`synchronous = ${config.synchronous}`);

  // Set busy timeout
  db.pragma(`busy_timeout = ${config.busyTimeout}`);

  // Set cache size
  db.pragma(`cache_size = ${config.cacheSize}`);

  // Enable memory-mapped I/O for better performance (256MB)
  db.pragma('mmap_size = 268435456');

  // Optimize temp store
  db.pragma('temp_store = MEMORY');
}

/**
 * Close the SQLite database connection
 *
 * Stops periodic checkpoints, runs a TRUNCATE checkpoint to fully merge
 * the WAL into the main database file, then optimizes and closes.
 */
export function closeSQLiteClient(): void {
  if (sqliteDatabase) {
    try {
      logger.info('Closing SQLite database connection');

      // Stop periodic checkpoints first
      stopPeriodicCheckpoints();

      // Run a TRUNCATE checkpoint to merge WAL into main DB
      runShutdownCheckpoint(sqliteDatabase);

      // Optimize before closing
      sqliteDatabase.pragma('optimize');

      sqliteDatabase.close();
      sqliteDatabase = null;
      isInitialized = false;

      logger.info('SQLite database connection closed');
    } catch (error) {
      logger.error('Error closing SQLite connection', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Check if the database is connected and healthy
 */
export function isSQLiteConnected(): boolean {
  if (!sqliteDatabase || !isInitialized) {
    return false;
  }

  try {
    // Simple query to verify connection
    sqliteDatabase.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a checkpoint on the WAL file
 */
export function runCheckpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): void {
  if (!sqliteDatabase || !isInitialized) {
    return;
  }

  try {
    sqliteDatabase.pragma(`wal_checkpoint(${mode})`);
  } catch (error) {
    logger.error('Error running WAL checkpoint', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): { pageCount: number; pageSize: number; freelist: number } | null {
  if (!sqliteDatabase || !isInitialized) {
    return null;
  }

  try {
    const pageCount = sqliteDatabase.pragma('page_count', { simple: true }) as number;
    const pageSize = sqliteDatabase.pragma('page_size', { simple: true }) as number;
    const freelist = sqliteDatabase.pragma('freelist_count', { simple: true }) as number;

    return { pageCount, pageSize, freelist };
  } catch {
    return null;
  }
}

/**
 * Vacuum the database to reclaim space
 */
export function vacuumDatabase(): void {
  if (!sqliteDatabase || !isInitialized) {
    return;
  }

  try {
    logger.info('Running VACUUM on SQLite database');
    sqliteDatabase.exec('VACUUM');
    logger.info('VACUUM completed');
  } catch (error) {
    logger.error('Error running VACUUM', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Setup shutdown handlers for graceful cleanup
 */
export function setupSQLiteShutdownHandlers(): void {
  // Prevent adding listeners multiple times (important for hot reloading)
  if (shutdownHandlersRegistered) {
    return;
  }
  shutdownHandlersRegistered = true;

  const handleShutdown = () => {
    closeLLMLogsSQLiteClient();
    closeSQLiteClient();
  };

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception, closing SQLite connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    closeSQLiteClient();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection, closing SQLite connection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    closeSQLiteClient();
    process.exit(1);
  });
}

// ============================================================================
// Raw Database Access
// ============================================================================

/**
 * Get the raw better-sqlite3 database instance.
 *
 * Returns the singleton database handle, or null if not initialized.
 * Intended for use by protection and backup modules that need direct
 * database access (e.g., for PRAGMA calls or .backup()).
 */
export function getRawDatabase(): DatabaseType | null {
  return sqliteDatabase && isInitialized ? sqliteDatabase : null;
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Execute a function within a transaction
 */
export function withTransaction<T>(fn: () => T): T {
  if (!sqliteDatabase || !isInitialized) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = sqliteDatabase.transaction(fn);
  return transaction();
}

/**
 * Execute a function within an immediate transaction (write lock)
 */
export function withImmediateTransaction<T>(fn: () => T): T {
  if (!sqliteDatabase || !isInitialized) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = sqliteDatabase.transaction(fn);
  return transaction.immediate();
}

/**
 * Execute a function within an exclusive transaction (full lock)
 */
export function withExclusiveTransaction<T>(fn: () => T): T {
  if (!sqliteDatabase || !isInitialized) {
    throw new Error('SQLite database not initialized');
  }

  const transaction = sqliteDatabase.transaction(fn);
  return transaction.exclusive();
}
