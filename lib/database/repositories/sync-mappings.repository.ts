/**
 * Sync Mappings Repository
 *
 * Backend-agnostic repository for SyncMapping entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Handles CRUD operations for permanent UUID mappings that maintain consistency
 * between local and remote entities across sync operations.
 */

import { logger } from '@/lib/logger';
import { SyncMapping, SyncMappingSchema, CreateSyncMapping, SyncableEntityType } from '@/lib/sync/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Sync Mappings Repository
 * Implements CRUD operations for permanent UUID mappings between local and remote entities.
 */
export class SyncMappingsRepository extends UserOwnedBaseRepository<SyncMapping> {
  constructor() {
    super('sync_mappings', SyncMappingSchema);
  }

  /**
   * Find a sync mapping by ID
   */
  async findById(id: string): Promise<SyncMapping | null> {
    return this._findById(id);
  }

  /**
   * Find all sync mappings
   */
  async findAll(): Promise<SyncMapping[]> {
    return this._findAll();
  }

  /**
   * Find sync mapping by local entity ID
   */
  async findByLocalId(
    userId: string,
    instanceId: string,
    entityType: SyncableEntityType,
    localId: string
  ): Promise<SyncMapping | null> {
    logger.debug('Finding sync mapping by local ID', {
      userId,
      instanceId,
      entityType,
      localId,
    });

    try {
      const mapping = await this.findOneByFilter({
        userId,
        instanceId,
        entityType,
        localId,
      } as QueryFilter);

      if (!mapping) {
        logger.debug('Sync mapping not found by local ID', {
          userId,
          instanceId,
          entityType,
          localId,
        });
        return null;
      }

      logger.debug('Sync mapping found by local ID', {
        localId,
        remoteId: mapping.remoteId,
      });

      return mapping;
    } catch (error) {
      logger.error('Error finding sync mapping by local ID', {
        localId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync mapping by remote entity ID
   */
  async findByRemoteId(
    userId: string,
    instanceId: string,
    entityType: SyncableEntityType,
    remoteId: string
  ): Promise<SyncMapping | null> {
    logger.debug('Finding sync mapping by remote ID', {
      userId,
      instanceId,
      entityType,
      remoteId,
    });

    try {
      const mapping = await this.findOneByFilter({
        userId,
        instanceId,
        entityType,
        remoteId,
      } as QueryFilter);

      if (!mapping) {
        logger.debug('Sync mapping not found by remote ID', {
          userId,
          instanceId,
          entityType,
          remoteId,
        });
        return null;
      }

      logger.debug('Sync mapping found by remote ID', {
        remoteId,
        localId: mapping.localId,
      });

      return mapping;
    } catch (error) {
      logger.error('Error finding sync mapping by remote ID', {
        remoteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all sync mappings for a specific instance
   */
  async findAllForInstance(userId: string, instanceId: string): Promise<SyncMapping[]> {
    logger.debug('Finding all sync mappings for instance', {
      userId,
      instanceId,
    });

    try {
      const mappings = await this.findByFilter({
        userId,
        instanceId,
      } as QueryFilter);

      logger.debug('Retrieved sync mappings for instance', {
        userId,
        instanceId,
        count: mappings.length,
      });

      return mappings;
    } catch (error) {
      logger.error('Error finding sync mappings for instance', {
        userId,
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync mappings by entity type for an instance
   */
  async findByEntityType(
    userId: string,
    instanceId: string,
    entityType: SyncableEntityType
  ): Promise<SyncMapping[]> {
    logger.debug('Finding sync mappings by entity type', {
      userId,
      instanceId,
      entityType,
    });

    try {
      const mappings = await this.findByFilter({
        userId,
        instanceId,
        entityType,
      } as QueryFilter);

      logger.debug('Retrieved sync mappings by entity type', {
        userId,
        instanceId,
        entityType,
        count: mappings.length,
      });

      return mappings;
    } catch (error) {
      logger.error('Error finding sync mappings by entity type', {
        userId,
        instanceId,
        entityType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new sync mapping
   */
  async create(data: CreateSyncMapping, options?: CreateOptions): Promise<SyncMapping> {
    logger.debug('Creating new sync mapping', {
      userId: data.userId,
      instanceId: data.instanceId,
      entityType: data.entityType,
      localId: data.localId,
      remoteId: data.remoteId,
    });

    try {
      const mapping = await this._create(data, options);

      logger.info('Sync mapping created successfully', {
        mappingId: mapping.id,
        userId: data.userId,
        instanceId: data.instanceId,
        entityType: data.entityType,
        localId: data.localId,
        remoteId: data.remoteId,
      });

      return mapping;
    } catch (error) {
      logger.error('Error creating sync mapping', {
        userId: data.userId,
        instanceId: data.instanceId,
        entityType: data.entityType,
        localId: data.localId,
        remoteId: data.remoteId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update sync timestamps after a successful sync
   */
  async updateSyncTimestamps(
    id: string,
    localUpdatedAt: string,
    remoteUpdatedAt: string
  ): Promise<SyncMapping | null> {
    logger.debug('Updating sync mapping timestamps', {
      mappingId: id,
      localUpdatedAt,
      remoteUpdatedAt,
    });

    try {
      const updated = await this.update(id, {
        lastSyncedAt: this.getCurrentTimestamp(),
        lastLocalUpdatedAt: localUpdatedAt,
        lastRemoteUpdatedAt: remoteUpdatedAt,
      } as Partial<SyncMapping>);

      if (updated) {
        logger.debug('Sync mapping timestamps updated successfully', {
          mappingId: id,
        });
      }

      return updated;
    } catch (error) {
      logger.error('Error updating sync mapping timestamps', {
        mappingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a sync mapping
   */
  async update(id: string, data: Partial<SyncMapping>): Promise<SyncMapping | null> {
    logger.debug('Updating sync mapping', {
      mappingId: id,
    });

    try {
      const updated = await this._update(id, data);

      if (updated) {
        logger.info('Sync mapping updated successfully', {
          mappingId: id,
        });
      }

      return updated;
    } catch (error) {
      logger.error('Error updating sync mapping', {
        mappingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a sync mapping
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting sync mapping', {
      mappingId: id,
    });

    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Sync mapping deleted successfully', {
          mappingId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting sync mapping', {
        mappingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all mappings for a specific instance
   */
  async deleteByInstanceId(instanceId: string): Promise<number> {
    logger.debug('Deleting all sync mappings for instance', {
      instanceId,
    });

    try {
      const count = await this.deleteMany({ instanceId } as QueryFilter);

      logger.info('Sync mappings deleted for instance', {
        instanceId,
        deletedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error deleting sync mappings for instance', {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all mappings for a specific user
   */
  async deleteByUserId(userId: string): Promise<number> {
    logger.debug('Deleting all sync mappings for user', {
      userId,
    });

    try {
      const count = await this.deleteMany({ userId } as QueryFilter);

      logger.info('Sync mappings deleted for user', {
        userId,
        deletedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error deleting sync mappings for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete mapping by local entity ID
   */
  async deleteByLocalId(
    userId: string,
    instanceId: string,
    entityType: SyncableEntityType,
    localId: string
  ): Promise<boolean> {
    logger.debug('Deleting sync mapping by local ID', {
      userId,
      instanceId,
      entityType,
      localId,
    });

    try {
      const count = await this.deleteMany({
        userId,
        instanceId,
        entityType,
        localId,
      } as QueryFilter);

      if (count === 0) {
        logger.warn('Sync mapping not found during delete by local ID', {
          localId,
        });
        return false;
      }

      logger.info('Sync mapping deleted by local ID', {
        localId,
        deletedCount: count,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting sync mapping by local ID', {
        localId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
