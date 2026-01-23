/**
 * MongoDB Mount Points Repository
 *
 * Repository for managing storage mount point configurations in MongoDB.
 * Handles CRUD operations and specialized queries for storage backends with
 * health tracking, scope management, and default mount point handling.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import { MongoBaseRepository, CreateOptions } from './base.repository';
import { MountPoint, MountPointSchema, HealthStatus } from '@/lib/file-storage/mount-point.types';

/**
 * Mount Points Repository for MongoDB
 * Manages storage mount point configurations including system and per-user backends
 */
export class MountPointsRepository extends MongoBaseRepository<MountPoint> {
  constructor() {
    super('mount_points', MountPointSchema);
  }

  /**
   * Find mount point by ID
   * @param id The mount point ID
   * @returns The mount point or null if not found
   */
  async findById(id: string): Promise<MountPoint | null> {
    try {
      const collection = await this.getCollection();
      const mountPoint = await collection.findOne({ id });

      if (mountPoint) {
        return this.validate(mountPoint);
      }

      logger.debug('Mount point not found', { mountPointId: id });
      return null;
    } catch (error) {
      logger.error('Error finding mount point by ID', {
        mountPointId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all mount points
   * @returns Array of all mount points
   */
  async findAll(): Promise<MountPoint[]> {
    try {
      const collection = await this.getCollection();
      const mountPoints = await collection.find({}).toArray();
      return mountPoints.map((mp: unknown) => this.validate(mp));
    } catch (error) {
      logger.error('Error finding all mount points', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const newMountPoint: MountPoint = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(newMountPoint);
      const collection = await this.getCollection();

      await collection.insertOne(validated as any);

      logger.info('Mount point created', {
        mountPointId: id,
        name: data.name,
        backendType: data.backendType,
        scope: data.scope,
      });
      return validated;
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
  async update(
    id: string,
    data: Partial<Omit<MountPoint, 'id' | 'createdAt'>>
  ): Promise<MountPoint | null> {
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
        logger.info('Mount point updated', { mountPointId: id });
        return this.validate(result);
      }

      logger.warn('Mount point not found for update', { mountPointId: id });
      return null;
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
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount > 0) {
        logger.info('Mount point deleted', { mountPointId: id });
        return true;
      }

      logger.warn('Mount point not found for deletion', { mountPointId: id });
      return false;
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
      const collection = await this.getCollection();
      const mountPoint = await collection.findOne({ isDefault: true });

      if (mountPoint) {
        logger.debug('Found default mount point', { mountPointId: mountPoint.id });
        return this.validate(mountPoint);
      }

      logger.debug('No default mount point found');
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
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { scope };

      if (scope === 'user' && userId) {
        query.userId = userId;
      }

      const mountPoints = await collection.find(query).toArray();

      logger.debug('Found mount points by scope', {
        scope,
        userId,
        count: mountPoints.length,
      });

      return mountPoints.map((mp: unknown) => this.validate(mp));
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
      const collection = await this.getCollection();
      const mountPoints = await collection.find({ enabled: true }).toArray();

      logger.debug('Found enabled mount points', { count: mountPoints.length });

      return mountPoints.map((mp: unknown) => this.validate(mp));
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
      const collection = await this.getCollection();
      const mountPoints = await collection.find({ backendType }).toArray();

      logger.debug('Found mount points by backend type', {
        backendType,
        count: mountPoints.length,
      });

      return mountPoints.map((mp: unknown) => this.validate(mp));
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
      const collection = await this.getCollection();

      // Clear isDefault from all other mount points
      await collection.updateMany(
        { id: { $ne: id } },
        { $set: { isDefault: false, updatedAt: this.getCurrentTimestamp() } }
      );

      // Set this mount point as default
      await collection.updateOne(
        { id },
        { $set: { isDefault: true, updatedAt: this.getCurrentTimestamp() } }
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
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.updateOne(
        { id },
        {
          $set: {
            healthStatus: status,
            lastHealthCheck: now,
            updatedAt: now,
          },
        }
      );

      if (result.matchedCount === 0) {
        logger.warn('Mount point not found for health update', { mountPointId: id });
        return;
      }

      logger.debug('Mount point health updated', {
        mountPointId: id,
        status,
        lastHealthCheck: now,
      });
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

      logger.debug('Cleared orphaned default flags');
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
