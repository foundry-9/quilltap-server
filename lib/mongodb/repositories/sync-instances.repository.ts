/**
 * MongoDB Sync Instances Repository
 *
 * Handles CRUD operations for SyncInstance entities in MongoDB.
 * Manages configurations for remote Quilltap instances to sync with.
 */

import { logger } from '@/lib/logger';
import {
  SyncInstance,
  SyncInstanceSchema,
  CreateSyncInstance,
  SyncStatus,
} from '@/lib/sync/types';
import { MongoBaseRepository } from './base.repository';

/**
 * MongoDB Sync Instances Repository
 * Implements CRUD operations for sync instance configurations
 */
export class SyncInstancesRepository extends MongoBaseRepository<SyncInstance> {
  constructor() {
    super('sync_instances', SyncInstanceSchema);
  }

  /**
   * Find a sync instance by ID
   */
  async findById(id: string): Promise<SyncInstance | null> {
    const collection = await this.getCollection();

    logger.debug('Finding sync instance by ID', {
      instanceId: id,
    });

    try {
      const instance = await collection.findOne({ id });

      if (!instance) {
        logger.debug('Sync instance not found', {
          instanceId: id,
        });
        return null;
      }

      const { _id, ...instanceData } = instance as any;

      const validationResult = this.validateSafe(instanceData);
      if (!validationResult.success) {
        logger.warn('Sync instance validation failed', {
          instanceId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync instance found by ID', {
        instanceId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding sync instance by ID', {
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all sync instances
   */
  async findAll(): Promise<SyncInstance[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all sync instances');

    try {
      const instances = await collection.find({}).toArray();

      logger.debug('Retrieved all sync instances', {
        count: instances.length,
      });

      const validatedInstances: SyncInstance[] = [];
      for (const instance of instances) {
        const { _id, ...instanceData } = instance as any;
        const validationResult = this.validateSafe(instanceData);
        if (validationResult.success && validationResult.data) {
          validatedInstances.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync instance during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedInstances;
    } catch (error) {
      logger.error('Error finding all sync instances', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync instances by user ID
   */
  async findByUserId(userId: string): Promise<SyncInstance[]> {
    const collection = await this.getCollection();

    logger.debug('Finding sync instances by user ID', {
      userId,
    });

    try {
      const instances = await collection.find({ userId }).toArray();

      logger.debug('Retrieved sync instances by user ID', {
        userId,
        count: instances.length,
      });

      const validatedInstances: SyncInstance[] = [];
      for (const instance of instances) {
        const { _id, ...instanceData } = instance as any;
        const validationResult = this.validateSafe(instanceData);
        if (validationResult.success && validationResult.data) {
          validatedInstances.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync instance during findByUserId', {
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedInstances;
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
    const collection = await this.getCollection();

    logger.debug('Finding active sync instances by user ID', {
      userId,
    });

    try {
      const instances = await collection.find({ userId, isActive: true }).toArray();

      logger.debug('Retrieved active sync instances by user ID', {
        userId,
        count: instances.length,
      });

      const validatedInstances: SyncInstance[] = [];
      for (const instance of instances) {
        const { _id, ...instanceData } = instance as any;
        const validationResult = this.validateSafe(instanceData);
        if (validationResult.success && validationResult.data) {
          validatedInstances.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync instance during findActiveByUserId', {
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedInstances;
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
    const collection = await this.getCollection();

    logger.debug('Finding sync instance by user and URL', {
      userId,
      url,
    });

    try {
      const instance = await collection.findOne({ userId, url });

      if (!instance) {
        logger.debug('Sync instance not found by user and URL', {
          userId,
          url,
        });
        return null;
      }

      const { _id, ...instanceData } = instance as any;

      const validationResult = this.validateSafe(instanceData);
      if (!validationResult.success) {
        logger.warn('Sync instance validation failed during findByUserAndUrl', {
          userId,
          url,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync instance found by user and URL', {
        userId,
        url,
      });

      return validationResult.data || null;
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
  async create(data: CreateSyncInstance): Promise<SyncInstance> {
    const collection = await this.getCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new sync instance', {
      userId: data.userId,
      name: data.name,
      url: data.url,
    });

    try {
      const instance: SyncInstance = {
        ...data,
        id,
        remoteUserId: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        schemaVersion: null,
        appVersion: null,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(instance);

      const result = await collection.insertOne(validated as any);

      logger.info('Sync instance created successfully', {
        instanceId: id,
        userId: data.userId,
        name: data.name,
        url: data.url,
        insertedId: result.insertedId.toString(),
      });

      return validated;
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
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating sync instance', {
      instanceId: id,
    });

    try {
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      // Prevent overwriting these fields
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Sync instance not found during update', {
          instanceId: id,
        });
        return null;
      }

      const { _id, ...instanceData } = result as any;

      const validationResult = this.validateSafe(instanceData);
      if (!validationResult.success) {
        logger.warn('Updated sync instance validation failed', {
          instanceId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Sync instance updated successfully', {
        instanceId: id,
      });

      return validationResult.data || null;
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
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Resetting sync state for all user instances', {
      userId,
    });

    try {
      const result = await collection.updateMany(
        { userId },
        {
          $set: {
            lastSyncAt: null,
            lastSyncStatus: null,
            updatedAt: now,
          },
        }
      );

      logger.info('Reset sync state for user instances', {
        userId,
        modifiedCount: result.modifiedCount,
      });

      return result.modifiedCount;
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
    const collection = await this.getCollection();

    logger.debug('Deleting sync instance', {
      instanceId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Sync instance not found during delete', {
          instanceId: id,
        });
        return false;
      }

      logger.info('Sync instance deleted successfully', {
        instanceId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting sync instance', {
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
