/**
 * Database Manager
 *
 * Singleton orchestrator for the database abstraction layer.
 * Handles backend initialization, collection management, and provides
 * the main entry point for database operations.
 */

import { z } from 'zod';
import { DatabaseBackend, DatabaseCollection, DatabaseCapabilities } from './interfaces';
import { getDatabaseConfig, DatabaseBackendType } from './config';
import { createSQLiteBackend, SQLiteBackend } from './backends/sqlite';
import { createMongoDBBackend, MongoDBBackend } from './backends/mongodb';
import { logger } from '@/lib/logger';

// ============================================================================
// Singleton State
// ============================================================================

let databaseBackend: DatabaseBackend | null = null;
let initializationPromise: Promise<DatabaseBackend> | null = null;
let isInitialized = false;

// ============================================================================
// Backend Factory
// ============================================================================

/**
 * Create the appropriate backend based on configuration
 */
async function createBackend(backendType: DatabaseBackendType): Promise<DatabaseBackend> {
  logger.info('Creating database backend', { type: backendType });

  switch (backendType) {
    case 'sqlite':
      return createSQLiteBackend();

    case 'mongodb':
      return createMongoDBBackend();

    default:
      throw new Error(`Unknown database backend: ${backendType}`);
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the database backend
 * This is idempotent - calling multiple times returns the same backend
 */
export async function initializeDatabase(): Promise<DatabaseBackend> {
  // Return existing backend if already initialized
  if (isInitialized && databaseBackend) {
    return databaseBackend;
  }

  // Return existing promise if initialization is in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      const config = getDatabaseConfig();
      const backend = await createBackend(config.backend);

      databaseBackend = backend;
      isInitialized = true;

      logger.info('Database backend initialized', {
        type: backend.type,
        capabilities: backend.capabilities,
      });

      return backend;
    } catch (error) {
      logger.error('Failed to initialize database backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * Get the initialized database backend
 * Throws if not initialized - use initializeDatabase() first
 */
export function getDatabase(): DatabaseBackend {
  if (!isInitialized || !databaseBackend) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return databaseBackend;
}

/**
 * Get the database backend, initializing if necessary
 * This is the recommended way to get the database in most cases
 */
export async function getDatabaseAsync(): Promise<DatabaseBackend> {
  if (isInitialized && databaseBackend) {
    return databaseBackend;
  }
  return initializeDatabase();
}

/**
 * Check if the database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return isInitialized && databaseBackend !== null;
}

/**
 * Check if the database is connected
 */
export async function isDatabaseConnected(): Promise<boolean> {
  if (!databaseBackend) {
    return false;
  }
  return databaseBackend.isConnected();
}

// ============================================================================
// Shutdown
// ============================================================================

/**
 * Close the database connection and clean up
 */
export async function closeDatabase(): Promise<void> {
  if (!databaseBackend) {
    return;
  }

  try {
    await databaseBackend.disconnect();
    databaseBackend = null;
    isInitialized = false;
    initializationPromise = null;

    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Collection Access
// ============================================================================

/**
 * Get a collection from the database
 * Initializes the database if not already initialized
 */
export async function getCollection<T = unknown>(name: string): Promise<DatabaseCollection<T>> {
  const backend = await getDatabaseAsync();
  return backend.getCollection<T>(name);
}

/**
 * Ensure a collection exists with the specified schema
 */
export async function ensureCollection(name: string, schema: z.ZodSchema): Promise<void> {
  const backend = await getDatabaseAsync();
  await backend.ensureCollection(name, schema);
}

/**
 * Get all collection names
 */
export async function listCollections(): Promise<string[]> {
  const backend = await getDatabaseAsync();
  return backend.listCollections();
}

// ============================================================================
// Capabilities
// ============================================================================

/**
 * Get the current backend type
 */
export function getBackendType(): DatabaseBackendType | null {
  return databaseBackend?.type || null;
}

/**
 * Get the current backend capabilities
 */
export function getBackendCapabilities(): DatabaseCapabilities | null {
  return databaseBackend?.capabilities || null;
}

/**
 * Check if the current backend supports a specific capability
 */
export function supportsCapability(capability: keyof DatabaseCapabilities): boolean {
  if (!databaseBackend) {
    return false;
  }
  return Boolean(databaseBackend.capabilities[capability]);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Run a health check on the database
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  backend: string;
  latencyMs: number;
  message?: string;
}> {
  if (!databaseBackend) {
    return {
      healthy: false,
      backend: 'none',
      latencyMs: 0,
      message: 'Database not initialized',
    };
  }

  const result = await databaseBackend.healthCheck();

  return {
    ...result,
    backend: databaseBackend.type,
  };
}

// ============================================================================
// Raw Query Access
// ============================================================================

/**
 * Execute a raw query on the database
 * Use with caution - this bypasses the abstraction layer
 */
export async function rawQuery<R = unknown>(query: string, params?: unknown[]): Promise<R> {
  const backend = await getDatabaseAsync();
  return backend.rawQuery<R>(query, params);
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
  fn: (getCollection: <C>(name: string) => DatabaseCollection<C>) => Promise<T>
): Promise<T> {
  const backend = await getDatabaseAsync();

  if (!backend.beginTransaction) {
    // Backend doesn't support transactions, run without
    logger.warn('Backend does not support transactions, running without');
    return fn(<C>(name: string) => backend.getCollection<C>(name));
  }

  const transaction = await backend.beginTransaction();

  try {
    const result = await fn(<C>(name: string) => transaction.getCollection<C>(name));
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ============================================================================
// Testing Support
// ============================================================================

/**
 * Reset the database manager (for testing only)
 */
export function _resetForTesting(): void {
  databaseBackend = null;
  initializationPromise = null;
  isInitialized = false;
}

/**
 * Set a mock backend (for testing only)
 */
export function _setBackendForTesting(backend: DatabaseBackend): void {
  databaseBackend = backend;
  isInitialized = true;
}
