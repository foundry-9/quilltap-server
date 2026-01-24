/**
 * Sync Instances Repository
 *
 * Backend-agnostic repository for SyncInstance entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { SyncInstance, SyncInstanceSchema, CreateSyncInstance, SyncStatus } from '@/lib/sync/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Sync Instances Repository
 * Implements CRUD operations for sync instance configurations
 */
export class SyncInstancesRepository extends UserOwnedBaseRepository<SyncInstance> {
  constructor() {
    super('sync_instances', SyncInstanceSchema);
  }

  /**
   * Find a sync instance by ID
   */
  async findById(id: string): Promise<SyncInstance | null> {
    return this._findById(id);
  }

  /**
   * Find all sync instances
   */
  async findAll(): Promise<SyncInstance[]> {
    return this._findAll();
  }

  /**
   * Find sync instances by user ID
   */
  async findByUserId(userId: string): Promise<SyncInstance[]> {
    logger.debug('Finding sync instances by user ID', {
      userId,
    });

    try {
      const instances = await this.findByFilter({ userId } as QueryFilter);

      logger.debug('Retrieved sync instances by user ID', {
        userId,
        count: instances.length,
      });

      return instances;
    } catch (error) {
      logger.error('Error finding sync instances by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find active sync instances by user ID
   */
  async findActiveByUserId(userId: string): Promise<SyncInstance[]> {
    logger.debug('Finding active sync instances by user ID', {
      userId,
    });

    try {
      const instances = await this.findByFilter({
        userId,
        isActive: true,
      } as QueryFilter);

      logger.debug('Retrieved active sync instances by user ID', {
        userId,
        count: instances.length,
      });

      return instances;
    } catch (error) {
      logger.error('Error finding active sync instances by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync instance by user ID and URL (for uniqueness check)
   */
  async findByUserAndUrl(userId: string, url: string): Promise<SyncInstance | null> {
    logger.debug('Finding sync instance by user and URL', {
      userId,
      url,
    });

    try {
      const instance = await this.findOneByFilter({
        userId,
        url,
      } as QueryFilter);

      if (!instance) {
        logger.debug('Sync instance not found by user and URL', {
          userId,
          url,
        });
        return null;
      }

      logger.debug('Sync instance found by user and URL', {
        userId,
        url,
      });

      return instance;
    } catch (error) {
      logger.error('Error finding sync instance by user and URL', {
        userId,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new sync instance
   */
  async create(
    data: CreateSyncInstance,
    options?: CreateOptions
  ): Promise<SyncInstance> {
    logger.debug('Creating new sync instance', {
      userId: data.userId,
      name: data.name,
      url: data.url,
    });

    try {
      const syncInstanceData = {
        ...data,
        remoteUserId: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        schemaVersion: null,
        appVersion: null,
      };

      const instance = await this._create(syncInstanceData, options);

      logger.info('Sync instance created successfully', {
        instanceId: instance.id,
        userId: data.userId,
        name: data.name,
        url: data.url,
      });

      return instance;
    } catch (error) {
      logger.error('Error creating sync instance', {
        userId: data.userId,
        name: data.name,
        url: data.url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a sync instance
   */
  async update(id: string, data: Partial<SyncInstance>): Promise<SyncInstance | null> {
    logger.debug('Updating sync instance', {
      instanceId: id,
    });

    try {
      const updateData = { ...data };

      // Prevent overwriting these fields
      delete updateData.id;
      delete updateData.createdAt;

      const instance = await this._update(id, updateData);

      if (instance) {
        logger.info('Sync instance updated successfully', {
          instanceId: id,
        });
      }

      return instance;
    } catch (error) {
      logger.error('Error updating sync instance', {
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update sync status after a sync operation
   */
  async updateSyncStatus(
    id: string,
    status: SyncStatus,
    remoteVersionInfo?: { schemaVersion?: string; appVersion?: string }
  ): Promise<SyncInstance | null> {
    const now = this.getCurrentTimestamp();

    logger.debug('Updating sync instance status', {
      instanceId: id,
      status,
    });

    const updateData: Partial<SyncInstance> = {
      lastSyncAt: now,
      lastSyncStatus: status,
    };

    if (remoteVersionInfo) {
      if (remoteVersionInfo.schemaVersion) {
        updateData.schemaVersion = remoteVersionInfo.schemaVersion;
      }
      if (remoteVersionInfo.appVersion) {
        updateData.appVersion = remoteVersionInfo.appVersion;
      }
    }

    return this.update(id, updateData);
  }

  /**
   * Reset sync state for an instance (clear lastSyncAt and status)
   * This allows the next sync to pull all data from remote
   */
  async resetSyncState(id: string): Promise<SyncInstance | null> {
    logger.debug('Resetting sync state for instance', {
      instanceId: id,
    });

    return this.update(id, {
      lastSyncAt: null,
      lastSyncStatus: null,
    });
  }

  /**
   * Reset sync state for all instances belonging to a user
   * Used when user deletes all data but wants to keep sync configuration
   */
  async resetSyncStateForUser(userId: string): Promise<number> {
    logger.debug('Resetting sync state for all user instances', {
      userId,
    });

    try {
      const modifiedCount = await this.updateMany(
        { userId } as QueryFilter,
        {
          lastSyncAt: null,
          lastSyncStatus: null,
        } as Partial<SyncInstance>
      );

      logger.info('Reset sync state for user instances', {
        userId,
        modifiedCount,
      });

      return modifiedCount;
    } catch (error) {
      logger.error('Error resetting sync state for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a sync instance
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting sync instance', {
      instanceId: id,
    });

    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Sync instance deleted successfully', {
          instanceId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting sync instance', {
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
