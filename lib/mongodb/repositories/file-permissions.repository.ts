/**
 * MongoDB File Write Permissions Repository
 *
 * Repository for managing LLM file write permissions in MongoDB.
 * Handles CRUD operations for permission entries that control when
 * an LLM can write files without user approval.
 */

import { logger } from '@/lib/logger';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import {
  FileWritePermission,
  FileWritePermissionSchema,
  FileWritePermissionScope,
} from '@/lib/schemas/file-permissions.types';

/**
 * File Write Permissions Repository for MongoDB
 * Manages LLM file write permission storage and retrieval
 */
export class FilePermissionsRepository extends MongoBaseRepository<FileWritePermission> {
  constructor() {
    super('file_permissions', FileWritePermissionSchema);
  }

  /**
   * Find permission by ID
   */
  async findById(id: string): Promise<FileWritePermission | null> {
    try {
      const collection = await this.getCollection();
      const permission = await collection.findOne({ id });

      if (permission) {
        return this.validate(permission);
      }

      logger.debug('File write permission not found', {
        context: 'file-permissions-repository',
        permissionId: id,
      });
      return null;
    } catch (error) {
      logger.error('Error finding file write permission by ID', {
        context: 'file-permissions-repository',
        permissionId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all permissions
   */
  async findAll(): Promise<FileWritePermission[]> {
    try {
      const collection = await this.getCollection();
      const permissions = await collection.find({}).toArray();
      return permissions.map((p: unknown) => this.validate(p));
    } catch (error) {
      logger.error('Error finding all file write permissions', {
        context: 'file-permissions-repository',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new permission (implements abstract method)
   */
  async create(
    data: Omit<FileWritePermission, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<FileWritePermission> {
    return this.grantPermission(data, options);
  }

  /**
   * Update a permission
   */
  async update(
    id: string,
    data: Partial<Omit<FileWritePermission, 'id' | 'createdAt'>>
  ): Promise<FileWritePermission | null> {
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
        logger.info('File write permission updated', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
        return this.validate(result);
      }

      logger.warn('File write permission not found for update', {
        context: 'file-permissions-repository',
        permissionId: id,
      });
      return null;
    } catch (error) {
      logger.error('Error updating file write permission', {
        context: 'file-permissions-repository',
        permissionId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a permission (implements abstract method)
   */
  async delete(id: string): Promise<boolean> {
    return this.revokePermission(id);
  }

  /**
   * Find all permissions for a user
   */
  async findByUserId(userId: string): Promise<FileWritePermission[]> {
    try {
      const collection = await this.getCollection();
      const permissions = await collection.find({ userId }).toArray();
      return permissions.map((p: unknown) => this.validate(p));
    } catch (error) {
      logger.error('Error finding file write permissions by user ID', {
        context: 'file-permissions-repository',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find project-level permission for a user
   */
  async findByProjectId(userId: string, projectId: string): Promise<FileWritePermission | null> {
    try {
      const collection = await this.getCollection();
      const permission = await collection.findOne({
        userId,
        scope: 'PROJECT',
        projectId,
      });

      if (permission) {
        return this.validate(permission);
      }

      logger.debug('Project-level file write permission not found', {
        context: 'file-permissions-repository',
        userId,
        projectId,
      });
      return null;
    } catch (error) {
      logger.error('Error finding project file write permission', {
        context: 'file-permissions-repository',
        userId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if user has general (non-project) file write permission
   */
  async hasGeneralPermission(userId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const permission = await collection.findOne({
        userId,
        scope: 'GENERAL',
      });

      const hasPermission = permission !== null;
      logger.debug('Checked general file write permission', {
        context: 'file-permissions-repository',
        userId,
        hasPermission,
      });
      return hasPermission;
    } catch (error) {
      logger.error('Error checking general file write permission', {
        context: 'file-permissions-repository',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if user has single-file write permission
   */
  async hasFilePermission(userId: string, fileId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const permission = await collection.findOne({
        userId,
        scope: 'SINGLE_FILE',
        fileId,
      });

      const hasPermission = permission !== null;
      logger.debug('Checked single-file write permission', {
        context: 'file-permissions-repository',
        userId,
        fileId,
        hasPermission,
      });
      return hasPermission;
    } catch (error) {
      logger.error('Error checking single-file write permission', {
        context: 'file-permissions-repository',
        userId,
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if user can write a file (checks all permission levels)
   *
   * Permission hierarchy:
   * 1. SINGLE_FILE - specific file permission (only for existing files)
   * 2. PROJECT - permission for any file in a project
   * 3. GENERAL - permission for any non-project file
   *
   * @param userId - The user ID
   * @param projectId - The project ID (null for general files)
   * @param fileId - Optional specific file ID (for overwrites)
   * @returns True if the user has permission to write
   */
  async canWriteFile(
    userId: string,
    projectId: string | null,
    fileId?: string
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection();

      // Build query to check all applicable permission levels
      const conditions: Record<string, unknown>[] = [];

      // Check single-file permission (if fileId provided)
      if (fileId) {
        conditions.push({
          userId,
          scope: 'SINGLE_FILE',
          fileId,
        });
      }

      // Check project permission (if projectId provided)
      if (projectId) {
        conditions.push({
          userId,
          scope: 'PROJECT',
          projectId,
        });
      } else {
        // Check general permission (for non-project files)
        conditions.push({
          userId,
          scope: 'GENERAL',
        });
      }

      const permission = await collection.findOne({
        $or: conditions,
      });

      const canWrite = permission !== null;
      logger.debug('Checked file write permission', {
        context: 'file-permissions-repository',
        userId,
        projectId,
        fileId,
        canWrite,
        matchedScope: permission ? (permission as unknown as FileWritePermission).scope : null,
      });

      return canWrite;
    } catch (error) {
      logger.error('Error checking file write permission', {
        context: 'file-permissions-repository',
        userId,
        projectId,
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Grant a new file write permission
   */
  async grantPermission(
    data: Omit<FileWritePermission, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<FileWritePermission> {
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const newPermission: FileWritePermission = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(newPermission);
      const collection = await this.getCollection();

      await collection.insertOne(validated as any);

      logger.info('File write permission granted', {
        context: 'file-permissions-repository',
        permissionId: id,
        userId: data.userId,
        scope: data.scope,
        projectId: data.projectId,
        fileId: data.fileId,
      });

      return validated;
    } catch (error) {
      logger.error('Error granting file write permission', {
        context: 'file-permissions-repository',
        userId: data.userId,
        scope: data.scope,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Revoke a file write permission
   */
  async revokePermission(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount > 0) {
        logger.info('File write permission revoked', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
        return true;
      }

      logger.warn('File write permission not found for revocation', {
        context: 'file-permissions-repository',
        permissionId: id,
      });
      return false;
    } catch (error) {
      logger.error('Error revoking file write permission', {
        context: 'file-permissions-repository',
        permissionId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Revoke all permissions for a user
   */
  async revokeAllForUser(userId: string): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ userId });

      logger.info('All file write permissions revoked for user', {
        context: 'file-permissions-repository',
        userId,
        count: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      logger.error('Error revoking all file write permissions for user', {
        context: 'file-permissions-repository',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Revoke all permissions for a project
   */
  async revokeAllForProject(projectId: string): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        scope: 'PROJECT',
        projectId,
      });

      logger.info('All file write permissions revoked for project', {
        context: 'file-permissions-repository',
        projectId,
        count: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      logger.error('Error revoking all file write permissions for project', {
        context: 'file-permissions-repository',
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Revoke single-file permission when file is deleted
   */
  async revokeForFile(fileId: string): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        scope: 'SINGLE_FILE',
        fileId,
      });

      if (result.deletedCount > 0) {
        logger.info('File write permissions revoked for deleted file', {
          context: 'file-permissions-repository',
          fileId,
          count: result.deletedCount,
        });
      }

      return result.deletedCount;
    } catch (error) {
      logger.error('Error revoking file write permissions for file', {
        context: 'file-permissions-repository',
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Export singleton instance
export const filePermissionsRepository = new FilePermissionsRepository();
