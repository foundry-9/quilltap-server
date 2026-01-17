/**
 * Migration: Create Mount Points
 *
 * This migration sets up the mount points collection and creates an initial
 * default mount point based on the existing storage configuration:
 * - If S3 is configured: Creates an S3 mount point and sets it as default
 * - If no S3: Creates a Local storage mount point and sets it as default
 *
 * Also migrates existing file entries to use the new mountPointId and storageKey fields.
 *
 * Migration ID: create-mount-points-v1
 */

import type { Migration, MigrationResult } from '../migration-types';
import { logger } from '../lib/plugin-logger';
import { randomUUID } from 'crypto';
import { encryptSecrets } from '../lib/secrets';
import { getMongoDatabase } from '../lib/mongodb-utils';

/**
 * Check if MongoDB backend is enabled
 */
function isMongoDBBackendEnabled(): boolean {
  const backend = process.env.DATA_BACKEND || '';
  return backend === 'mongodb' || backend === 'dual';
}


/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
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
 * Check if the mount_points collection needs to be created or populated
 */
async function needsSetup(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const collection = db.collection('mount_points');

    // Check if there's already a default mount point
    const defaultMountPoint = await collection.findOne({ isDefault: true });
    return !defaultMountPoint;
  } catch (error) {
    logger.debug('Error checking mount_points collection', {
      context: 'migration.create-mount-points',
      error: error instanceof Error ? error.message : String(error),
    });
    // If collection doesn't exist, we need to run
    return true;
  }
}

/**
 * Check if there are files needing mountPointId migration
 */
async function hasFilesNeedingMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');

    // Check for files without mountPointId
    const count = await filesCollection.countDocuments({
      mountPointId: { $exists: false },
    });

    return count > 0;
  } catch (error) {
    logger.debug('Error checking files for mount point migration', {
      context: 'migration.create-mount-points',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Create Mount Points Migration
 */
export const createMountPointsMigration: Migration = {
  id: 'create-mount-points-v1',
  description: 'Create mount_points collection and migrate files to use mount point system',
  introducedInVersion: '2.7.0',
  dependsOn: ['migrate-json-to-mongodb-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackendEnabled()) {
      logger.debug('MongoDB not enabled, skipping mount points migration', {
        context: 'migration.create-mount-points',
      });
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      logger.debug('MongoDB not accessible, deferring mount points migration', {
        context: 'migration.create-mount-points',
      });
      return false;
    }

    // Check if there's work to do
    const [needsMountPointSetup, needsFileMigration] = await Promise.all([
      needsSetup(),
      hasFilesNeedingMigration(),
    ]);

    const needsRun = needsMountPointSetup || needsFileMigration;

    logger.debug('Checked for mount points migration need', {
      context: 'migration.create-mount-points',
      needsMountPointSetup,
      needsFileMigration,
      needsRun,
    });

    return needsRun;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let mountPointCreated = false;
    let filesUpdated = 0;
    let mountPointId: string | null = null;
    const errors: string[] = [];

    logger.info('Starting mount points migration', {
      context: 'migration.create-mount-points',
    });

    try {
      const db = await getMongoDatabase();
      const mountPointsCollection = db.collection('mount_points');
      const filesCollection = db.collection('files');

      // Step 1: Create indexes on mount_points collection
      logger.debug('Step 1: Creating indexes on mount_points collection', {
        context: 'migration.create-mount-points',
      });

      await mountPointsCollection.createIndex({ isDefault: 1 });
      await mountPointsCollection.createIndex({ scope: 1, userId: 1 });
      await mountPointsCollection.createIndex({ backendType: 1 });
      await mountPointsCollection.createIndex({ enabled: 1 });

      // Step 2: Check if we need to create a default mount point
      const existingDefault = await mountPointsCollection.findOne({ isDefault: true });

      if (!existingDefault) {
        logger.debug('Step 2: Creating default mount point', {
          context: 'migration.create-mount-points',
        });

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
          // Create local storage mount point
          const basePath = process.env.QUILLTAP_FILE_STORAGE_PATH || './data/files';

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
        logger.debug('Default mount point already exists', {
          context: 'migration.create-mount-points',
          mountPointId,
        });
      }

      // Step 3: Migrate files to use mountPointId and storageKey
      if (mountPointId) {
        logger.debug('Step 3: Migrating files to use mount point system', {
          context: 'migration.create-mount-points',
        });

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

        logger.debug('Files migration completed', {
          context: 'migration.create-mount-points',
          filesUpdated,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Mount points migration failed', {
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

    logger.info('Mount points migration completed', {
      context: 'migration.create-mount-points',
      success,
      mountPointCreated,
      filesUpdated,
      durationMs,
    });

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
  },
};
