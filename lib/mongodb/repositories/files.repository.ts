/**
 * MongoDB Files Repository
 *
 * Repository for managing file entries in MongoDB.
 * Handles CRUD operations on file metadata including linking, tagging, and S3 references.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { FileEntry, FileEntrySchema, FileCategory, FileSource } from '@/lib/schemas/types';

/**
 * Files Repository for MongoDB
 * Manages file metadata storage and retrieval
 */
export class FilesRepository extends MongoBaseRepository<FileEntry> {
  constructor() {
    super('files', FileEntrySchema);
  }

  /**
   * Find file by ID
   */
  async findById(id: string): Promise<FileEntry | null> {
    try {
      const collection = await this.getCollection();
      const file = await collection.findOne({ id });

      if (file) {
        return this.validate(file);
      }

      logger.debug('File not found', { fileId: id });
      return null;
    } catch (error) {
      logger.error('Error finding file by ID', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find all files
   */
  async findAll(): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({}).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding all files', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
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
      const collection = await this.getCollection();
      const files = await collection.find({ id: { $in: ids } }).toArray();

      const validatedFiles = files.map((file: unknown) => this.validate(file));
      logger.debug('Found files by IDs', { requestedCount: ids.length, foundCount: validatedFiles.length });
      return validatedFiles;
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
      const collection = await this.getCollection();
      const files = await collection.find({ sha256 }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by SHA256', { sha256, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files by category
   */
  async findByCategory(category: FileCategory): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({ category }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by category', { category, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files by source
   */
  async findBySource(source: FileSource): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({ source }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by source', { source, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files linked to a specific entity
   */
  async findByLinkedTo(entityId: string): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({ linkedTo: entityId }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files linked to entity', { entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files with a specific tag
   */
  async findByTag(tagId: string): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({ tags: tagId }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by tag', { tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Find files for a user
   */
  async findByUserId(userId: string): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({ userId }).toArray();
      return files.map((file: unknown) => this.validate(file));
    } catch (error) {
      logger.error('Error finding files by user ID', { userId, error: error instanceof Error ? error.message : String(error) });
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

      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const newFile: FileEntry = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(newFile);
      const collection = await this.getCollection();

      await collection.insertOne(validated as any);

      logger.info('File created', { fileId: id, userId: data.userId, filename: data.originalFilename });
      return validated;
    } catch (error) {
      logger.error('Error creating file', {
        userId: data.userId,
        filename: data.originalFilename,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update file entry
   */
  async update(id: string, data: Partial<Omit<FileEntry, 'id' | 'createdAt'>>): Promise<FileEntry | null> {
    try {

      const now = this.getCurrentTimestamp();
      const updateData = {
        $set: {
          ...data,
          updatedAt: now,
        },
      };

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id },
        updateData,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('File updated', { fileId: id });
        return this.validate(result);
      }

      logger.warn('File not found for update', { fileId: id });
      return null;
    } catch (error) {
      logger.error('Error updating file', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Delete file entry
   */
  async delete(id: string): Promise<boolean> {
    try {

      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount > 0) {
        logger.info('File deleted', { fileId: id });
        return true;
      }

      logger.warn('File not found for deletion', { fileId: id });
      return false;
    } catch (error) {
      logger.error('Error deleting file', { fileId: id, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Add entity to linkedTo array
   */
  async addLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $addToSet: { linkedTo: entityId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Link added to file', { fileId, entityId });
        return this.validate(result);
      }

      logger.warn('File not found for adding link', { fileId });
      return null;
    } catch (error) {
      logger.error('Error adding link to file', { fileId, entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Remove entity from linkedTo array
   */
  async removeLink(fileId: string, entityId: string): Promise<FileEntry | null> {
    try {

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $pull: { linkedTo: entityId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        } as any,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Link removed from file', { fileId, entityId });
        return this.validate(result);
      }

      logger.warn('File not found for removing link', { fileId });
      return null;
    } catch (error) {
      logger.error('Error removing link from file', { fileId, entityId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Add tag to file
   */
  async addTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    try {

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $addToSet: { tags: tagId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Tag added to file', { fileId, tagId });
        return this.validate(result);
      }

      logger.warn('File not found for adding tag', { fileId });
      return null;
    } catch (error) {
      logger.error('Error adding tag to file', { fileId, tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Remove tag from file
   */
  async removeTag(fileId: string, tagId: string): Promise<FileEntry | null> {
    try {

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $pull: { tags: tagId },
          $set: { updatedAt: this.getCurrentTimestamp() },
        } as any,
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('Tag removed from file', { fileId, tagId });
        return this.validate(result);
      }

      logger.warn('File not found for removing tag', { fileId });
      return null;
    } catch (error) {
      logger.error('Error removing tag from file', { fileId, tagId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Update S3 storage reference
   */
  async updateS3Reference(fileId: string, s3Key: string, s3Bucket: string): Promise<FileEntry | null> {
    try {

      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { id: fileId },
        {
          $set: {
            s3Key,
            s3Bucket,
            updatedAt: this.getCurrentTimestamp(),
          },
        },
        { returnDocument: 'after' }
      );

      if (result) {
        logger.info('S3 reference updated for file', { fileId, s3Key, s3Bucket });
        return this.validate(result);
      }

      logger.warn('File not found for updating S3 reference', { fileId });
      return null;
    } catch (error) {
      logger.error('Error updating S3 reference for file', { fileId, s3Key, s3Bucket, error: error instanceof Error ? error.message : String(error) });
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
      const collection = await this.getCollection();

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

      const files = await collection.find(query).toArray();

      logger.debug('Found files in folder', {
        context: 'files-repository',
        userId,
        projectId,
        folderPath,
        count: files.length,
      });

      return files.map((file: unknown) => this.validate(file));
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
      const collection = await this.getCollection();

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

      const files = await collection.find(query).toArray();

      logger.debug('Found files in folder (recursive)', {
        context: 'files-repository',
        userId,
        projectId,
        folderPath,
        count: files.length,
      });

      return files.map((file: unknown) => this.validate(file));
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
      const collection = await this.getCollection();

      const matchStage: Record<string, unknown> = {
        userId,
      };

      if (projectId) {
        matchStage.projectId = projectId;
      } else {
        matchStage.$or = [{ projectId: null }, { projectId: { $exists: false } }];
      }

      const result = await collection.aggregate([
        { $match: matchStage },
        { $group: { _id: '$folderPath' } },
        { $sort: { _id: 1 } },
      ]).toArray();

      const folders = result.map(r => r._id as string).filter(Boolean);

      // Always include root if not present
      if (!folders.includes('/')) {
        folders.unshift('/');
      }

      logger.debug('Listed folders', {
        context: 'files-repository',
        userId,
        projectId,
        count: folders.length,
      });

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
      const collection = await this.getCollection();
      const files = await collection.find({ userId, projectId }).toArray();

      logger.debug('Found files by project ID', {
        context: 'files-repository',
        userId,
        projectId,
        count: files.length,
      });

      return files.map((file: unknown) => this.validate(file));
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
      const collection = await this.getCollection();
      const files = await collection.find({
        userId,
        projectId,
        originalFilename: filename,
      }).toArray();

      logger.debug('Found files by filename in project', {
        context: 'files-repository',
        userId,
        projectId,
        filename,
        count: files.length,
      });

      return files.map((file: unknown) => this.validate(file));
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
   * Find general files (not in any project)
   * @param userId - The user ID for ownership verification
   */
  async findGeneralFiles(userId: string): Promise<FileEntry[]> {
    try {
      const collection = await this.getCollection();
      const files = await collection.find({
        userId,
        $or: [{ projectId: null }, { projectId: { $exists: false } }],
      }).toArray();

      logger.debug('Found general files', {
        context: 'files-repository',
        userId,
        count: files.length,
      });

      return files.map((file: unknown) => this.validate(file));
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
