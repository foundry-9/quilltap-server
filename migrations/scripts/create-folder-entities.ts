/**
 * Migration: Create Folder Entities
 *
 * This migration creates first-class folder entities from existing file paths:
 * - Scans all files to find unique folder paths
 * - Creates folder entities in the database for each unique path
 * - For local mount points, creates actual directories
 *
 * Migration ID: create-folder-entities-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { getMongoDatabase, isMongoDBBackend } from '../lib/mongodb-utils';
import { randomUUID } from 'crypto';

/**
 * Check if MongoDB is accessible
 */
async function isMongoDBAccessible(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    await db.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn('MongoDB is not accessible for folder entities migration', {
      context: 'migration.create-folder-entities',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if migration needs to run
 */
async function needsMigration(): Promise<boolean> {
  try {
    const db = await getMongoDatabase();
    const filesCollection = db.collection('files');
    const foldersCollection = db.collection('folders');

    // Check if there are any files with folderPath
    const filesWithFolders = await filesCollection.countDocuments({
      folderPath: { $exists: true, $ne: '/' },
    });

    // Check if folders collection has any documents
    const existingFolders = await foldersCollection.countDocuments({});

    // Need to run if there are files with folders but no folder entities yet
    return filesWithFolders > 0 && existingFolders === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Extract all folder paths from a path (including parent paths)
 */
function extractAllFolderPaths(folderPath: string): string[] {
  if (!folderPath || folderPath === '/') return [];

  const paths: string[] = [];
  const parts = folderPath.split('/').filter(Boolean);
  let current = '/';

  for (const part of parts) {
    current = current === '/' ? `/${part}/` : `${current}${part}/`;
    paths.push(current);
  }

  return paths;
}

/**
 * Get the parent path of a folder path
 */
function getParentPath(path: string): string {
  if (path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/') + '/';
}

/**
 * Get the folder name from a path
 */
function getFolderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

interface FolderToCreate {
  id: string;
  userId: string;
  path: string;
  name: string;
  parentFolderId: string | null;
  projectId: string | null;
  mountPointId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create Folder Entities Migration
 */
export const createFolderEntitiesMigration: Migration = {
  id: 'create-folder-entities-v1',
  description: 'Create first-class folder entities from existing file paths',
  introducedInVersion: '2.9.0',
  dependsOn: ['per-project-mount-points-v1'],

  async shouldRun(): Promise<boolean> {
    // Only run if MongoDB is enabled
    if (!isMongoDBBackend()) {
      return false;
    }

    // Check if MongoDB is accessible
    if (!(await isMongoDBAccessible())) {
      return false;
    }

    return needsMigration();
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let foldersCreated = 0;
    let usersProcessed = 0;
    const errors: string[] = [];

    logger.info('Starting folder entities migration', {
      context: 'migration.create-folder-entities',
    });

    try {
      const db = await getMongoDatabase();
      const filesCollection = db.collection('files');
      const foldersCollection = db.collection('folders');

      // Create indexes on folders collection
      await foldersCollection.createIndex(
        { userId: 1, path: 1, projectId: 1 },
        { unique: true, background: true }
      );
      await foldersCollection.createIndex(
        { userId: 1, parentFolderId: 1 },
        { background: true }
      );
      await foldersCollection.createIndex(
        { projectId: 1 },
        { sparse: true, background: true }
      );

      // Get all unique user IDs with files
      const userIds = await filesCollection.distinct('userId');
      for (const userId of userIds) {
        try {
          // Get all files for this user
          const files = await filesCollection
            .find({ userId })
            .project({ folderPath: 1, projectId: 1 })
            .toArray();

          // Group by projectId
          const projectFiles = new Map<string | null, Set<string>>();

          for (const file of files) {
            const projectId = file.projectId || null;
            const folderPath = file.folderPath || '/';

            if (!projectFiles.has(projectId)) {
              projectFiles.set(projectId, new Set());
            }

            // Add all folder paths (including parents)
            const paths = extractAllFolderPaths(folderPath);
            for (const path of paths) {
              projectFiles.get(projectId)!.add(path);
            }
          }

          // Create folder entities for each project
          for (const [projectId, folderPaths] of projectFiles) {
            // Sort by depth (shallow first) to create parents before children
            const sortedPaths = Array.from(folderPaths).sort(
              (a, b) => a.split('/').length - b.split('/').length
            );

            // Map to track folder IDs by path
            const folderIdMap = new Map<string, string>();

            for (const path of sortedPaths) {
              const parentPath = getParentPath(path);
              const parentFolderId = parentPath === '/' ? null : (folderIdMap.get(parentPath) || null);

              const folderId = randomUUID();
              const now = new Date();

              const folder: FolderToCreate = {
                id: folderId,
                userId: userId as string,
                path,
                name: getFolderName(path),
                parentFolderId,
                projectId,
                mountPointId: null,
                createdAt: now,
                updatedAt: now,
              };

              // Check if folder already exists (in case of partial migration)
              const existingFolder = await foldersCollection.findOne({
                userId,
                path,
                projectId,
              });

              if (!existingFolder) {
                await foldersCollection.insertOne(folder);
                folderIdMap.set(path, folderId);
                foldersCreated++;
              } else {
                folderIdMap.set(path, existingFolder.id);
              }
            }
          }

          usersProcessed++;
        } catch (userError) {
          const errorMessage = userError instanceof Error ? userError.message : String(userError);
          errors.push(`User ${userId}: ${errorMessage}`);
          logger.warn('Error processing user for folder entities', {
            context: 'migration.create-folder-entities',
            userId,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Folder entities migration failed', {
        context: 'migration.create-folder-entities',
        error: errorMessage,
      });

      return {
        id: 'create-folder-entities-v1',
        success: false,
        itemsAffected: foldersCreated,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Folder entities migration completed', {
      context: 'migration.create-folder-entities',
      success,
      foldersCreated,
      usersProcessed,
      errors: errors.length,
      durationMs,
    });

    return {
      id: 'create-folder-entities-v1',
      success,
      itemsAffected: foldersCreated,
      message: `Created ${foldersCreated} folder entities for ${usersProcessed} users${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
