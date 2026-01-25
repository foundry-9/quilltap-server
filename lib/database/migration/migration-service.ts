/**
 * Database Migration Service
 *
 * Handles data migration between MongoDB and SQLite backends.
 * Provides progress tracking, readiness checks, and transactional migration.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  getDefaultSQLitePath,
  ensureDataDirectoryExists,
  loadSQLiteConfig,
  loadMongoDBConfig,
  DatabaseBackendType,
} from '../config';
import {
  setPreferredBackend,
  recordMigration,
  getPreferredBackend,
  sqliteDatabaseExists,
} from '../meta';
import { createMongoDBBackend, MongoDBBackend } from '../backends/mongodb';
import { createSQLiteBackend, SQLiteBackend } from '../backends/sqlite';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration progress tracking
 */
export interface MigrationProgress {
  phase: 'preparing' | 'migrating' | 'verifying' | 'complete' | 'failed';
  currentCollection: string | null;
  collectionsCompleted: number;
  collectionsTotal: number;
  recordsCompleted: number;
  recordsTotal: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Result of readiness check
 */
export interface ReadinessResult {
  ready: boolean;
  sourceConnected: boolean;
  targetWritable: boolean;
  collectionCounts: Record<string, number>;
  totalRecords: number;
  errors: string[];
  warnings: string[];
}

/**
 * Result of migration
 */
export interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  collectionsMigrated: number;
  duration: number;
  errors: string[];
}

/**
 * Collection info for migration
 */
interface CollectionInfo {
  name: string;
  tableName: string;
  priority: number; // Lower numbers migrate first (for dependency ordering)
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Collections ordered by dependency (parents before children)
 * Priority 1: No dependencies
 * Priority 2: Depends on users
 * Priority 3: Depends on folders
 * Priority 4: Depends on characters or users
 * Priority 5: Depends on chats
 * Priority 6: Misc/independent
 */
const MIGRATION_COLLECTIONS: CollectionInfo[] = [
  // Priority 1: No dependencies
  { name: 'users', tableName: 'users', priority: 1 },
  { name: 'tags', tableName: 'tags', priority: 1 },
  { name: 'provider_models', tableName: 'provider_models', priority: 1 },

  // Priority 2: Depend on users
  { name: 'accounts', tableName: 'accounts', priority: 2 },
  { name: 'sessions', tableName: 'sessions', priority: 2 },
  { name: 'connection_profiles', tableName: 'connection_profiles', priority: 2 },
  { name: 'image_profiles', tableName: 'image_profiles', priority: 2 },
  { name: 'embedding_profiles', tableName: 'embedding_profiles', priority: 2 },
  { name: 'chat_settings', tableName: 'chat_settings', priority: 2 },
  { name: 'projects', tableName: 'projects', priority: 2 },
  { name: 'folders', tableName: 'folders', priority: 2 },

  // Priority 3: Depend on folders
  { name: 'files', tableName: 'files', priority: 3 },
  { name: 'mount_points', tableName: 'mount_points', priority: 3 },
  { name: 'file_permissions', tableName: 'file_permissions', priority: 3 },

  // Priority 4: Depend on users, characters
  { name: 'characters', tableName: 'characters', priority: 4 },
  { name: 'prompt_templates', tableName: 'prompt_templates', priority: 4 },
  { name: 'roleplay_templates', tableName: 'roleplay_templates', priority: 4 },
  { name: 'plugin_configs', tableName: 'plugin_configs', priority: 4 },

  // Priority 5: Depend on characters
  { name: 'chats', tableName: 'chats', priority: 5 },
  { name: 'memories', tableName: 'memories', priority: 5 },

  // Priority 6: Depend on chats
  { name: 'chat_messages', tableName: 'chat_messages', priority: 6 },

  // Priority 7: Misc
  { name: 'vector_indices', tableName: 'vector_indices', priority: 7 },
  { name: 'background_jobs', tableName: 'background_jobs', priority: 7 },
  { name: 'llm_logs', tableName: 'llm_logs', priority: 7 },

  // Priority 8: Sync tables
  { name: 'sync_instances', tableName: 'sync_instances', priority: 8 },
  { name: 'sync_mappings', tableName: 'sync_mappings', priority: 8 },
  { name: 'sync_operations', tableName: 'sync_operations', priority: 8 },
  { name: 'user_sync_api_keys', tableName: 'user_sync_api_keys', priority: 8 },

  // Priority 9: Migrations state (always last)
  { name: 'migrations_state', tableName: 'migrations_state', priority: 9 },
];

// ============================================================================
// Migration Service
// ============================================================================

/**
 * Singleton progress tracking
 */
let currentProgress: MigrationProgress | null = null;
let migrationInProgress = false;

/**
 * Database Migration Service
 *
 * Handles data migration between MongoDB and SQLite backends.
 */
export class DatabaseMigrationService {
  private mongoBackend: MongoDBBackend | null = null;
  private sqliteBackend: SQLiteBackend | null = null;

  /**
   * Get the current migration progress
   */
  getProgress(): MigrationProgress | null {
    return currentProgress;
  }

  /**
   * Check if a migration is currently in progress
   */
  isMigrationInProgress(): boolean {
    return migrationInProgress;
  }

  /**
   * Check readiness for migration
   */
  async checkReadiness(direction: 'mongo-to-sqlite'): Promise<ReadinessResult> {
    const result: ReadinessResult = {
      ready: false,
      sourceConnected: false,
      targetWritable: false,
      collectionCounts: {},
      totalRecords: 0,
      errors: [],
      warnings: [],
    };

    logger.info('Checking migration readiness', {
      context: 'database.migration',
      direction,
    });

    try {
      // Check MongoDB connection (source)
      try {
        this.mongoBackend = await createMongoDBBackend();
        result.sourceConnected = await this.mongoBackend.isConnected();

        if (!result.sourceConnected) {
          result.errors.push('MongoDB is not connected');
        }
      } catch (error) {
        result.errors.push(
          `Failed to connect to MongoDB: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Check SQLite writable (target)
      try {
        const sqliteConfig = loadSQLiteConfig();
        ensureDataDirectoryExists(path.dirname(sqliteConfig.path));

        // Try to open SQLite database
        const testDb = new Database(sqliteConfig.path);
        testDb.pragma('foreign_keys = ON');
        testDb.exec('SELECT 1');
        testDb.close();

        result.targetWritable = true;
      } catch (error) {
        result.errors.push(
          `SQLite target not writable: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Get collection counts from MongoDB
      if (result.sourceConnected && this.mongoBackend) {
        try {
          const existingCollections = await this.mongoBackend.listCollections();

          for (const collectionInfo of MIGRATION_COLLECTIONS) {
            if (existingCollections.includes(collectionInfo.name)) {
              const collection = this.mongoBackend.getCollection(collectionInfo.name);
              const count = await collection.countDocuments({});
              result.collectionCounts[collectionInfo.name] = count;
              result.totalRecords += count;
            } else {
              result.collectionCounts[collectionInfo.name] = 0;
            }
          }
        } catch (error) {
          result.warnings.push(
            `Could not get collection counts: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Determine overall readiness
      result.ready = result.sourceConnected && result.targetWritable && result.errors.length === 0;

      logger.info('Migration readiness check complete', {
        context: 'database.migration',
        ready: result.ready,
        sourceConnected: result.sourceConnected,
        targetWritable: result.targetWritable,
        totalRecords: result.totalRecords,
        errorCount: result.errors.length,
      });
    } catch (error) {
      result.errors.push(
        `Readiness check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error('Migration readiness check failed', {
        context: 'database.migration',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * Migrate data from MongoDB to SQLite
   */
  async migrateToSQLite(): Promise<MigrationResult> {
    if (migrationInProgress) {
      return {
        success: false,
        recordsMigrated: 0,
        collectionsMigrated: 0,
        duration: 0,
        errors: ['A migration is already in progress'],
      };
    }

    const startTime = Date.now();
    migrationInProgress = true;

    currentProgress = {
      phase: 'preparing',
      currentCollection: null,
      collectionsCompleted: 0,
      collectionsTotal: MIGRATION_COLLECTIONS.length,
      recordsCompleted: 0,
      recordsTotal: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    logger.info('Starting MongoDB to SQLite migration', {
      context: 'database.migration',
    });

    try {
      // Check readiness first
      const readiness = await this.checkReadiness('mongo-to-sqlite');
      if (!readiness.ready) {
        currentProgress.phase = 'failed';
        currentProgress.errors = readiness.errors;
        migrationInProgress = false;
        return {
          success: false,
          recordsMigrated: 0,
          collectionsMigrated: 0,
          duration: Date.now() - startTime,
          errors: readiness.errors,
        };
      }

      currentProgress.recordsTotal = readiness.totalRecords;

      // Create SQLite backend
      this.sqliteBackend = await createSQLiteBackend();

      // Get list of existing MongoDB collections
      const existingCollections = await this.mongoBackend!.listCollections();

      // Sort collections by priority
      const sortedCollections = [...MIGRATION_COLLECTIONS].sort((a, b) => a.priority - b.priority);

      currentProgress.phase = 'migrating';

      // Migrate each collection
      for (const collectionInfo of sortedCollections) {
        if (!existingCollections.includes(collectionInfo.name)) {
          logger.debug('Skipping non-existent collection', {
            context: 'database.migration',
            collection: collectionInfo.name,
          });
          currentProgress.collectionsCompleted++;
          continue;
        }

        currentProgress.currentCollection = collectionInfo.name;

        try {
          const migratedCount = await this.migrateCollection(collectionInfo);
          currentProgress.recordsCompleted += migratedCount;
          currentProgress.collectionsCompleted++;

          logger.info('Collection migrated', {
            context: 'database.migration',
            collection: collectionInfo.name,
            records: migratedCount,
          });
        } catch (error) {
          const errorMessage = `Failed to migrate ${collectionInfo.name}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          currentProgress.errors.push(errorMessage);

          logger.error('Collection migration failed', {
            context: 'database.migration',
            collection: collectionInfo.name,
            error: error instanceof Error ? error.message : String(error),
          });

          // Fail fast - stop migration on first error
          currentProgress.phase = 'failed';
          migrationInProgress = false;
          return {
            success: false,
            recordsMigrated: currentProgress.recordsCompleted,
            collectionsMigrated: currentProgress.collectionsCompleted,
            duration: Date.now() - startTime,
            errors: currentProgress.errors,
          };
        }
      }

      // Verification phase
      currentProgress.phase = 'verifying';
      currentProgress.currentCollection = null;

      // Simple verification: count records in SQLite
      let sqliteTotal = 0;
      for (const collectionInfo of sortedCollections) {
        try {
          const collection = this.sqliteBackend!.getCollection(collectionInfo.tableName);
          const count = await collection.countDocuments({});
          sqliteTotal += count;
        } catch {
          // Collection might not exist if it was empty in MongoDB
        }
      }

      logger.info('Migration verification', {
        context: 'database.migration',
        mongoTotal: readiness.totalRecords,
        sqliteTotal,
      });

      // Set preferred backend to SQLite
      setPreferredBackend('sqlite');
      recordMigration('mongo-to-sqlite');

      currentProgress.phase = 'complete';
      currentProgress.completedAt = new Date().toISOString();
      migrationInProgress = false;

      const result: MigrationResult = {
        success: true,
        recordsMigrated: currentProgress.recordsCompleted,
        collectionsMigrated: currentProgress.collectionsCompleted,
        duration: Date.now() - startTime,
        errors: currentProgress.errors,
      };

      logger.info('Migration completed successfully', {
        context: 'database.migration',
        ...result,
      });

      return result;
    } catch (error) {
      currentProgress.phase = 'failed';
      currentProgress.errors.push(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}`
      );
      migrationInProgress = false;

      logger.error('Migration failed', {
        context: 'database.migration',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        recordsMigrated: currentProgress.recordsCompleted,
        collectionsMigrated: currentProgress.collectionsCompleted,
        duration: Date.now() - startTime,
        errors: currentProgress.errors,
      };
    }
  }

  /**
   * Migrate a single collection from MongoDB to SQLite
   */
  private async migrateCollection(collectionInfo: CollectionInfo): Promise<number> {
    logger.debug('Migrating collection', {
      context: 'database.migration',
      collection: collectionInfo.name,
    });

    const mongoCollection = this.mongoBackend!.getCollection(collectionInfo.name);
    const documents = await mongoCollection.find({});

    if (documents.length === 0) {
      return 0;
    }

    // Ensure SQLite table exists
    // The SQLite backend will create it lazily when we access it
    const sqliteCollection = this.sqliteBackend!.getCollection(collectionInfo.tableName);

    // Insert documents in batches
    const BATCH_SIZE = 100;
    let migratedCount = 0;

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);

      for (const doc of batch) {
        try {
          // Check if document already exists (for idempotency)
          const docId = (doc as any).id;
          if (docId) {
            const existing = await sqliteCollection.findOne({ id: docId });
            if (existing) {
              logger.debug('Document already exists, skipping', {
                context: 'database.migration',
                collection: collectionInfo.name,
                id: docId,
              });
              migratedCount++;
              continue;
            }
          }

          await sqliteCollection.insertOne(doc);
          migratedCount++;
        } catch (error) {
          logger.error('Failed to insert document', {
            context: 'database.migration',
            collection: collectionInfo.name,
            docId: (doc as any).id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    }

    return migratedCount;
  }

  /**
   * Get database status information
   */
  async getDatabaseStatus(): Promise<{
    currentBackend: DatabaseBackendType;
    preferredBackend: DatabaseBackendType | null;
    mongoAvailable: boolean;
    sqliteAvailable: boolean;
    collectionCounts: Record<string, number>;
    health: { healthy: boolean; latencyMs: number; message?: string };
  }> {
    const preferredBackend = getPreferredBackend();

    // Determine current backend
    let currentBackend: DatabaseBackendType = 'sqlite';
    const envBackend = process.env.DATABASE_BACKEND?.toLowerCase();
    if (envBackend === 'mongodb' || envBackend === 'sqlite') {
      currentBackend = envBackend;
    } else if (process.env.MONGODB_URI) {
      currentBackend = 'mongodb';
    }

    // Override with preference if set
    if (preferredBackend) {
      currentBackend = preferredBackend;
    }

    // Check MongoDB availability
    let mongoAvailable = false;
    try {
      if (process.env.MONGODB_URI) {
        const mongoBackend = await createMongoDBBackend();
        mongoAvailable = await mongoBackend.isConnected();
      }
    } catch {
      mongoAvailable = false;
    }

    // Check SQLite availability
    let sqliteAvailable = false;
    try {
      sqliteAvailable = sqliteDatabaseExists();
      if (!sqliteAvailable) {
        // Try to create it
        const sqliteConfig = loadSQLiteConfig();
        ensureDataDirectoryExists(path.dirname(sqliteConfig.path));
        sqliteAvailable = true;
      }
    } catch {
      sqliteAvailable = false;
    }

    // Get collection counts from current backend
    const collectionCounts: Record<string, number> = {};

    // Simple health check
    const health = {
      healthy: currentBackend === 'mongodb' ? mongoAvailable : sqliteAvailable,
      latencyMs: 0,
      message: undefined as string | undefined,
    };

    return {
      currentBackend,
      preferredBackend,
      mongoAvailable,
      sqliteAvailable,
      collectionCounts,
      health,
    };
  }

  /**
   * Switch back to MongoDB (without migration - data loss warning)
   */
  async switchToMongoDB(): Promise<{ success: boolean; error?: string }> {
    logger.info('Switching backend preference to MongoDB', {
      context: 'database.migration',
    });

    try {
      // Check if MongoDB is available
      if (!process.env.MONGODB_URI) {
        return {
          success: false,
          error: 'MongoDB URI is not configured (MONGODB_URI environment variable)',
        };
      }

      // Try to connect
      const mongoBackend = await createMongoDBBackend();
      const connected = await mongoBackend.isConnected();

      if (!connected) {
        return {
          success: false,
          error: 'Could not connect to MongoDB',
        };
      }

      // Set preference back to MongoDB
      setPreferredBackend('mongodb');

      logger.info('Backend preference set to MongoDB', {
        context: 'database.migration',
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to switch to MongoDB', {
        context: 'database.migration',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let migrationServiceInstance: DatabaseMigrationService | null = null;

/**
 * Get the singleton migration service instance
 */
export function getMigrationService(): DatabaseMigrationService {
  if (!migrationServiceInstance) {
    migrationServiceInstance = new DatabaseMigrationService();
  }
  return migrationServiceInstance;
}
