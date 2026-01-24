/**
 * MongoDB Database Backend
 *
 * Wraps the existing MongoDB client to implement the DatabaseBackend interface,
 * enabling MongoDB to be used interchangeably with other backends.
 */

import { z } from 'zod';
import { Collection, Db, Filter, Document, UpdateFilter, FindOptions, WithId } from 'mongodb';
import {
  DatabaseBackend,
  DatabaseCollection,
  DatabaseTransaction,
  ConnectionState,
  QueryFilter,
  QueryOptions,
  UpdateSpec,
  UpdateOperators,
  InsertResult,
  UpdateResult,
  DeleteResult,
  SortDirection,
  MONGODB_CAPABILITIES,
} from '../../interfaces';
import { MongoDBConfig, loadMongoDBConfig } from '../../config';
import {
  getMongoClient,
  getMongoDatabase,
  closeMongoConnection,
  isMongoConnected,
  setupMongoDBShutdownHandlers,
} from '@/lib/mongodb/client';
import { logger } from '@/lib/logger';

// ============================================================================
// MongoDB Collection Implementation
// ============================================================================

/**
 * MongoDB implementation of DatabaseCollection
 */
class MongoDBCollection<T = unknown> implements DatabaseCollection<T> {
  readonly name: string;
  private collection: Collection;

  constructor(collection: Collection, name: string) {
    this.collection = collection;
    this.name = name;
  }

  /**
   * Convert our query filter to MongoDB filter
   */
  private toMongoFilter(filter: QueryFilter): Filter<Document> {
    // Our filter format is already compatible with MongoDB
    // Just need to handle some edge cases
    return filter as Filter<Document>;
  }

  /**
   * Convert our sort spec to MongoDB sort
   */
  private toMongoSort(sort?: QueryOptions['sort']): FindOptions['sort'] | undefined {
    if (!sort) return undefined;

    const mongoSort: Record<string, 1 | -1> = {};
    for (const [field, direction] of Object.entries(sort)) {
      mongoSort[field] = (direction === 'desc' || direction === -1) ? -1 : 1;
    }
    return mongoSort;
  }

  /**
   * Convert our update spec to MongoDB update
   */
  private toMongoUpdate(update: UpdateSpec<T>): UpdateFilter<Document> {
    // Check if update has operators
    const hasOperators = Object.keys(update as object).some(k => k.startsWith('$'));

    if (hasOperators) {
      return update as UpdateFilter<Document>;
    }

    // Plain object - wrap in $set
    return { $set: update } as UpdateFilter<Document>;
  }

  /**
   * Remove MongoDB's _id field from a document
   */
  private stripId<D>(doc: WithId<Document> | null): D | null {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest as D;
  }

  /**
   * Find a single document
   */
  async findOne(filter: QueryFilter, options?: QueryOptions): Promise<T | null> {
    try {
      const findOptions: FindOptions = {};

      if (options?.projection) {
        findOptions.projection = options.projection;
      }

      const result = await this.collection.findOne(
        this.toMongoFilter(filter),
        findOptions
      );

      return this.stripId<T>(result);
    } catch (error) {
      logger.error('MongoDB findOne error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find multiple documents
   */
  async find(filter: QueryFilter, options?: QueryOptions): Promise<T[]> {
    try {
      let cursor = this.collection.find(this.toMongoFilter(filter));

      if (options?.sort) {
        cursor = cursor.sort(this.toMongoSort(options.sort)!);
      }

      if (options?.skip !== undefined) {
        cursor = cursor.skip(options.skip);
      }

      if (options?.limit !== undefined) {
        cursor = cursor.limit(options.limit);
      }

      if (options?.projection) {
        cursor = cursor.project(options.projection);
      }

      const results = await cursor.toArray();

      return results.map(doc => this.stripId<T>(doc)!);
    } catch (error) {
      logger.error('MongoDB find error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert a single document
   */
  async insertOne(document: T): Promise<InsertResult> {
    try {
      const result = await this.collection.insertOne(document as Document);

      const doc = document as Record<string, unknown>;

      return {
        insertedId: doc.id as string,
        acknowledged: result.acknowledged,
      };
    } catch (error) {
      logger.error('MongoDB insertOne error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert multiple documents
   */
  async insertMany(documents: T[]): Promise<{ insertedIds: string[]; acknowledged: boolean }> {
    try {
      const result = await this.collection.insertMany(documents as Document[]);

      const insertedIds = documents.map(doc => (doc as Record<string, unknown>).id as string);

      return {
        insertedIds,
        acknowledged: result.acknowledged,
      };
    } catch (error) {
      logger.error('MongoDB insertMany error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a single document
   */
  async updateOne(filter: QueryFilter, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      const result = await this.collection.updateOne(
        this.toMongoFilter(filter),
        this.toMongoUpdate(update)
      );

      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        acknowledged: result.acknowledged,
        upsertedId: result.upsertedId?.toString(),
      };
    } catch (error) {
      logger.error('MongoDB updateOne error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update multiple documents
   */
  async updateMany(filter: QueryFilter, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      const result = await this.collection.updateMany(
        this.toMongoFilter(filter),
        this.toMongoUpdate(update)
      );

      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        acknowledged: result.acknowledged,
      };
    } catch (error) {
      logger.error('MongoDB updateMany error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find and update a document, returning the result
   */
  async findOneAndUpdate(
    filter: QueryFilter,
    update: UpdateSpec<T>,
    options?: { returnDocument?: 'before' | 'after'; upsert?: boolean }
  ): Promise<T | null> {
    try {
      const result = await this.collection.findOneAndUpdate(
        this.toMongoFilter(filter),
        this.toMongoUpdate(update),
        {
          returnDocument: options?.returnDocument === 'before' ? 'before' : 'after',
          upsert: options?.upsert,
        }
      );

      return this.stripId<T>(result);
    } catch (error) {
      logger.error('MongoDB findOneAndUpdate error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a single document
   */
  async deleteOne(filter: QueryFilter): Promise<DeleteResult> {
    try {
      const result = await this.collection.deleteOne(this.toMongoFilter(filter));

      return {
        deletedCount: result.deletedCount,
        acknowledged: result.acknowledged,
      };
    } catch (error) {
      logger.error('MongoDB deleteOne error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(filter: QueryFilter): Promise<DeleteResult> {
    try {
      const result = await this.collection.deleteMany(this.toMongoFilter(filter));

      return {
        deletedCount: result.deletedCount,
        acknowledged: result.acknowledged,
      };
    } catch (error) {
      logger.error('MongoDB deleteMany error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count documents matching filter
   */
  async countDocuments(filter?: QueryFilter): Promise<number> {
    try {
      return await this.collection.countDocuments(filter ? this.toMongoFilter(filter) : {});
    } catch (error) {
      logger.error('MongoDB countDocuments error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if any documents match filter
   */
  async exists(filter: QueryFilter): Promise<boolean> {
    try {
      const result = await this.collection.findOne(this.toMongoFilter(filter), {
        projection: { _id: 1 },
      });
      return result !== null;
    } catch (error) {
      logger.error('MongoDB exists error', {
        collection: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// ============================================================================
// MongoDB Backend Implementation
// ============================================================================

/**
 * MongoDB Database Backend implementation
 */
export class MongoDBBackend implements DatabaseBackend {
  readonly type = 'mongodb' as const;
  readonly capabilities = MONGODB_CAPABILITIES;

  private config: MongoDBConfig;
  private db: Db | null = null;
  private _state: ConnectionState = 'disconnected';

  constructor(config?: MongoDBConfig) {
    this.config = config || loadMongoDBConfig();
  }

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' && this.db) {
      return;
    }

    this._state = 'connecting';

    try {
      this.db = await getMongoDatabase();
      this._state = 'connected';

      setupMongoDBShutdownHandlers();

      logger.info('MongoDB backend connected', {
        database: this.config.database,
      });
    } catch (error) {
      this._state = 'error';
      logger.error('Failed to connect MongoDB backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    try {
      await closeMongoConnection();
      this.db = null;
      this._state = 'disconnected';

      logger.info('MongoDB backend disconnected');
    } catch (error) {
      logger.error('Error disconnecting MongoDB backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    return this._state === 'connected' && await isMongoConnected();
  }

  /**
   * Get a collection by name
   */
  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    const collection = this.db.collection(name);
    return new MongoDBCollection<T>(collection, name);
  }

  /**
   * Ensure a collection exists with the specified schema
   * For MongoDB, this mainly creates indexes
   */
  async ensureCollection(name: string, schema: z.ZodType): Promise<void> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    try {
      // MongoDB creates collections automatically on first insert
      // We mainly need to ensure indexes exist

      const collection = this.db.collection(name);

      // Create standard indexes
      await collection.createIndex({ id: 1 }, { unique: true });

      // Create userId index if the schema might have it
      // We'll be lenient here - index creation is idempotent
      try {
        await collection.createIndex({ userId: 1 });
      } catch {
        // userId might not exist in all collections, that's OK
      }

      // Create createdAt index for time-based queries
      try {
        await collection.createIndex({ createdAt: -1 });
      } catch {
        // createdAt might not exist in all collections, that's OK
      }

      logger.info('Ensured collection exists', { collection: name });
    } catch (error) {
      logger.error('Failed to ensure collection', {
        collection: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Drop a collection
   */
  async dropCollection(name: string): Promise<void> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    try {
      await this.db.dropCollection(name);
      logger.info('Dropped collection', { collection: name });
    } catch (error: any) {
      // Ignore error if collection doesn't exist
      if (error.codeName !== 'NamespaceNotFound') {
        logger.error('Failed to drop collection', {
          collection: name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    try {
      const collections = await this.db.listCollections().toArray();
      return collections.map(c => c.name);
    } catch (error) {
      logger.error('Failed to list collections', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a raw query
   * For MongoDB, this runs an aggregation pipeline or command
   */
  async rawQuery<R = unknown>(query: string, params: unknown[] = []): Promise<R> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    try {
      // Parse the query string as a MongoDB command
      const command = JSON.parse(query);
      const result = await this.db.command(command);
      return result as R;
    } catch (error) {
      logger.error('Raw query failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<DatabaseTransaction> {
    if (!this.db) {
      throw new Error('MongoDB backend not connected');
    }

    const client = await getMongoClient();
    const session = client.startSession();
    session.startTransaction();

    return new MongoDBTransaction(this.db, session);
  }

  /**
   * Run a health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const startTime = Date.now();

    try {
      if (!this.db) {
        return {
          healthy: false,
          latencyMs: Date.now() - startTime,
          message: 'Database not connected',
        };
      }

      await this.db.command({ ping: 1 });

      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// MongoDB Transaction Implementation
// ============================================================================

import { ClientSession } from 'mongodb';

/**
 * MongoDB Transaction wrapper
 */
class MongoDBTransaction implements DatabaseTransaction {
  private db: Db;
  private session: ClientSession;
  private ended = false;

  constructor(db: Db, session: ClientSession) {
    this.db = db;
    this.session = session;
  }

  async commit(): Promise<void> {
    if (this.ended) {
      throw new Error('Transaction already ended');
    }
    await this.session.commitTransaction();
    await this.session.endSession();
    this.ended = true;
  }

  async rollback(): Promise<void> {
    if (this.ended) {
      throw new Error('Transaction already ended');
    }
    await this.session.abortTransaction();
    await this.session.endSession();
    this.ended = true;
  }

  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    // Note: For full transaction support, operations should use the session
    // This is a simplified implementation
    const collection = this.db.collection(name);
    return new MongoDBCollection<T>(collection, name);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new MongoDB backend instance
 */
export async function createMongoDBBackend(config?: MongoDBConfig): Promise<MongoDBBackend> {
  const backend = new MongoDBBackend(config);
  await backend.connect();
  return backend;
}
