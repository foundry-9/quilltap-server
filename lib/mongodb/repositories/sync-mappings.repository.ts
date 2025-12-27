/**
 * MongoDB Sync Mappings Repository
 *
 * Handles CRUD operations for SyncMapping entities in MongoDB.
 * Maintains permanent UUID mappings between local and remote entities
 * to ensure consistent entity relationships across sync operations.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import {
  SyncMapping,
  SyncMappingSchema,
  CreateSyncMapping,
  SyncableEntityType,
} from '@/lib/sync/types';
import { getMongoDatabase } from '../client';

/**
 * MongoDB Sync Mappings Repository
 * Implements CRUD operations for permanent UUID mappings
 */
export class SyncMappingsRepository {
  private collectionName = 'sync_mappings';
  private schema = SyncMappingSchema;

  /**
   * Get the MongoDB collection
   */
  private async getCollection(): Promise<Collection> {
    const db = await getMongoDatabase();
    const collection = db.collection(this.collectionName);

    logger.debug('Retrieved MongoDB sync_mappings collection', {
      collectionName: this.collectionName,
    });

    return collection;
  }

  /**
   * Validate data against schema
   */
  private validate(data: unknown): SyncMapping {
    return this.schema.parse(data) as SyncMapping;
  }

  /**
   * Safely validate without throwing
   */
  private validateSafe(data: unknown): { success: boolean; data?: SyncMapping; error?: string } {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO timestamp
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Find a sync mapping by ID
   */
  async findById(id: string): Promise<SyncMapping | null> {
    const collection = await this.getCollection();

    logger.debug('Finding sync mapping by ID', {
      mappingId: id,
    });

    try {
      const mapping = await collection.findOne({ id });

      if (!mapping) {
        logger.debug('Sync mapping not found', {
          mappingId: id,
        });
        return null;
      }

      const { _id, ...mappingData } = mapping as any;

      const validationResult = this.validateSafe(mappingData);
      if (!validationResult.success) {
        logger.warn('Sync mapping validation failed', {
          mappingId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync mapping found by ID', {
        mappingId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding sync mapping by ID', {
        mappingId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all sync mappings
   */
  async findAll(): Promise<SyncMapping[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all sync mappings');

    try {
      const mappings = await collection.find({}).toArray();

      logger.debug('Retrieved all sync mappings', {
        count: mappings.length,
      });

      const validatedMappings: SyncMapping[] = [];
      for (const mapping of mappings) {
        const { _id, ...mappingData } = mapping as any;
        const validationResult = this.validateSafe(mappingData);
        if (validationResult.success && validationResult.data) {
          validatedMappings.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync mapping during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedMappings;
    } catch (error) {
      logger.error('Error finding all sync mappings', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const collection = await this.getCollection();

    logger.debug('Finding sync mapping by local ID', {
      userId,
      instanceId,
      entityType,
      localId,
    });

    try {
      const mapping = await collection.findOne({
        userId,
        instanceId,
        entityType,
        localId,
      });

      if (!mapping) {
        logger.debug('Sync mapping not found by local ID', {
          userId,
          instanceId,
          entityType,
          localId,
        });
        return null;
      }

      const { _id, ...mappingData } = mapping as any;

      const validationResult = this.validateSafe(mappingData);
      if (!validationResult.success) {
        logger.warn('Sync mapping validation failed during findByLocalId', {
          localId,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync mapping found by local ID', {
        localId,
        remoteId: validationResult.data?.remoteId,
      });

      return validationResult.data || null;
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
    const collection = await this.getCollection();

    logger.debug('Finding sync mapping by remote ID', {
      userId,
      instanceId,
      entityType,
      remoteId,
    });

    try {
      const mapping = await collection.findOne({
        userId,
        instanceId,
        entityType,
        remoteId,
      });

      if (!mapping) {
        logger.debug('Sync mapping not found by remote ID', {
          userId,
          instanceId,
          entityType,
          remoteId,
        });
        return null;
      }

      const { _id, ...mappingData } = mapping as any;

      const validationResult = this.validateSafe(mappingData);
      if (!validationResult.success) {
        logger.warn('Sync mapping validation failed during findByRemoteId', {
          remoteId,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync mapping found by remote ID', {
        remoteId,
        localId: validationResult.data?.localId,
      });

      return validationResult.data || null;
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
    const collection = await this.getCollection();

    logger.debug('Finding all sync mappings for instance', {
      userId,
      instanceId,
    });

    try {
      const mappings = await collection.find({ userId, instanceId }).toArray();

      logger.debug('Retrieved sync mappings for instance', {
        userId,
        instanceId,
        count: mappings.length,
      });

      const validatedMappings: SyncMapping[] = [];
      for (const mapping of mappings) {
        const { _id, ...mappingData } = mapping as any;
        const validationResult = this.validateSafe(mappingData);
        if (validationResult.success && validationResult.data) {
          validatedMappings.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync mapping during findAllForInstance', {
            error: validationResult.error,
          });
        }
      }

      return validatedMappings;
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
    const collection = await this.getCollection();

    logger.debug('Finding sync mappings by entity type', {
      userId,
      instanceId,
      entityType,
    });

    try {
      const mappings = await collection.find({ userId, instanceId, entityType }).toArray();

      logger.debug('Retrieved sync mappings by entity type', {
        userId,
        instanceId,
        entityType,
        count: mappings.length,
      });

      const validatedMappings: SyncMapping[] = [];
      for (const mapping of mappings) {
        const { _id, ...mappingData } = mapping as any;
        const validationResult = this.validateSafe(mappingData);
        if (validationResult.success && validationResult.data) {
          validatedMappings.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync mapping during findByEntityType', {
            error: validationResult.error,
          });
        }
      }

      return validatedMappings;
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
  async create(data: CreateSyncMapping): Promise<SyncMapping> {
    const collection = await this.getCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new sync mapping', {
      userId: data.userId,
      instanceId: data.instanceId,
      entityType: data.entityType,
      localId: data.localId,
      remoteId: data.remoteId,
    });

    try {
      const mapping: SyncMapping = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(mapping);

      const result = await collection.insertOne(validated as any);

      logger.info('Sync mapping created successfully', {
        mappingId: id,
        userId: data.userId,
        instanceId: data.instanceId,
        entityType: data.entityType,
        localId: data.localId,
        remoteId: data.remoteId,
        insertedId: result.insertedId.toString(),
      });

      return validated;
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
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating sync mapping timestamps', {
      mappingId: id,
      localUpdatedAt,
      remoteUpdatedAt,
    });

    try {
      const result = await collection.findOneAndUpdate(
        { id },
        {
          $set: {
            lastSyncedAt: now,
            lastLocalUpdatedAt: localUpdatedAt,
            lastRemoteUpdatedAt: remoteUpdatedAt,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Sync mapping not found during timestamp update', {
          mappingId: id,
        });
        return null;
      }

      const { _id, ...mappingData } = result as any;

      const validationResult = this.validateSafe(mappingData);
      if (!validationResult.success) {
        logger.warn('Updated sync mapping validation failed', {
          mappingId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync mapping timestamps updated successfully', {
        mappingId: id,
      });

      return validationResult.data || null;
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
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating sync mapping', {
      mappingId: id,
    });

    try {
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Sync mapping not found during update', {
          mappingId: id,
        });
        return null;
      }

      const { _id, ...mappingData } = result as any;

      const validationResult = this.validateSafe(mappingData);
      if (!validationResult.success) {
        logger.warn('Updated sync mapping validation failed', {
          mappingId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Sync mapping updated successfully', {
        mappingId: id,
      });

      return validationResult.data || null;
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
    const collection = await this.getCollection();

    logger.debug('Deleting sync mapping', {
      mappingId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Sync mapping not found during delete', {
          mappingId: id,
        });
        return false;
      }

      logger.info('Sync mapping deleted successfully', {
        mappingId: id,
        deletedCount: result.deletedCount,
      });

      return true;
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
    const collection = await this.getCollection();

    logger.debug('Deleting all sync mappings for instance', {
      instanceId,
    });

    try {
      const result = await collection.deleteMany({ instanceId });

      logger.info('Sync mappings deleted for instance', {
        instanceId,
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
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
    const collection = await this.getCollection();

    logger.debug('Deleting all sync mappings for user', {
      userId,
    });

    try {
      const result = await collection.deleteMany({ userId });

      logger.info('Sync mappings deleted for user', {
        userId,
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
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
    const collection = await this.getCollection();

    logger.debug('Deleting sync mapping by local ID', {
      userId,
      instanceId,
      entityType,
      localId,
    });

    try {
      const result = await collection.deleteOne({
        userId,
        instanceId,
        entityType,
        localId,
      });

      if (result.deletedCount === 0) {
        logger.warn('Sync mapping not found during delete by local ID', {
          localId,
        });
        return false;
      }

      logger.info('Sync mapping deleted by local ID', {
        localId,
        deletedCount: result.deletedCount,
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
