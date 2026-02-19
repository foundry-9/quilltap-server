/**
 * Database Configuration Module
 *
 * Handles configuration for the database abstraction layer,
 * including backend selection, connection settings, and path defaults.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import path from 'path';
import fs from 'fs';
import {
  getDataDir,
  getSQLiteDatabasePath,
  isDockerEnvironment,
} from '@/lib/paths';

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Database backend type
 */
export const DatabaseBackendTypeSchema = z.enum(['sqlite']);
export type DatabaseBackendType = z.infer<typeof DatabaseBackendTypeSchema>;

/**
 * SQLite-specific configuration
 */
export const SQLiteConfigSchema = z.object({
  /** Path to the SQLite database file */
  path: z.string().min(1),
  /** Enable WAL (Write-Ahead Logging) mode for better concurrency */
  walMode: z.boolean().default(true),
  /** Busy timeout in milliseconds */
  busyTimeout: z.int().positive().default(5000),
  /** Enable foreign key constraints */
  foreignKeys: z.boolean().default(true),
  /** Journal mode (only used if walMode is false) */
  journalMode: z.enum(['delete', 'truncate', 'persist', 'memory', 'off']).default('delete'),
  /** Synchronous mode */
  synchronous: z.enum(['off', 'normal', 'full', 'extra']).default('full'),
  /** Cache size in KB (negative for KB, positive for pages) */
  cacheSize: z.int().default(-64000), // 64MB
});
export type SQLiteConfig = z.infer<typeof SQLiteConfigSchema>;


/**
 * Complete database configuration
 */
export const DatabaseConfigSchema = z.object({
  /** Which backend to use */
  backend: DatabaseBackendTypeSchema,
  /** SQLite configuration (required) */
  sqlite: SQLiteConfigSchema,
}).refine(
  (data) => {
    if (!data.sqlite) {
      return false;
    }
    return true;
  },
  {
      error: 'SQLite configuration must be provided'
}
);
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the default data directory based on environment
 *
 * Uses centralized path resolution from lib/paths.ts which provides:
 * - Platform-specific defaults (Linux: ~/.quilltap, macOS: ~/Library/Application Support/Quilltap, etc.)
 * - QUILLTAP_DATA_DIR environment variable override
 * - Docker detection (/app/quilltap/data)
 */
export function getDefaultDataDirectory(): string {
  return getDataDir();
}

/**
 * Get the default SQLite database path
 *
 * Uses centralized path resolution from lib/paths.ts
 */
export function getDefaultSQLitePath(): string {
  return getSQLiteDatabasePath();
}

/**
 * Ensure the data directory exists
 */
export function ensureDataDirectoryExists(dataDir?: string): void {
  const dir = dataDir || getDefaultDataDirectory();
  if (!fs.existsSync(dir)) {
    logger.info('Creating data directory', { path: dir });
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Detect the appropriate backend based on environment variables
 * Always returns 'sqlite' as MongoDB support has been removed.
 */
export function detectBackend(): DatabaseBackendType {
  return 'sqlite';
}

/**
 * Load SQLite configuration from environment
 */
export function loadSQLiteConfig(): SQLiteConfig {
  const dbPath = process.env.SQLITE_PATH || getDefaultSQLitePath();

  // Ensure the parent directory exists
  const dbDir = path.dirname(dbPath);
  ensureDataDirectoryExists(dbDir);

  return SQLiteConfigSchema.parse({
    path: dbPath,
    walMode: process.env.SQLITE_WAL_MODE !== 'false',
    busyTimeout: process.env.SQLITE_BUSY_TIMEOUT
      ? parseInt(process.env.SQLITE_BUSY_TIMEOUT, 10)
      : undefined,
    foreignKeys: process.env.SQLITE_FOREIGN_KEYS !== 'false',
    synchronous: process.env.SQLITE_SYNCHRONOUS || undefined,
    cacheSize: process.env.SQLITE_CACHE_SIZE
      ? parseInt(process.env.SQLITE_CACHE_SIZE, 10)
      : undefined,
  });
}


/**
 * Load complete database configuration from environment
 */
export function loadDatabaseConfig(): DatabaseConfig {
  const backend = detectBackend();

  logger.info('Detected database backend', { backend });

  const config: DatabaseConfig = {
    backend,
    sqlite: loadSQLiteConfig(),
  };

  // Validate the complete configuration
  const validated = DatabaseConfigSchema.parse(config);

  // Log configuration
  logger.info('Database configuration loaded', {
    backend: 'sqlite',
    path: validated.sqlite.path,
    walMode: validated.sqlite.walMode,
  });

  return validated;
}

// ============================================================================
// Singleton Configuration
// ============================================================================

let cachedConfig: DatabaseConfig | null = null;

/**
 * Get the database configuration (cached)
 */
export function getDatabaseConfig(): DatabaseConfig {
  if (!cachedConfig) {
    cachedConfig = loadDatabaseConfig();
  }
  return cachedConfig;
}

/**
 * Reset the cached configuration (for testing)
 */
export function resetDatabaseConfig(): void {
  cachedConfig = null;
}

/**
 * Override the database configuration (for testing)
 */
export function setDatabaseConfig(config: DatabaseConfig): void {
  cachedConfig = DatabaseConfigSchema.parse(config);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that the current configuration is ready for use
 */
export function validateDatabaseReady(): { ready: boolean; error?: string } {
  try {
    const config = getDatabaseConfig();
    const dbPath = config.sqlite.path;
    const dbDir = path.dirname(dbPath);

    // Check if directory is writable
    try {
      fs.accessSync(dbDir, fs.constants.W_OK);
    } catch {
      return {
        ready: false,
        error: `SQLite data directory is not writable: ${dbDir}`,
      };
    }

    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Feature Checks
// ============================================================================

/**
 * Check if the current backend supports a specific feature
 */
export function backendSupports(feature: 'vectorSearch' | 'changeStreams' | 'aggregation'): boolean {
  switch (feature) {
    case 'vectorSearch':
      return false; // Not supported natively in SQLite
    case 'changeStreams':
      return false; // Not supported in SQLite
    case 'aggregation':
      return false; // No pipeline support in SQLite (use SQL)
    default:
      return false;
  }
}
