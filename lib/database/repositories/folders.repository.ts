/**
 * Folders Repository
 *
 * Backend-agnostic repository for Folder entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and specialized queries for folder hierarchy management.
 */

import { Folder, FolderInput, FolderSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, QueryOptions } from '../interfaces';

/**
 * Folders Repository
 * Implements CRUD operations for folders with user-scoping and hierarchy management.
 */
export class FoldersRepository extends UserOwnedBaseRepository<Folder> {
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
    return this._findById(id);
  }

  /**
   * Find all folders
   * @returns Promise<Folder[]> Array of all folders
   */
  async findAll(): Promise<Folder[]> {
    return this._findAll();
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
    return this.safeQuery(
      async () => {
        const folder = await this._create(data, options);

        logger.info('Folder created', {
          folderId: folder.id,
          userId: data.userId,
          path: data.path,
          projectId: data.projectId,
        });

        return folder;
      },
      'Error creating folder',
      { userId: data.userId, path: data.path }
    );
  }

  /**
   * Update a folder
   * @param id The folder ID
   * @param data Partial folder data to update
   * @returns Promise<Folder | null> The updated folder if found, null otherwise
   */
  async update(id: string, data: Partial<Folder>): Promise<Folder | null> {
    return this.safeQuery(
      async () => {
        const updated = await this._update(id, data);

        if (updated) {
          logger.info('Folder updated', { folderId: id });
        } else {
          logger.warn('Folder not found for update', { folderId: id });
        }

        return updated;
      },
      'Error updating folder',
      { folderId: id }
    );
  }

  /**
   * Delete a folder
   * @param id The folder ID
   * @returns Promise<boolean> True if folder was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Folder deleted', { folderId: id });
        } else {
          logger.warn('Folder not found for deletion', { folderId: id });
        }

        return result;
      },
      'Error deleting folder',
      { folderId: id }
    );
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
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          path,
          ...this.createNullableFilter('projectId', projectId),
        };

        const result = await this.findOneByFilter(query);

        if (!result) {
          return null;
        }

        return result;
      },
      'Error finding folder by path',
      { userId, path, projectId },
      null
    );
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
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          parentFolderId,
          ...this.createNullableFilter('projectId', projectId),
        };

        const options: QueryOptions = { sort: { name: 1 } };

        const results = await this.findByFilter(query, options);

        return results;
      },
      'Error finding folders by parent',
      { userId, parentFolderId, projectId },
      []
    );
  }

  /**
   * Find all folders for a user within a project or general files
   * @param userId The user ID
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of all folders in scope
   */
  async findAllInProject(userId: string, projectId: string | null): Promise<Folder[]> {
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          ...this.createNullableFilter('projectId', projectId),
        };

        const options: QueryOptions = { sort: { path: 1 } };

        const results = await this.findByFilter(query, options);

        return results;
      },
      'Error finding all folders in project',
      { userId, projectId },
      []
    );
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
    return this.safeQuery(
      async () => {
        // Use regex to find paths that start with parentPath but are not the parentPath itself
        const query: TypedQueryFilter<Folder> = {
          userId,
          path: {
            $regex: `^${this.escapeRegex(parentPath)}`,
            $ne: parentPath,
          },
          ...this.createNullableFilter('projectId', projectId),
        };

        const options: QueryOptions = { sort: { path: 1 } };

        const results = await this.findByFilter(query, options);

        return results;
      },
      'Error finding descendant folders',
      { userId, parentPath, projectId },
      []
    );
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

    return this.safeQuery(
      async () => {
        const createdFolders: Folder[] = [];

        for (const data of folders) {
          const folder = await this.create(data);
          createdFolders.push(folder);
        }

        logger.info('Folders created in bulk', { count: createdFolders.length });
        return createdFolders;
      },
      'Error creating folders in bulk',
      { count: folders.length }
    );
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
    return this.safeQuery(
      async () => {
        // Find all folders with paths starting with the old prefix
        const matchQuery: TypedQueryFilter<Folder> = {
          userId,
          path: { $regex: `^${this.escapeRegex(oldPathPrefix)}` },
          ...this.createNullableFilter('projectId', projectId),
        };

        // Get folders to update
        const foldersToUpdate = await this.findByFilter(matchQuery);

        let updatedCount = 0;
        for (const folder of foldersToUpdate) {
          const newPath = folder.path.replace(oldPathPrefix, newPathPrefix);
          await this.update(folder.id, { path: newPath });
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
      },
      'Error updating folder path prefixes',
      { userId, oldPathPrefix, newPathPrefix, projectId }
    );
  }

  /**
   * Check if a folder has any child folders
   * @param folderId The folder ID
   * @returns Promise<boolean> True if folder has children
   */
  async hasChildren(folderId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ parentFolderId: folderId });
        return count > 0;
      },
      'Error checking for child folders',
      { folderId },
      false
    );
  }
}
