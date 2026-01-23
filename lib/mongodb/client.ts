import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { logger } from '@/lib/logger';
import { validateMongoDBConfig } from './config';

/**
 * Singleton instance of MongoClient
 */
let mongoClient: MongoClient | null = null;

/**
 * Singleton instance of the database
 */
let mongoDatabase: Db | null = null;

/**
 * Promise used to de-dupe concurrent connection attempts
 */
let mongoClientPromise: Promise<MongoClient> | null = null;

/**
 * Helper function to check if client is still connected
 * Uses the configured database instead of 'admin' to work with
 * hosted MongoDB services where the user may not have admin access.
 */
async function isClientConnected(client: MongoClient | null): Promise<boolean> {
  if (!client) return false;
  try {
    const config = validateMongoDBConfig();
    await client.db(config.database).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets or creates the MongoDB client singleton
 * Establishes connection on first call
 * @returns Promise<MongoClient> The MongoDB client instance
 * @throws Error if connection fails after retry attempts
 */
export async function getMongoClient(): Promise<MongoClient> {
  // Return existing client if already connected
  if (await isClientConnected(mongoClient)) {
    return mongoClient!;
  }

  if (mongoClientPromise) {
    return mongoClientPromise;
  }

  let connectingClient: MongoClient | null = null;
  mongoClientPromise = (async () => {
    const config = validateMongoDBConfig();

    const clientOptions: MongoClientOptions = {
      maxPoolSize: config.maxPoolSize,
      minPoolSize: 1,
      maxIdleTimeMS: 60000,
      retryWrites: true,
      retryReads: true,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    };

    connectingClient = new MongoClient(config.uri, clientOptions);

    // Establish connection
    await connectingClient.connect();

    logger.info('Successfully connected to MongoDB', {
      uri: config.uri.replace(/mongodb\+srv:\/\/.*@/, 'mongodb+srv://***@'),
      database: config.database,
    });

    // Test the connection using the configured database (not admin)
    // to work with hosted MongoDB services where user may not have admin access
    await connectingClient.db(config.database).command({ ping: 1 });

    // Set up error listener for connection errors
    connectingClient.on('error', (error) => {
      logger.error('MongoDB client error', { error: error.message });
    });

    mongoClient = connectingClient;
    return mongoClient;
  })();

  try {
    return await mongoClientPromise;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', {
      error: error instanceof Error ? error.message : String(error),
    });
    const clientToClose = connectingClient as MongoClient | null;
    if (clientToClose) {
      try {
        await clientToClose.close();
      } catch {
        // Swallow close errors; we already log the connect failure.
      }
    }
    mongoClient = null;
    throw error;
  } finally {
    mongoClientPromise = null;
  }
}

/**
 * Gets the MongoDB database instance
 * Automatically connects if not already connected
 * @returns Promise<Db> The MongoDB database instance
 * @throws Error if connection fails
 */
export async function getMongoDatabase(): Promise<Db> {
  // Return existing database if client is connected
  if (mongoDatabase && await isClientConnected(mongoClient)) {
    return mongoDatabase;
  }

  mongoDatabase = null;

  try {
    const client = await getMongoClient();
    const config = validateMongoDBConfig();

    mongoDatabase = client.db(config.database);
    return mongoDatabase;
  } catch (error) {
    logger.error('Failed to get MongoDB database', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Checks if MongoDB is currently connected
 * Uses the configured database instead of 'admin' to work with
 * hosted MongoDB services where the user may not have admin access.
 * @returns boolean True if connected, false otherwise
 */
export async function isMongoConnected(): Promise<boolean> {
  if (!mongoClient) {
    return false;
  }

  try {
    const config = validateMongoDBConfig();
    await mongoClient.db(config.database).command({ ping: 1 });
    return true;
  } catch {
    mongoClient = null;
    return false;
  }
}

/**
 * Gracefully closes the MongoDB connection
 * Cleans up resources and removes singleton instances
 * @returns Promise<void>
 */
export async function closeMongoConnection(): Promise<void> {
  try {
    if (mongoClient) {
      await mongoClient.close();
    }

    mongoClient = null;
    mongoDatabase = null;
    mongoClientPromise = null;
  } catch (error) {
    logger.error('Error closing MongoDB connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set up process termination handlers for graceful shutdown
 * This function should be called once during application startup
 */
export function setupMongoDBShutdownHandlers(): void {
  const handleShutdown = async () => {
    await closeMongoConnection();
  };

  // Handle SIGTERM (termination signal)
  process.on('SIGTERM', handleShutdown);

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', handleShutdown);

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception, closing MongoDB connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    await closeMongoConnection();
    process.exit(1);
  });
}
