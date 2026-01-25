/**
 * Migration: Create Mount Points
 *
 * This migration sets up mount points and creates an initial default mount point
 * based on the existing storage configuration:
 * - If S3 is configured: Creates an S3 mount point and sets it as default
 * - If no S3: Creates a Local storage mount point and sets it as default
 *
 * Also migrates existing file entries to use the new mountPointId and storageKey fields.
 *
 * Supports both MongoDB and SQLite backends.
 *
 * Migration ID: create-mount-points-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { randomUUID } from 'crypto';
import { encryptSecrets } from '../lib/secrets';
import { getMongoDatabase } from '../lib/mongodb-utils';
import {
  isMongoDBBackend,
  isSQLiteBackend,
  getSQLiteDatabase,
  executeSQLite,
  querySQLite,
  sqliteTableExists,
} from '../lib/database-utils';
import { getFilesDir } from '../../lib/paths';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  if (!isMongoDBBackend()) {
    return false;
  }

  try {
    const db = await getMongoDatabase();
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for mount points migration', {
      context: 'migration.create-mount-points',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if SQLite is accessible
 */
function isSQLiteAccessible(): boolean {
  if (!isSQLiteBackend()) {
    return false;
  }

  try {
    const db = getSQLiteDatabase();
    db.prepare('SELECT 1').get();
    return true;
  } catch (error) {
    logger.warn('SQLite is not accessible for mount points migration', {
      context: 'migration.create-mount-points',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if S3 is configured via environment variables
 */
function isS3Configured(): boolean {
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  // S3 is considered configured if bucket and credentials are provided
  // The bucket must not be the default placeholder
  const hasCredentials = !!accessKey && !!secretKey;
  const hasBucket = !!bucket && bucket !== 'quilltap-files';

  return hasCredentials && hasBucket;
}

/**
 * Check if the mount_points collection/table needs to be created or populated (MongoDB)
 */
async function needsSetupMongoDB(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const collection = db.collection('mount_points');

    // Check if there's already a default mount point
    const defaultMountPoint = await collection.findOne({ isDefault: true });
    return !defaultMountPoint;
  } catch (error) {
    // If collection doesn't exist, we need to run
    return true;
  }
}

/**
 * Check if the mount_points table needs to be created or populated (SQLite)
 */
function needsSetupSQLite(): boolean {
  try {
    // Check if the table exists
    if (!sqliteTableExists('mount_points')) {
      return true;
    }

    // Check if there's already a default mount point
    const result = querySQLite<{ id: string }>(
      'SELECT id FROM mount_points WHERE isDefault = 1 LIMIT 1'
    );
    return result.length === 0;
  } catch (error) {
    // If table doesn't exist or query fails, we need to run
    return true;
  }
}

/**
 * Check if there are files needing mountPointId migration (MongoDB)
 */
async function hasFilesNeedingMigrationMongoDB(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');

    // Check for files without mountPointId
    const count = await filesCollection.countDocuments({
      mountPointId: { $exists: false },
    });

    return count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check if there are files needing mountPointId migration (SQLite)
 */
function hasFilesNeedingMigrationSQLite(): boolean {
  try {
    if (!sqliteTableExists('files')) {
      return false;
    }

    const result = querySQLite<{ count: number }>(
      'SELECT COUNT(*) as count FROM files WHERE mountPointId IS NULL'
    );
    return result[0]?.count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Run migration for MongoDB backend
 */
async function runMongoDBMigration(): Promise<MigrationResult> {
  const startTime = Date.now();
  let mountPointCreated = false;
  let filesUpdated = 0;
  let mountPointId: string | null = null;
  const errors: string[] = [];

  try {
    const db = await getMongoDatabase();
    const mountPointsCollection = db.collection('mount_points');
    const filesCollection = db.collection('files');

    // Step 1: Create indexes on mount_points collection
    await mountPointsCollection.createIndex({ isDefault: 1 });
    await mountPointsCollection.createIndex({ scope: 1, userId: 1 });
    await mountPointsCollection.createIndex({ backendType: 1 });
    await mountPointsCollection.createIndex({ enabled: 1 });

    // Step 2: Check if we need to create a default mount point
    const existingDefault = await mountPointsCollection.findOne({ isDefault: true });

    if (!existingDefault) {
      const now = new Date().toISOString();
      mountPointId = randomUUID();

      if (isS3Configured()) {
        // Create S3 mount point
        const s3Bucket = process.env.S3_BUCKET || 'quilltap-files';
        const s3Region = process.env.S3_REGION || 'us-east-1';
        const s3Endpoint = process.env.S3_ENDPOINT;
        const s3PathPrefix = process.env.S3_PATH_PREFIX || '';
        const s3PublicUrl = process.env.S3_PUBLIC_URL;
        const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

        // Get credentials for encryption
        const s3AccessKey = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
        const s3SecretKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';

        // Encrypt secrets
        let encryptedSecrets: string | null = null;
        try {
          encryptedSecrets = encryptSecrets({
            accessKey: s3AccessKey,
            secretKey: s3SecretKey,
          });
        } catch (encryptError) {
          logger.warn('Failed to encrypt S3 secrets, storing without encryption', {
            context: 'migration.create-mount-points',
            error: encryptError instanceof Error ? encryptError.message : String(encryptError),
          });
        }

        const s3MountPoint = {
          id: mountPointId,
          name: 'S3 Storage (Migrated)',
          description: 'S3 storage migrated from environment configuration',
          backendType: 's3',
          backendConfig: {
            bucket: s3Bucket,
            region: s3Region,
            endpoint: s3Endpoint || undefined,
            pathPrefix: s3PathPrefix || undefined,
            publicUrl: s3PublicUrl || undefined,
            forcePathStyle: s3ForcePathStyle,
          },
          encryptedSecrets,
          scope: 'system',
          userId: null,
          isDefault: true,
          enabled: true,
          healthStatus: 'unknown',
          createdAt: now,
          updatedAt: now,
        };

        await mountPointsCollection.insertOne(s3MountPoint);
        mountPointCreated = true;

        logger.info('Created S3 mount point', {
          context: 'migration.create-mount-points',
          mountPointId,
          bucket: s3Bucket,
          region: s3Region,
        });
      } else {
        // Create local storage mount point using centralized path
        const basePath = getFilesDir();

        const localMountPoint = {
          id: mountPointId,
          name: 'Local Storage',
          description: 'Local filesystem storage',
          backendType: 'local',
          backendConfig: {
            basePath,
          },
          encryptedSecrets: null,
          scope: 'system',
          userId: null,
          isDefault: true,
          enabled: true,
          healthStatus: 'unknown',
          createdAt: now,
          updatedAt: now,
        };

        await mountPointsCollection.insertOne(localMountPoint);
        mountPointCreated = true;

        logger.info('Created local storage mount point', {
          context: 'migration.create-mount-points',
          mountPointId,
          basePath,
        });
      }
    } else {
      mountPointId = existingDefault.id;
    }

    // Step 3: Migrate files to use mountPointId and storageKey
    if (mountPointId) {
      // Find files without mountPointId
      const filesCursor = filesCollection.find({
        mountPointId: { $exists: false },
      });

      while (await filesCursor.hasNext()) {
        const file = await filesCursor.next();
        if (!file) continue;

        try {
          const updates: Record<string, unknown> = {
            mountPointId,
          };

          // Set storageKey from s3Key if available, otherwise leave undefined
          if (file.s3Key && !file.storageKey) {
            updates.storageKey = file.s3Key;
          }

          await filesCollection.updateOne(
            { _id: file._id },
            { $set: updates }
          );

          filesUpdated++;
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error('Error migrating file to mount point', {
            context: 'migration.create-mount-points',
            fileId: file.id,
            error: errorMessage,
          });
          errors.push(`File ${file.id}: ${errorMessage}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Mount points migration failed (MongoDB)', {
      context: 'migration.create-mount-points',
      error: errorMessage,
    });

    return {
      id: 'create-mount-points-v1',
      success: false,
      itemsAffected: filesUpdated,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  const success = errors.length === 0;
  const durationMs = Date.now() - startTime;

  return {
    id: 'create-mount-points-v1',
    success,
    itemsAffected: filesUpdated + (mountPointCreated ? 1 : 0),
    message: success
      ? `Created mount point: ${mountPointCreated}, Updated ${filesUpdated} files`
      : `Updated ${filesUpdated} files with ${errors.length} errors`,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run migration for SQLite backend
 */
function runSQLiteMigration(): MigrationResult {
  const startTime = Date.now();
  let mountPointCreated = false;
  let filesUpdated = 0;
  let mountPointId: string | null = null;
  const errors: string[] = [];

  try {
    const db = getSQLiteDatabase();

    // Step 1: Create mount_points table if it doesn't exist
    if (!sqliteTableExists('mount_points')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mount_points (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          backendType TEXT NOT NULL,
          backendConfig TEXT NOT NULL,
          encryptedSecrets TEXT,
          scope TEXT NOT NULL DEFAULT 'system',
          userId TEXT,
          isDefault INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          healthStatus TEXT DEFAULT 'unknown',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY (userId) REFERENCES users(id)
        )
      `);

      // Create indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_mount_points_is_default ON mount_points(isDefault)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_mount_points_scope_user ON mount_points(scope, userId)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_mount_points_backend_type ON mount_points(backendType)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_mount_points_enabled ON mount_points(enabled)');

      logger.info('Created mount_points table', {
        context: 'migration.create-mount-points',
      });
    }

    // Step 2: Check if we need to create a default mount point
    const existingDefault = db.prepare('SELECT id FROM mount_points WHERE isDefault = 1 LIMIT 1').get() as { id: string } | undefined;

    if (!existingDefault) {
      const now = new Date().toISOString();
      mountPointId = randomUUID();

      if (isS3Configured()) {
        // Create S3 mount point
        const s3Bucket = process.env.S3_BUCKET || 'quilltap-files';
        const s3Region = process.env.S3_REGION || 'us-east-1';
        const s3Endpoint = process.env.S3_ENDPOINT;
        const s3PathPrefix = process.env.S3_PATH_PREFIX || '';
        const s3PublicUrl = process.env.S3_PUBLIC_URL;
        const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

        // Get credentials for encryption
        const s3AccessKey = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
        const s3SecretKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';

        // Encrypt secrets
        let encryptedSecrets: string | null = null;
        try {
          encryptedSecrets = encryptSecrets({
            accessKey: s3AccessKey,
            secretKey: s3SecretKey,
          });
        } catch (encryptError) {
          logger.warn('Failed to encrypt S3 secrets, storing without encryption', {
            context: 'migration.create-mount-points',
            error: encryptError instanceof Error ? encryptError.message : String(encryptError),
          });
        }

        const backendConfig = JSON.stringify({
          bucket: s3Bucket,
          region: s3Region,
          endpoint: s3Endpoint || undefined,
          pathPrefix: s3PathPrefix || undefined,
          publicUrl: s3PublicUrl || undefined,
          forcePathStyle: s3ForcePathStyle,
        });

        db.prepare(`
          INSERT INTO mount_points (id, name, description, backendType, backendConfig, encryptedSecrets, scope, userId, isDefault, enabled, healthStatus, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mountPointId,
          'S3 Storage (Migrated)',
          'S3 storage migrated from environment configuration',
          's3',
          backendConfig,
          encryptedSecrets,
          'system',
          null,
          1,
          1,
          'unknown',
          now,
          now
        );

        mountPointCreated = true;

        logger.info('Created S3 mount point', {
          context: 'migration.create-mount-points',
          mountPointId,
          bucket: s3Bucket,
          region: s3Region,
        });
      } else {
        // Create local storage mount point using centralized path
        const basePath = getFilesDir();

        const backendConfig = JSON.stringify({
          basePath,
        });

        db.prepare(`
          INSERT INTO mount_points (id, name, description, backendType, backendConfig, encryptedSecrets, scope, userId, isDefault, enabled, healthStatus, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mountPointId,
          'Local Storage',
          'Local filesystem storage',
          'local',
          backendConfig,
          null,
          'system',
          null,
          1,
          1,
          'unknown',
          new Date().toISOString(),
          new Date().toISOString()
        );

        mountPointCreated = true;

        logger.info('Created local storage mount point', {
          context: 'migration.create-mount-points',
          mountPointId,
          basePath,
        });
      }
    } else {
      mountPointId = existingDefault.id;
    }

    // Step 3: Migrate files to use mountPointId (if files table exists)
    if (mountPointId && sqliteTableExists('files')) {
      const filesToUpdate = db.prepare(
        'SELECT id, s3Key, storageKey FROM files WHERE mountPointId IS NULL'
      ).all() as Array<{ id: string; s3Key?: string; storageKey?: string }>;

      const updateStmt = db.prepare(
        'UPDATE files SET mountPointId = ?, storageKey = COALESCE(?, storageKey) WHERE id = ?'
      );

      for (const file of filesToUpdate) {
        try {
          // Use s3Key as storageKey if storageKey is not set
          const storageKey = file.storageKey || file.s3Key || null;
          updateStmt.run(mountPointId, storageKey, file.id);
          filesUpdated++;
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error('Error migrating file to mount point', {
            context: 'migration.create-mount-points',
            fileId: file.id,
            error: errorMessage,
          });
          errors.push(`File ${file.id}: ${errorMessage}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Mount points migration failed (SQLite)', {
      context: 'migration.create-mount-points',
      error: errorMessage,
    });

    return {
      id: 'create-mount-points-v1',
      success: false,
      itemsAffected: filesUpdated,
      message: `Migration failed: ${errorMessage}`,
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  const success = errors.length === 0;
  const durationMs = Date.now() - startTime;

  return {
    id: 'create-mount-points-v1',
    success,
    itemsAffected: filesUpdated + (mountPointCreated ? 1 : 0),
    message: success
      ? `Created mount point: ${mountPointCreated}, Updated ${filesUpdated} files`
      : `Updated ${filesUpdated} files with ${errors.length} errors`,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create Mount Points Migration
 */
export const createMountPointsMigration: Migration = {
  id: 'create-mount-points-v1',
  description: 'Create mount_points table/collection and migrate files to use mount point system',
  introducedInVersion: '2.7.0',
  dependsOn: ['migrate-json-to-mongodb-v1', 'sqlite-initial-schema-v1'],

  async shouldRun(): Promise<boolean> {
    // Check if we're using MongoDB
    if (isMongoDBBackend()) {
      if (!(await isMongoDBAccessible())) {
        return false;
      }

      const [needsMountPointSetup, needsFileMigration] = await Promise.all([
        needsSetupMongoDB(),
        hasFilesNeedingMigrationMongoDB(),
      ]);

      return needsMountPointSetup || needsFileMigration;
    }

    // Check if we're using SQLite
    if (isSQLiteBackend()) {
      if (!isSQLiteAccessible()) {
        return false;
      }

      const needsMountPointSetup = needsSetupSQLite();
      const needsFileMigration = hasFilesNeedingMigrationSQLite();

      return needsMountPointSetup || needsFileMigration;
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    logger.info('Starting mount points migration', {
      context: 'migration.create-mount-points',
      backend: isMongoDBBackend() ? 'mongodb' : 'sqlite',
    });

    if (isMongoDBBackend()) {
      return runMongoDBMigration();
    }

    return runSQLiteMigration();
  },
};
