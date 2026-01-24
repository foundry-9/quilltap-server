/**
 * Database-agnostic File Write Permissions Repository
 *
 * Repository for managing LLM file write permissions.
 * Handles CRUD operations for permission entries that control when
 * an LLM can write files without user approval.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import {
  FileWritePermission,
  FileWritePermissionSchema,
  FileWritePermissionScope,
} from '@/lib/schemas/file-permissions.types';
import { QueryFilter } from '../interfaces';

/**
 * File Write Permissions Repository
 * Manages LLM file write permission storage and retrieval
 */
export class FilePermissionsRepository extends UserOwnedBaseRepository<FileWritePermission> {
  constructor() {
    super('file_permissions', FileWritePermissionSchema);
  }

  /**
   * Find permission by ID
   */
  async findById(id: string): Promise<FileWritePermission | null> {
    return this._findById(id);
  }

  /**
   * Find all permissions
   */
  async findAll(): Promise<FileWritePermission[]> {
    return this._findAll();
  }

  /**
   * Create a new permission
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
      const permission = await this._update(id, data as Partial<FileWritePermission>);

      if (permission) {
        logger.info('File write permission updated', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
      } else {
        logger.warn('File write permission not found for update', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
      }

      return permission;
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
   * Delete a permission
   */
  async delete(id: string): Promise<boolean> {
    return this.revokePermission(id);
  }

  /**
   * Find project-level permission for a user
   */
  async findByProjectId(userId: string, projectId: string): Promise<FileWritePermission | null> {
    try {
      const permission = await this.findOneByFilter({
        userId,
        scope: 'PROJECT',
        projectId,
      } as QueryFilter);

      if (permission) {
        return permission;
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
      const permission = await this.findOneByFilter({
        userId,
        scope: 'GENERAL',
      } as QueryFilter);

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
      const permission = await this.findOneByFilter({
        userId,
        scope: 'SINGLE_FILE',
        fileId,
      } as QueryFilter);

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

      const permission = await this.findOneByFilter({
        $or: conditions,
      } as QueryFilter);

      const canWrite = permission !== null;
      logger.debug('Checked file write permission', {
        context: 'file-permissions-repository',
        userId,
        projectId,
        fileId,
        canWrite,
        matchedScope: permission ? permission.scope : null,
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
      const permission = await this._create(data, options);

      logger.info('File write permission granted', {
        context: 'file-permissions-repository',
        permissionId: permission.id,
        userId: data.userId,
        scope: data.scope,
        projectId: data.projectId,
        fileId: data.fileId,
      });

      return permission;
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
      const result = await this._delete(id);

      if (result) {
        logger.info('File write permission revoked', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
      } else {
        logger.warn('File write permission not found for revocation', {
          context: 'file-permissions-repository',
          permissionId: id,
        });
      }

      return result;
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
      const count = await this.deleteMany({ userId } as QueryFilter);

      logger.info('All file write permissions revoked for user', {
        context: 'file-permissions-repository',
        userId,
        count,
      });

      return count;
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
      const count = await this.deleteMany({
        scope: 'PROJECT',
        projectId,
      } as QueryFilter);

      logger.info('All file write permissions revoked for project', {
        context: 'file-permissions-repository',
        projectId,
        count,
      });

      return count;
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
      const count = await this.deleteMany({
        scope: 'SINGLE_FILE',
        fileId,
      } as QueryFilter);

      if (count > 0) {
        logger.info('File write permissions revoked for deleted file', {
          context: 'file-permissions-repository',
          fileId,
          count,
        });
      }

      return count;
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
