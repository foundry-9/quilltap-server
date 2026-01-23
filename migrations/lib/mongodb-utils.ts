/**
 * MongoDB Utilities for Migrations
 *
 * Self-contained MongoDB configuration validation and connection testing.
 * This module is separate from the main app's MongoDB client to ensure
 * migrations can run before the full app is initialized.
 */

import { MongoClient, Db } from 'mongodb';
import { logger } from './logger';

/**
 * MongoDB configuration interface
 */
export interface MongoDBConfig {
  uri: string;
  database: string;
  mode: 'external' | 'embedded';
  dataDir?: string;
  connectionTimeoutMs: number;
  maxPoolSize: number;
  isConfigured: boolean;
  errors: string[];
}

/**
 * Sanitize MongoDB URI for logging by masking password
 */
function sanitizeURI(uri: string): string {
  try {
    return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
  } catch {
    return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2');
  }
}

/**
 * Get MongoDB configuration from environment variables
 */
function getMongoDBConfigFromEnv(): Partial<MongoDBConfig> {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const database = process.env.MONGODB_DATABASE || 'quilltap';
  const mode = (process.env.MONGODB_MODE || 'external') as 'external' | 'embedded';
  const dataDir = process.env.MONGODB_DATA_DIR || '/data/mongodb';
  const connectionTimeoutMs = process.env.MONGODB_CONNECTION_TIMEOUT_MS
    ? Number.parseInt(process.env.MONGODB_CONNECTION_TIMEOUT_MS)
    : 10000;
  const maxPoolSize = process.env.MONGODB_MAX_POOL_SIZE
    ? Number.parseInt(process.env.MONGODB_MAX_POOL_SIZE)
    : 10;

  return {
    uri,
    database,
    mode,
    dataDir,
    connectionTimeoutMs,
    maxPoolSize,
  };
}

/**
 * Validate MongoDB configuration
 * Returns configuration object with isConfigured flag and any validation errors
 */
export function validateMongoDBConfig(): MongoDBConfig {
  logger.debug('Validating MongoDB configuration', {
    context: 'migrations.mongodb-utils',
    dataBackend: process.env.DATA_BACKEND,
    mode: process.env.MONGODB_MODE,
  });

  const config = getMongoDBConfigFromEnv();
  const errors: string[] = [];
  let isConfigured = false;

  // Validate URI
  if (!config.uri || config.uri.length === 0) {
    errors.push('MongoDB URI is required');
  }

  // Validate database name
  if (!config.database || config.database.length === 0) {
    errors.push('Database name is required');
  }

  // Validate mode
  if (config.mode !== 'external' && config.mode !== 'embedded') {
    errors.push('Mode must be either "external" or "embedded"');
  }

  // Validate connection timeout
  if (config.connectionTimeoutMs !== undefined &&
      (typeof config.connectionTimeoutMs !== 'number' ||
       config.connectionTimeoutMs <= 0 ||
       !Number.isInteger(config.connectionTimeoutMs))) {
    errors.push('Connection timeout must be a positive integer');
  }

  // Validate max pool size
  if (config.maxPoolSize !== undefined &&
      (typeof config.maxPoolSize !== 'number' ||
       config.maxPoolSize <= 0 ||
       !Number.isInteger(config.maxPoolSize))) {
    errors.push('Max pool size must be a positive integer');
  }

  if (errors.length === 0) {
    isConfigured = true;
    logger.debug('MongoDB configuration validated successfully', {
      context: 'migrations.mongodb-utils',
      database: config.database,
      mode: config.mode,
      uri: sanitizeURI(config.uri!),
      connectionTimeoutMs: config.connectionTimeoutMs,
      maxPoolSize: config.maxPoolSize,
    });
  } else {
    logger.warn('MongoDB configuration validation failed', {
      context: 'migrations.mongodb-utils',
      errors,
    });
  }

  return {
    uri: config.uri || '',
    database: config.database || '',
    mode: config.mode || 'external',
    dataDir: config.dataDir,
    connectionTimeoutMs: config.connectionTimeoutMs || 10000,
    maxPoolSize: config.maxPoolSize || 10,
    isConfigured,
    errors,
  };
}

/**
 * Test MongoDB connection
 * Attempts to connect and run a ping command, measuring latency
 */
export async function testMongoDBConnection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  // Return early if using JSON backend
  if (process.env.DATA_BACKEND === 'json') {
    logger.debug('Data backend is JSON, skipping MongoDB connection test', {
      context: 'migrations.mongodb-utils',
    });
    return {
      success: true,
      message: 'JSON backend is configured, MongoDB not required',
    };
  }

  const config = validateMongoDBConfig();

  if (!config.isConfigured) {
    const errorMessage = `MongoDB configuration invalid: ${config.errors.join(', ')}`;
    logger.error('Cannot test MongoDB connection - configuration invalid', {
      context: 'migrations.mongodb-utils',
      errors: config.errors,
    });
    return {
      success: false,
      message: errorMessage,
    };
  }

  let client: MongoClient | null = null;
  const startTime = Date.now();

  try {
    logger.debug('Attempting MongoDB connection', {
      context: 'migrations.mongodb-utils',
      uri: sanitizeURI(config.uri),
      timeout: config.connectionTimeoutMs,
    });

    client = new MongoClient(config.uri, {
      serverSelectionTimeoutMS: config.connectionTimeoutMs,
      connectTimeoutMS: config.connectionTimeoutMs,
      maxPoolSize: config.maxPoolSize,
    });

    // Attempt to connect and ping the server
    await client.connect();
    const admin = client.db('admin');
    await admin.command({ ping: 1 });

    const latencyMs = Date.now() - startTime;

    logger.info('MongoDB connection test successful', {
      context: 'migrations.mongodb-utils',
      uri: sanitizeURI(config.uri),
      database: config.database,
      latencyMs,
    });

    return {
      success: true,
      message: `Successfully connected to MongoDB (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('MongoDB connection test failed', {
      context: 'migrations.mongodb-utils',
      uri: sanitizeURI(config.uri),
      error: errorMessage,
      latencyMs,
    });

    return {
      success: false,
      message: `MongoDB connection failed: ${errorMessage}`,
      latencyMs,
    };
  } finally {
    if (client) {
      try {
        await client.close();
        logger.debug('MongoDB client connection closed', {
          context: 'migrations.mongodb-utils',
        });
      } catch (error) {
        const closeError = error instanceof Error ? error.message : String(error);
        logger.warn('Error closing MongoDB connection', {
          context: 'migrations.mongodb-utils',
          error: closeError,
        });
      }
    }
  }
}

// Cached MongoDB client for the migration runner
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

/**
 * Get MongoDB database instance for migrations
 * Uses a cached connection if available
 */
export async function getMongoDatabase(): Promise<Db> {
  const config = validateMongoDBConfig();

  if (!config.isConfigured) {
    throw new Error(`MongoDB not configured: ${config.errors.join(', ')}`);
  }

  // Return cached db if available
  if (cachedDb && cachedClient) {
    try {
      // Quick check that connection is still alive
      await cachedClient.db('admin').command({ ping: 1 });
      return cachedDb;
    } catch {
      // Connection lost, reconnect
      cachedClient = null;
      cachedDb = null;
    }
  }

  // Create new connection
  cachedClient = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: config.connectionTimeoutMs,
    connectTimeoutMS: config.connectionTimeoutMs,
    maxPoolSize: config.maxPoolSize,
  });

  await cachedClient.connect();
  cachedDb = cachedClient.db(config.database);

  logger.debug('Created new MongoDB connection for migrations', {
    context: 'migrations.mongodb-utils',
    database: config.database,
  });

  return cachedDb;
}

/**
 * Close the cached MongoDB connection
 */
export async function closeMongoDB(): Promise<void> {
  if (cachedClient) {
    try {
      await cachedClient.close();
      logger.debug('Closed cached MongoDB connection', {
        context: 'migrations.mongodb-utils',
      });
    } catch (error) {
      logger.warn('Error closing cached MongoDB connection', {
        context: 'migrations.mongodb-utils',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cachedClient = null;
      cachedDb = null;
    }
  }
}

/**
 * Check if MongoDB backend is enabled
 *
 * MongoDB is the default and only supported backend. The 'json' backend
 * is deprecated. If DATA_BACKEND is not set, it defaults to 'mongodb'.
 */
export function isMongoDBBackend(): boolean {
  const backend = process.env.DATA_BACKEND || 'mongodb';
  return backend === 'mongodb' || backend === 'dual';
}
