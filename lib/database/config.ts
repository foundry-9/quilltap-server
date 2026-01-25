/**
 * Database Configuration Module
 *
 * Handles configuration for the database abstraction layer,
 * including backend selection, connection settings, and path defaults.
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import path from 'path';
import os from 'os';
import fs from 'fs';

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Database backend type
 */
export const DatabaseBackendTypeSchema = z.enum(['mongodb', 'sqlite']);
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
  synchronous: z.enum(['off', 'normal', 'full', 'extra']).default('normal'),
  /** Cache size in KB (negative for KB, positive for pages) */
  cacheSize: z.int().default(-64000), // 64MB
});
export type SQLiteConfig = z.infer<typeof SQLiteConfigSchema>;

/**
 * MongoDB-specific configuration (references existing config)
 */
export const MongoDBConfigSchema = z.object({
  /** MongoDB connection URI */
  uri: z.string().min(1),
  /** Database name */
  database: z.string().min(1),
  /** Maximum connection pool size */
  maxPoolSize: z.int().positive().default(10),
});
export type MongoDBConfig = z.infer<typeof MongoDBConfigSchema>;

/**
 * Complete database configuration
 */
export const DatabaseConfigSchema = z.object({
  /** Which backend to use */
  backend: DatabaseBackendTypeSchema,
  /** SQLite configuration (required if backend is sqlite) */
  sqlite: SQLiteConfigSchema.optional(),
  /** MongoDB configuration (required if backend is mongodb) */
  mongodb: MongoDBConfigSchema.optional(),
}).refine(
  (data) => {
    if (data.backend === 'sqlite' && !data.sqlite) {
      return false;
    }
    if (data.backend === 'mongodb' && !data.mongodb) {
      return false;
    }
    return true;
  },
  {
      error: 'Configuration for the selected backend must be provided'
}
);
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the default data directory based on environment
 */
export function getDefaultDataDirectory(): string {
  // Docker environment: use /app/data
  if (process.env.DOCKER_CONTAINER === 'true' || fs.existsSync('/app/data')) {
    return '/app/data';
  }

  // Development/production: use ~/.quilltap/data
  const homeDir = os.homedir();
  return path.join(homeDir, '.quilltap', 'data');
}

/**
 * Get the default SQLite database path
 */
export function getDefaultSQLitePath(): string {
  const dataDir = getDefaultDataDirectory();
  return path.join(dataDir, 'quilltap.db');
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
 * Priority:
 * 1. SQLite meta table preferred_backend (if SQLite file exists)
 * 2. Legacy DATA_BACKEND (backward compatibility, with deprecation warning)
 * 3. Explicit DATABASE_BACKEND setting
 * 4. If MONGODB_URI is set, use MongoDB
 * 5. Default to SQLite
 */
export function detectBackend(): DatabaseBackendType {
  // Check SQLite meta table first (if SQLite file exists)
  // This allows users to switch backends via the UI without changing env vars
  // Import is deferred to avoid circular dependency
  try {
    const { getPreferredBackend, sqliteDatabaseExists } = require('./meta');

    if (sqliteDatabaseExists()) {
      const preferredBackend = getPreferredBackend();
      if (preferredBackend) {
        logger.info('Using preferred backend from meta table', {
          context: 'database.config',
          backend: preferredBackend,
        });
        return preferredBackend;
      }
    }
  } catch (error) {
    // Meta module might not be available during testing or if SQLite isn't installed
  }

  // Check for legacy DATA_BACKEND env var (backward compatibility)
  const legacyBackend = process.env.DATA_BACKEND?.toLowerCase();
  if (legacyBackend) {
    logger.warn('DATA_BACKEND environment variable is deprecated. Use DATABASE_BACKEND instead.', {
      context: 'database.config',
      legacyValue: legacyBackend,
    });

    if (legacyBackend === 'mongodb') {
      return 'mongodb';
    }
    if (legacyBackend === 'json') {
      logger.error('JSON backend is no longer supported. Please migrate to SQLite or MongoDB.', {
        context: 'database.config',
      });
      // Fall through to check DATABASE_BACKEND or default
    }
    // Ignore 'dual' value - not supported in new system
  }

  const explicit = process.env.DATABASE_BACKEND?.toLowerCase();

  if (explicit === 'mongodb' || explicit === 'sqlite') {
    return explicit;
  }

  // Auto-detect: if MongoDB URI is configured, use MongoDB
  if (process.env.MONGODB_URI) {
    return 'mongodb';
  }

  // Default to SQLite for simpler deployments
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
 * Load MongoDB configuration from environment
 */
export function loadMongoDBConfig(): MongoDBConfig {
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DATABASE || 'quilltap';

  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required for MongoDB backend');
  }

  return MongoDBConfigSchema.parse({
    uri,
    database,
    maxPoolSize: process.env.MONGODB_MAX_POOL_SIZE
      ? parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10)
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
    sqlite: backend === 'sqlite' ? loadSQLiteConfig() : undefined,
    mongodb: backend === 'mongodb' ? loadMongoDBConfig() : undefined,
  };

  // Validate the complete configuration
  const validated = DatabaseConfigSchema.parse(config);

  // Log configuration (with sensitive data masked)
  if (validated.backend === 'sqlite') {
    logger.info('Database configuration loaded', {
      backend: 'sqlite',
      path: validated.sqlite?.path,
      walMode: validated.sqlite?.walMode,
    });
  } else {
    const maskedUri = validated.mongodb?.uri.replace(
      /mongodb(\+srv)?:\/\/[^@]+@/,
      'mongodb$1://***@'
    );
    logger.info('Database configuration loaded', {
      backend: 'mongodb',
      uri: maskedUri,
      database: validated.mongodb?.database,
    });
  }

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

    if (config.backend === 'sqlite') {
      const dbPath = config.sqlite!.path;
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
    }

    if (config.backend === 'mongodb') {
      // For MongoDB, we can't fully validate without connecting
      // Just check that the URI looks valid
      const uri = config.mongodb!.uri;
      if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        return {
          ready: false,
          error: 'Invalid MongoDB URI format',
        };
      }

      return { ready: true };
    }

    return { ready: false, error: 'Unknown database backend' };
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
  const config = getDatabaseConfig();

  if (config.backend === 'mongodb') {
    // MongoDB supports all these features
    return true;
  }

  if (config.backend === 'sqlite') {
    switch (feature) {
      case 'vectorSearch':
        return false; // Not supported natively
      case 'changeStreams':
        return false; // Not supported
      case 'aggregation':
        return false; // No pipeline support (use SQL)
      default:
        return false;
    }
  }

  return false;
}
