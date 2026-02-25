/**
 * Files Repository
 *
 * Backend-agnostic repository for FileEntry entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { FileEntry, FileEntrySchema, FileCategory, FileSource } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';

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

    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ id: { $in: ids } });
        return files;
      },
      'Error finding files by IDs',
      { idCount: ids.length }
    );
  }

  /**
   * Find files by SHA256 content hash (for deduplication)
   */
  async findBySha256(sha256: string): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ sha256 });
        return files;
      },
      'Error finding files by SHA256',
      { sha256 }
    );
  }

  /**
   * Find files by category
   */
  async findByCategory(category: FileCategory): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ category });
        return files;
      },
      'Error finding files by category',
      { category }
    );
  }

  /**
   * Find files by source
   */
  async findBySource(source: FileSource): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ source });
        return files;
      },
      'Error finding files by source',
      { source }
    );
  }

  /**
   * Find files linked to a specific entity
   */
  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ linkedTo: { $in: [entityId] } });
        return files;
      },
      'Error finding files linked to entity',
      { entityId }
    );
  }

  /**
   * Find files by user ID
   */
  async findByUserId(userId: string): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ userId });
        return files;
      },
      'Error finding files by user ID',
      { userId }
    );
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
    return this.safeQuery(
      async () => {
        const file = await this._create(data, options);
        logger.info('File created', {
          fileId: file.id,
          userId: file.userId,
          filename: file.originalFilename,
        });
        return file;
      },
      'Error creating file',
      { userId: data.userId, filename: data.originalFilename }
    );
  }

  /**
   * Update file entry
   */
  async update(id: string, data: Partial<FileEntry>): Promise<FileEntry | null> {
    return this.safeQuery(
      async () => {
        // Remove id and createdAt to prevent accidental overwrites
        const { id: _id, createdAt: _createdAt, ...updateData } = data as any;

        const file = await this._update(id, updateData);

        if (file) {
          logger.info('File updated', { fileId: id });
        } else {
          logger.warn('File not found for update', { fileId: id });
        }

        return file;
      },
      'Error updating file',
      { fileId: id }
    );
  }

  /**
   * Delete file entry
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('File deleted', { fileId: id });
        } else {
          logger.warn('File not found for deletion', { fileId: id });
        }

        return result;
      },
      'Error deleting file',
      { fileId: id }
    );
  }

  /**
   * Add entity to linkedTo array
   */
  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error adding link to file',
      { fileId, entityId }
    );
  }

  /**
   * Remove entity from linkedTo array
   */
  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error removing link from file',
      { fileId, entityId }
    );
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
    return this.safeQuery(
      async () => {
        const query: Record<string, unknown> = {
          userId,
          folderPath,
          ...this.createNullableFilter('projectId', projectId),
        };

        const files = await this.findByFilter(query as TypedQueryFilter<FileEntry>);
        return files;
      },
      'Error finding files in folder',
      { userId, projectId, folderPath }
    );
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
    return this.safeQuery(
      async () => {
        const query: Record<string, unknown> = {
          userId,
        };

        // Root folder matches everything
        if (folderPath !== '/') {
          // Use regex to match folder path prefix
          query.folderPath = { $regex: `^${this.escapeRegex(folderPath)}` };
        }

        Object.assign(query, this.createNullableFilter('projectId', projectId));

        const files = await this.findByFilter(query as TypedQueryFilter<FileEntry>);
        return files;
      },
      'Error finding files in folder (recursive)',
      { userId, projectId, folderPath }
    );
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
    return this.safeQuery(
      async () => {
        const query: Record<string, unknown> = {
          userId,
          ...this.createNullableFilter('projectId', projectId),
        };

        const files = await this.findByFilter(query as TypedQueryFilter<FileEntry>);

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
      },
      'Error listing folders',
      { userId, projectId }
    );
  }

  /**
   * Find files by project ID
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID
   */
  async findByProjectId(userId: string, projectId: string): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({ userId, projectId });
        return files;
      },
      'Error finding files by project ID',
      { userId, projectId }
    );
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
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({
          userId,
          projectId,
          originalFilename: filename,
        });
        return files;
      },
      'Error finding files by filename in project',
      { userId, projectId, filename }
    );
  }

  /**
   * Find files by exact filename within a scope (userId + projectId + folderPath)
   * Used for detecting duplicate filenames before creating/overwriting files
   * @param userId - The user ID for ownership verification
   * @param projectId - The project ID (null for general files)
   * @param folderPath - The folder path to search in
   * @param filename - The original filename to match
   */
  async findByFilenameInScope(
    userId: string,
    projectId: string | null,
    folderPath: string,
    filename: string
  ): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const query: Record<string, unknown> = {
          userId,
          originalFilename: filename,
          folderPath,
          ...this.createNullableFilter('projectId', projectId),
        };

        const files = await this.findByFilter(query as TypedQueryFilter<FileEntry>);
        return files;
      },
      'Error finding files by filename in scope',
      { userId, projectId, folderPath, filename }
    );
  }

  /**
   * Find file by storage key
   * Used for serving files via proxy route with proper authentication
   * @param storageKey - The storage key to search for
   */
  async findByStorageKey(storageKey: string): Promise<FileEntry | null> {
    return this.safeQuery(
      async () => {
        const file = await this.findOneByFilter({ storageKey });
        return file;
      },
      'Error finding file by storage key',
      { storageKey }
    );
  }

  /**
   * Find general files (not in any project)
   * @param userId - The user ID for ownership verification
   */
  async findGeneralFiles(userId: string): Promise<FileEntry[]> {
    return this.safeQuery(
      async () => {
        const files = await this.findByFilter({
          userId,
          $or: [{ projectId: null }, { projectId: { $exists: false } }],
        });
        return files;
      },
      'Error finding general files',
      { userId }
    );
  }

}

// Export singleton instance
export const filesRepository = new FilesRepository();
