/**
 * Mount Points Repository
 *
 * Backend-agnostic repository for managing storage mount point configurations.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and specialized queries for storage backends with
 * health tracking, scope management, and default mount point handling.
 */

import { logger } from '@/lib/logger';
import { MountPoint, MountPointSchema, HealthStatus } from '@/lib/file-storage/mount-point.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Mount Points Repository
 * Manages storage mount point configurations including system and per-user backends
 */
export class MountPointsRepository extends AbstractBaseRepository<MountPoint> {
  constructor() {
    super('mount_points', MountPointSchema);
  }

  /**
   * Find mount point by ID
   * @param id The mount point ID
   * @returns The mount point or null if not found
   */
  async findById(id: string): Promise<MountPoint | null> {
    return this._findById(id);
  }

  /**
   * Find all mount points
   * @returns Array of all mount points
   */
  async findAll(): Promise<MountPoint[]> {
    return this._findAll();
  }

  /**
   * Create new mount point
   * @param data The mount point data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns The created mount point
   */
  async create(
    data: Omit<MountPoint, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<MountPoint> {
    try {
      const mountPoint = await this._create(data, options);

      logger.info('Mount point created', {
        mountPointId: mountPoint.id,
        name: data.name,
        backendType: data.backendType,
        scope: data.scope,
      });

      return mountPoint;
    } catch (error) {
      logger.error('Error creating mount point', {
        name: data.name,
        backendType: data.backendType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update mount point
   * @param id The mount point ID
   * @param data The partial mount point data to update
   * @returns The updated mount point or null if not found
   */
  async update(id: string, data: Partial<MountPoint>): Promise<MountPoint | null> {
    try {
      const mountPoint = await this._update(id, data);

      if (mountPoint) {
        logger.info('Mount point updated', { mountPointId: id });
      }

      return mountPoint;
    } catch (error) {
      logger.error('Error updating mount point', {
        mountPointId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete mount point
   * @param id The mount point ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Mount point deleted', { mountPointId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting mount point', {
        mountPointId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // =========================================================================
  // SPECIALIZED QUERY METHODS
  // =========================================================================

  /**
   * Find the default mount point (isDefault=true)
   * @returns The default mount point or null if none set
   */
  async findDefault(): Promise<MountPoint | null> {
    try {
      const mountPoint = await this.findOneByFilter({ isDefault: true } as QueryFilter);

      if (mountPoint) {
        return mountPoint;
      }
      return null;
    } catch (error) {
      logger.error('Error finding default mount point', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find mount points by scope
   * @param scope The scope ('system' or 'user')
   * @param userId Optional user ID for filtering user-scoped mount points
   * @returns Array of mount points matching the scope
   */
  async findByScope(scope: 'system' | 'user', userId?: string): Promise<MountPoint[]> {
    try {
      const query: Record<string, unknown> = { scope };

      if (scope === 'user' && userId) {
        query.userId = userId;
      }

      const mountPoints = await this.findByFilter(query as QueryFilter);
      return mountPoints;
    } catch (error) {
      logger.error('Error finding mount points by scope', {
        scope,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all enabled mount points
   * @returns Array of enabled mount points
   */
  async findEnabled(): Promise<MountPoint[]> {
    try {
      const mountPoints = await this.findByFilter({ enabled: true } as QueryFilter);
      return mountPoints;
    } catch (error) {
      logger.error('Error finding enabled mount points', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find mount points by backend type
   * @param backendType The backend type (e.g., 'local', 's3')
   * @returns Array of mount points with the specified backend type
   */
  async findByBackendType(backendType: string): Promise<MountPoint[]> {
    try {
      const mountPoints = await this.findByFilter({ backendType } as QueryFilter);
      return mountPoints;
    } catch (error) {
      logger.error('Error finding mount points by backend type', {
        backendType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // =========================================================================
  // MANAGEMENT METHODS
  // =========================================================================

  /**
   * Set a mount point as the default (clears isDefault on all others first)
   * @param id The mount point ID to set as default
   */
  async setDefault(id: string): Promise<void> {
    try {
      // Clear isDefault from all other mount points
      await this.updateMany(
        { id: { $ne: id } } as QueryFilter,
        { isDefault: false } as Partial<MountPoint>
      );

      // Set this mount point as default
      await this.updateMany(
        { id } as QueryFilter,
        { isDefault: true } as Partial<MountPoint>
      );

      logger.info('Mount point set as default', { mountPointId: id });
    } catch (error) {
      logger.error('Error setting default mount point', {
        mountPointId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update health status of a mount point and record last health check timestamp
   * @param id The mount point ID
   * @param status The health status ('healthy', 'degraded', 'unhealthy', 'unknown')
   */
  async updateHealth(id: string, status: HealthStatus): Promise<void> {
    try {
      const now = this.getCurrentTimestamp();

      const result = await this.update(id, {
        healthStatus: status,
        lastHealthCheck: now,
      } as Partial<MountPoint>);

      if (!result) {
        logger.warn('Mount point not found for health update', { mountPointId: id });
        return;
      }
    } catch (error) {
      logger.error('Error updating mount point health', {
        mountPointId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear default flags from orphaned mount points (those that don't exist)
   * This is a maintenance operation to clean up inconsistent state
   */
  async clearOrphanedDefaults(): Promise<void> {
    try {
      // Update any mount point with isDefault that no longer exists
      // This is handled by clearing defaults from specific non-existent IDs if needed
      // For now, this is a no-op maintenance method that could be expanded
    } catch (error) {
      logger.error('Error clearing orphaned defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Export singleton instance
export const mountPointsRepository = new MountPointsRepository();
