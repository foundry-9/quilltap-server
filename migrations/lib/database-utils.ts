/**
 * Database Utilities for Migrations
 *
 * Backend-agnostic database utilities for running migrations.
 *
 * This module supports both MongoDB and SQLite. MongoDB is maintained for backward
 * compatibility with existing deployments using the standalone migration tool
 * (scripts/mongo-to-sqlite-cli.js), but new installations default to SQLite.
 *
 * MongoDB functionality is only loaded when explicitly enabled via DATABASE_BACKEND
 * environment variable or when the migration tool explicitly requires it.
 */

import { logger } from './logger';
import { getMongoDatabase as getMongoDatabaseDirect, isMongoDBBackend as isMongoDBBackendDirect, closeMongoDB } from './mongodb-utils';

// ============================================================================
// Backend Detection
// ============================================================================

/**
 * Detect the current database backend from environment
 */
export function detectDatabaseBackend(): 'mongodb' | 'sqlite' {
  const explicit = process.env.DATABASE_BACKEND?.toLowerCase();

  if (explicit === 'sqlite') {
    return 'sqlite';
  }

  if (explicit === 'mongodb') {
    return 'mongodb';
  }

  // Auto-detect based on environment variables
  // If MONGODB_URI is set, use MongoDB; otherwise SQLite
  if (process.env.MONGODB_URI) {
    return 'mongodb';
  }

  // Default to SQLite for simpler deployments
  return 'sqlite';
}

/**
 * Check if the current backend is MongoDB
 */
export function isMongoDBBackend(): boolean {
  return detectDatabaseBackend() === 'mongodb';
}

/**
 * Check if the current backend is SQLite
 */
export function isSQLiteBackend(): boolean {
  return detectDatabaseBackend() === 'sqlite';
}

// ============================================================================
// MongoDB Access (for existing migrations)
// ============================================================================

// Re-export MongoDB utilities for backwards compatibility
export { getMongoDatabase, closeMongoDB, testMongoDBConnection, validateMongoDBConfig } from './mongodb-utils';

// ============================================================================
// SQLite Access (for migrations)
// ============================================================================

import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getSQLiteDatabasePath, getDataDir, ensureDataDirectoriesExist } from '../../lib/paths';

let sqliteDb: DatabaseType | null = null;

/**
 * Get the SQLite database path
 *
 * Uses centralized path resolution from lib/paths.ts
 */
export function getSQLitePath(): string {
  if (process.env.SQLITE_PATH) {
    return process.env.SQLITE_PATH;
  }

  return getSQLiteDatabasePath();
}

/**
 * Ensure the SQLite data directory exists
 *
 * Uses centralized path resolution from lib/paths.ts
 */
export function ensureSQLiteDataDir(): void {
  const dataDir = getDataDir();

  if (!fs.existsSync(dataDir)) {
    logger.info('Creating SQLite data directory', { path: dataDir });
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Get SQLite database instance for migrations
 */
export function getSQLiteDatabase(): DatabaseType {
  if (sqliteDb) {
    return sqliteDb;
  }

  ensureSQLiteDataDir();
  const dbPath = getSQLitePath();
  sqliteDb = new Database(dbPath);

  // Configure pragmas
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('busy_timeout = 5000');

  return sqliteDb;
}

/**
 * Close the SQLite database connection
 */
export function closeSQLite(): void {
  if (sqliteDb) {
    try {
      sqliteDb.close();
    } catch (error) {
      logger.warn('Error closing SQLite connection', {
        context: 'migrations.database-utils',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      sqliteDb = null;
    }
  }
}

/**
 * Test SQLite connection
 */
export function testSQLiteConnection(): {
  success: boolean;
  message: string;
  latencyMs?: number;
} {
  const startTime = Date.now();

  try {
    const db = getSQLiteDatabase();
    db.prepare('SELECT 1').get();

    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      message: `Successfully connected to SQLite (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      message: `SQLite connection failed: ${errorMessage}`,
      latencyMs,
    };
  }
}

// ============================================================================
// Backend-Agnostic Operations
// ============================================================================

/**
 * Close all database connections
 */
export async function closeDatabase(): Promise<void> {
  if (isMongoDBBackend()) {
    await closeMongoDB();
  } else {
    closeSQLite();
  }
}

/**
 * Wait for the database to be ready
 */
export async function waitForDatabaseReady(
  maxRetries: number = 10,
  retryDelayMs: number = 1000
): Promise<boolean> {
  const backend = detectDatabaseBackend();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (backend === 'mongodb') {
        const db = await getMongoDatabaseDirect();
        await db.command({ ping: 1 });
      } else {
        const db = getSQLiteDatabase();
        db.prepare('SELECT 1').get();
      }
      return true;
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.error(`${backend} not accessible after retries`, {
    context: 'migrations.database-utils',
    maxRetries,
  });
  return false;
}

// ============================================================================
// SQLite Table Operations (for migrations)
// ============================================================================

/**
 * Check if a table exists in SQLite
 */
export function sqliteTableExists(tableName: string): boolean {
  if (!isSQLiteBackend()) {
    throw new Error('sqliteTableExists can only be called with SQLite backend');
  }

  const db = getSQLiteDatabase();
  const result = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) as { name: string } | undefined;

  return !!result;
}

/**
 * Get column info for a SQLite table
 */
export function getSQLiteTableColumns(tableName: string): Array<{
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: unknown;
  pk: boolean;
}> {
  if (!isSQLiteBackend()) {
    throw new Error('getSQLiteTableColumns can only be called with SQLite backend');
  }

  const db = getSQLiteDatabase();
  return db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{
    name: string;
    type: string;
    notnull: boolean;
    dflt_value: unknown;
    pk: boolean;
  }>;
}

/**
 * Execute a SQL statement on SQLite
 */
export function executeSQLite(sql: string, params: unknown[] = []): void {
  if (!isSQLiteBackend()) {
    throw new Error('executeSQLite can only be called with SQLite backend');
  }

  const db = getSQLiteDatabase();
  db.prepare(sql).run(...params);
}

/**
 * Query SQLite and return results
 */
export function querySQLite<T = unknown>(sql: string, params: unknown[] = []): T[] {
  if (!isSQLiteBackend()) {
    throw new Error('querySQLite can only be called with SQLite backend');
  }

  const db = getSQLiteDatabase();
  return db.prepare(sql).all(...params) as T[];
}
