/**
 * Files Repository
 *
 * Backend-agnostic repository for FileEntry entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { FileEntry, FileEntrySchema, FileCategory, FileSource } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Files Repository
 * Manages file metadata storage and retrieval with support for tagging, linking, and S3 references.
 */
export class FilesRepository extends TaggableBaseRepository<FileEntry> {
  constructor() {
    super('files', FileEntrySchema);
  }

  /**
   * Find file by ID
   */
  async findById(id: string): Promise<FileEntry | null> {
    return this._findById(id);
  }

  /**
   * Find all files
   */
  async findAll(): Promise<FileEntry[]> {
    return this._findAll();
  }

  /**
   * Find multiple files by their IDs in a single query
   * @param ids Array of file IDs
   * @returns Promise<FileEntry[]> Array of found files (may be shorter than input if some IDs don't exist)
   */
  async findByIds(ids: string[]): Promise<FileEntry[]> {
    if (ids.length === 0) {
      return [];
    }

    try {
      const files = await this.findByFilter({ id: { $in: ids } } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by IDs', {
        idCount: ids.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by SHA256 content hash (for deduplication)
   */
  async findBySha256(sha256: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ sha256 } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by SHA256', {
        sha256,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by category
   */
  async findByCategory(category: FileCategory): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ category } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by category', {
        category,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by source
   */
  async findBySource(source: FileSource): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ source } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by source', {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files linked to a specific entity
   */
  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ linkedTo: { $in: [entityId] } } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files linked to entity', {
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by user ID
   */
  async findByUserId(userId: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ userId } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create new file entry
   * @param data The file data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<FileEntry> {
    try {
      const file = await this._create(data, options);
      logger.info('File created', {
        fileId: file.id,
        userId: file.userId,
        filename: file.originalFilename,
      });
      return file;
    } catch (error) {
      logger.error('Error creating file', {
        userId: data.userId,
        filename: data.originalFilename,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update file entry
   */
  async update(id: string, data: Partial<FileEntry>): Promise<FileEntry | null> {
    try {
      // Remove id and createdAt to prevent accidental overwrites
      const { id: _id, createdAt: _createdAt, ...updateData } = data as any;

      const file = await this._update(id, updateData);

      if (file) {
        logger.info('File updated', { fileId: id });
      } else {
        logger.warn('File not found for update', { fileId: id });
      }

      return file;
    } catch (error) {
      logger.error('Error updating file', {
        fileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete file entry
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('File deleted', { fileId: id });
      } else {
        logger.warn('File not found for deletion', { fileId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting file', {
        fileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add entity to linkedTo array
   */
  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {
      const file = await this.findById(fileId);
      if (!file) {
        logger.warn('File not found for adding link', { fileId });
        return null;
      }

      if (!file.linkedTo.includes(entityId)) {
        file.linkedTo.push(entityId);
        return await this.update(fileId, { linkedTo: file.linkedTo });
      }
      return file;
    } catch (error) {
      logger.error('Error adding link to file', {
        fileId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove entity from linkedTo array
   */
  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {
      const file = await this.findById(fileId);
      if (!file) {
        logger.warn('File not found for removing link', { fileId });
        return null;
      }

      const beforeCount = file.linkedTo.length;
      file.linkedTo = file.linkedTo.filter((id) => id !== entityId);
      const afterCount = file.linkedTo.length;

      if (beforeCount !== afterCount) {
        return await this.update(fileId, { linkedTo: file.linkedTo });
      }
      return file;
    } catch (error) {
      logger.error('Error removing link from file', {
        fileId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update S3 storage reference
   */
  async updateS3Reference(fileId: string, s3Key: string, s3Bucket: string): Promise<FileEntry | null> {
    try {
      const result = await this.update(fileId, {
        s3Key,
        s3Bucket,
      });

      if (result) {
        logger.info('S3 reference updated for file', { fileId, s3Key, s3Bucket });
      } else {
        logger.warn('File not found for updating S3 reference', { fileId });
      }

      return result;
    } catch (error) {
      logger.error('Error updating S3 reference for file', {
        fileId,
        s3Key,
        s3Bucket,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // =========================================================================
  // FOLDER QUERY METHODS
  // =========================================================================

  /**
   * Find files in a specific folder (exact match)
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID (null for general files)
   * @param folderPath - The folder path to search in
   */
  async findByFolder(
    userId: string,
    projectId: string | null,
    folderPath: string
  ): Promise<FileEntry[]> {
    try {
      const query: Record<string, unknown> = {
        userId,
        folderPath,
      };

      if (projectId) {
        query.projectId = projectId;
      } else {
        // General files - either null or not set
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      }

      const files = await this.findByFilter(query as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files in folder', {
        context: 'files-repository',
        userId,
        projectId,
        folderPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files in a folder and all subfolders (recursive)
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID (null for general files)
   * @param folderPath - The folder path to search from (use "/" for all files)
   */
  async findInFolderRecursive(
    userId: string,
    projectId: string | null,
    folderPath: string
  ): Promise<FileEntry[]> {
    try {
      const query: Record<string, unknown> = {
        userId,
      };

      // Root folder matches everything
      if (folderPath !== '/') {
        // Use regex to match folder path prefix
        query.folderPath = { $regex: `^${this.escapeRegex(folderPath)}` };
      }

      if (projectId) {
        query.projectId = projectId;
      } else {
        // General files - either null or not set
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      }

      const files = await this.findByFilter(query as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files in folder (recursive)', {
        context: 'files-repository',
        userId,
        projectId,
        folderPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List unique folder paths for a user/project
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID (null for general files)
   */
  async listFolders(
    userId: string,
    projectId: string | null
  ): Promise<string[]> {
    try {
      const query: Record<string, unknown> = {
        userId,
      };

      if (projectId) {
        query.projectId = projectId;
      } else {
        query.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      }

      const files = await this.findByFilter(query as QueryFilter);

      // Extract unique folder paths and sort
      const folderSet = new Set<string>();
      files.forEach((file) => {
        if (file.folderPath) {
          folderSet.add(file.folderPath);
        }
      });

      const folders = Array.from(folderSet).sort();

      // Always include root if not present
      if (!folders.includes('/')) {
        folders.unshift('/');
      }
      return folders;
    } catch (error) {
      logger.error('Error listing folders', {
        context: 'files-repository',
        userId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by project ID
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID
   */
  async findByProjectId(userId: string, projectId: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ userId, projectId } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by project ID', {
        context: 'files-repository',
        userId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find files by original filename within a project
   * Used for duplicate detection when uploading files
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID
   * @param filename - The original filename to search for
   */
  async findByFilenameInProject(
    userId: string,
    projectId: string,
    filename: string
  ): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({
        userId,
        projectId,
        originalFilename: filename,
      } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by filename in project', {
        context: 'files-repository',
        userId,
        projectId,
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find file by storage key
   * Used for serving files via proxy route with proper authentication
   * @param storageKey - The storage key to search for
   */
  async findByStorageKey(storageKey: string): Promise<FileEntry | null> {
    try {
      const file = await this.findOneByFilter({ storageKey } as QueryFilter);

      if (file) {
      } else {
      }

      return file;
    } catch (error) {
      logger.error('Error finding file by storage key', {
        context: 'files-repository',
        storageKey,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all files stored in a specific mount point
   * @param mountPointId - The mount point ID
   * @returns Array of file entries stored in the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({ mountPointId } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding files by mount point', {
        context: 'files-repository',
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find general files (not in any project)
   * @param userId - The user ID for ownership verification
   */
  async findGeneralFiles(userId: string): Promise<FileEntry[]> {
    try {
      const files = await this.findByFilter({
        userId,
        $or: [{ projectId: null }, { projectId: { $exists: false } }],
      } as QueryFilter);
      return files;
    } catch (error) {
      logger.error('Error finding general files', {
        context: 'files-repository',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Helper to escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Export singleton instance
export const filesRepository = new FilesRepository();
