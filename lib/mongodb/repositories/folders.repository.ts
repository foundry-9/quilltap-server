/**
 * MongoDB Folders Repository
 *
 * Handles CRUD operations and queries for Folder entities.
 * Each folder is stored as a document in the 'folders' MongoDB collection.
 * Folders are first-class entities enabling empty folder persistence and
 * consistent behavior across local and S3 storage backends.
 */

import { Folder, FolderSchema, FolderInput } from '@/lib/schemas/folder.types';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';

export class FoldersRepository extends MongoBaseRepository<Folder> {
  constructor() {
    super('folders', FolderSchema);
  }

  // ============================================================================
  // CORE CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a folder by ID
   * @param id The folder ID
   * @returns Promise<Folder | null> The folder if found, null otherwise
   */
  async findById(id: string): Promise<Folder | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding folder by ID', {
        folderId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all folders
   * @returns Promise<Folder[]> Array of all folders
   */
  async findAll(): Promise<Folder[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((folder): folder is Folder => folder !== null);
    } catch (error) {
      logger.error('Error finding all folders', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new folder
   * @param data The folder data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Folder> The created folder with generated id and timestamps
   */
  async create(
    data: Omit<FolderInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Folder> {
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const folderInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(folderInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Folder created', {
        folderId: id,
        userId: data.userId,
        path: data.path,
        projectId: data.projectId,
      });
      return validated;
    } catch (error) {
      logger.error('Error creating folder', {
        userId: data.userId,
        path: data.path,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a folder
   * @param id The folder ID
   * @param data Partial folder data to update
   * @returns Promise<Folder | null> The updated folder if found, null otherwise
   */
  async update(id: string, data: Partial<Folder>): Promise<Folder | null> {
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Folder not found for update', { folderId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: Folder = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne({ id }, { $set: validated as any });

      return validated;
    } catch (error) {
      logger.error('Error updating folder', {
        folderId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a folder
   * @param id The folder ID
   * @returns Promise<boolean> True if folder was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Folder not found for deletion', { folderId: id });
        return false;
      }

      logger.info('Folder deleted', { folderId: id });
      return true;
    } catch (error) {
      logger.error('Error deleting folder', {
        folderId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // SPECIALIZED QUERIES
  // ============================================================================

  /**
   * Find a folder by its path within a user's scope
   * @param userId The user ID
   * @param path The folder path (normalized, e.g., "/documents/reports/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder | null> The folder if found, null otherwise
   */
  async findByPath(
    userId: string,
    path: string,
    projectId: string | null
  ): Promise<Folder | null> {
    try {
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { userId, path };

      if (projectId === null) {
        // For general files, projectId should be null or not exist
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      } else {
        query.projectId = projectId;
      }

      const result = await collection.findOne(query);

      if (!result) {
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding folder by path', {
        userId,
        path,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find direct child folders of a parent folder
   * @param userId The user ID
   * @param parentFolderId The parent folder ID (null for root level)
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of child folders
   */
  async findByParent(
    userId: string,
    parentFolderId: string | null,
    projectId: string | null
  ): Promise<Folder[]> {
    try {
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { userId, parentFolderId };

      if (projectId === null) {
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      } else {
        query.projectId = projectId;
      }

      const results = await collection.find(query).sort({ name: 1 }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((folder): folder is Folder => folder !== null);
    } catch (error) {
      logger.error('Error finding folders by parent', {
        userId,
        parentFolderId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all folders for a user within a project or general files
   * @param userId The user ID
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of all folders in scope
   */
  async findAllInProject(userId: string, projectId: string | null): Promise<Folder[]> {
    try {
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { userId };

      if (projectId === null) {
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      } else {
        query.projectId = projectId;
      }

      const results = await collection.find(query).sort({ path: 1 }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((folder): folder is Folder => folder !== null);
    } catch (error) {
      logger.error('Error finding all folders in project', {
        userId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all descendant folders under a given path
   * @param userId The user ID
   * @param parentPath The parent path (e.g., "/documents/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of descendant folders
   */
  async findDescendants(
    userId: string,
    parentPath: string,
    projectId: string | null
  ): Promise<Folder[]> {
    try {
      const collection = await this.getCollection();

      // Use regex to find paths that start with parentPath but are not the parentPath itself
      const query: Record<string, unknown> = {
        userId,
        path: { $regex: `^${parentPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $ne: parentPath },
      };

      if (projectId === null) {
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      } else {
        query.projectId = projectId;
      }

      const results = await collection.find(query).sort({ path: 1 }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((folder): folder is Folder => folder !== null);
    } catch (error) {
      logger.error('Error finding descendant folders', {
        userId,
        parentPath,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find folders by user ID
   * @param userId The user ID
   * @returns Promise<Folder[]> Array of folders belonging to the user
   */
  async findByUserId(userId: string): Promise<Folder[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({ userId }).sort({ path: 1 }).toArray();

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((folder): folder is Folder => folder !== null);
    } catch (error) {
      logger.error('Error finding folders by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Create multiple folders at once (for migration)
   * @param folders Array of folder data
   * @returns Promise<Folder[]> Array of created folders
   */
  async createMany(
    folders: Array<Omit<FolderInput, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Folder[]> {
    if (folders.length === 0) {
      return [];
    }

    try {
      const now = this.getCurrentTimestamp();
      const collection = await this.getCollection();

      const folderDocs = folders.map((data) => {
        const folderInput = {
          ...data,
          id: this.generateId(),
          createdAt: now,
          updatedAt: now,
        };
        return this.validate(folderInput);
      });

      await collection.insertMany(folderDocs as any[]);

      logger.info('Folders created in bulk', { count: folderDocs.length });
      return folderDocs;
    } catch (error) {
      logger.error('Error creating folders in bulk', {
        count: folders.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update paths for all folders under a renamed parent
   * Used when renaming a folder to update all descendants
   * @param userId The user ID
   * @param oldPathPrefix The old path prefix (e.g., "/old-name/")
   * @param newPathPrefix The new path prefix (e.g., "/new-name/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<number> Number of folders updated
   */
  async updatePathPrefix(
    userId: string,
    oldPathPrefix: string,
    newPathPrefix: string,
    projectId: string | null
  ): Promise<number> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      // Find all folders with paths starting with the old prefix
      const matchQuery: Record<string, unknown> = {
        userId,
        path: { $regex: `^${oldPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
      };

      if (projectId === null) {
        matchQuery.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      } else {
        matchQuery.projectId = projectId;
      }

      // Get folders to update
      const foldersToUpdate = await collection.find(matchQuery).toArray();

      let updatedCount = 0;
      for (const folder of foldersToUpdate) {
        const newPath = folder.path.replace(oldPathPrefix, newPathPrefix);
        await collection.updateOne(
          { id: folder.id },
          { $set: { path: newPath, updatedAt: now } }
        );
        updatedCount++;
      }

      logger.info('Updated folder path prefixes', {
        userId,
        oldPathPrefix,
        newPathPrefix,
        projectId,
        updatedCount,
      });

      return updatedCount;
    } catch (error) {
      logger.error('Error updating folder path prefixes', {
        userId,
        oldPathPrefix,
        newPathPrefix,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if a folder has any child folders
   * @param folderId The folder ID
   * @returns Promise<boolean> True if folder has children
   */
  async hasChildren(folderId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const count = await collection.countDocuments({ parentFolderId: folderId });
      return count > 0;
    } catch (error) {
      logger.error('Error checking for child folders', {
        folderId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
