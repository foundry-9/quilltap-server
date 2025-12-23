/**
 * MongoDB Sync Operations Repository
 *
 * Handles CRUD operations for SyncOperation entities in MongoDB.
 * Provides audit logging of sync operations for debugging and user visibility.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import {
  SyncOperation,
  SyncOperationSchema,
  CreateSyncOperation,
  SyncOperationStatus,
  SyncConflict,
} from '@/lib/sync/types';
import { getMongoDatabase } from '../client';

/**
 * MongoDB Sync Operations Repository
 * Implements CRUD operations for sync operation audit logs
 */
export class SyncOperationsRepository {
  private collectionName = 'sync_operations';
  private schema = SyncOperationSchema;

  /**
   * Get the MongoDB collection
   */
  private async getCollection(): Promise<Collection> {
    const db = await getMongoDatabase();
    const collection = db.collection(this.collectionName);

    logger.debug('Retrieved MongoDB sync_operations collection', {
      collectionName: this.collectionName,
    });

    return collection;
  }

  /**
   * Validate data against schema
   */
  private validate(data: unknown): SyncOperation {
    return this.schema.parse(data) as SyncOperation;
  }

  /**
   * Safely validate without throwing
   */
  private validateSafe(data: unknown): { success: boolean; data?: SyncOperation; error?: string } {
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
   * Find a sync operation by ID
   */
  async findById(id: string): Promise<SyncOperation | null> {
    const collection = await this.getCollection();

    logger.debug('Finding sync operation by ID', {
      operationId: id,
    });

    try {
      const operation = await collection.findOne({ id });

      if (!operation) {
        logger.debug('Sync operation not found', {
          operationId: id,
        });
        return null;
      }

      const { _id, ...operationData } = operation as any;

      const validationResult = this.validateSafe(operationData);
      if (!validationResult.success) {
        logger.warn('Sync operation validation failed', {
          operationId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Sync operation found by ID', {
        operationId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding sync operation by ID', {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all sync operations
   */
  async findAll(): Promise<SyncOperation[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all sync operations');

    try {
      const operations = await collection.find({}).sort({ createdAt: -1 }).toArray();

      logger.debug('Retrieved all sync operations', {
        count: operations.length,
      });

      const validatedOperations: SyncOperation[] = [];
      for (const operation of operations) {
        const { _id, ...operationData } = operation as any;
        const validationResult = this.validateSafe(operationData);
        if (validationResult.success && validationResult.data) {
          validatedOperations.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync operation during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedOperations;
    } catch (error) {
      logger.error('Error finding all sync operations', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync operations by instance ID with optional limit
   */
  async findByInstanceId(
    userId: string,
    instanceId: string,
    limit: number = 50
  ): Promise<SyncOperation[]> {
    const collection = await this.getCollection();

    logger.debug('Finding sync operations by instance ID', {
      userId,
      instanceId,
      limit,
    });

    try {
      const operations = await collection
        .find({ userId, instanceId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      logger.debug('Retrieved sync operations by instance ID', {
        userId,
        instanceId,
        count: operations.length,
      });

      const validatedOperations: SyncOperation[] = [];
      for (const operation of operations) {
        const { _id, ...operationData } = operation as any;
        const validationResult = this.validateSafe(operationData);
        if (validationResult.success && validationResult.data) {
          validatedOperations.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync operation during findByInstanceId', {
            error: validationResult.error,
          });
        }
      }

      return validatedOperations;
    } catch (error) {
      logger.error('Error finding sync operations by instance ID', {
        userId,
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find in-progress sync operations for a user
   */
  async findInProgress(userId: string): Promise<SyncOperation[]> {
    const collection = await this.getCollection();

    logger.debug('Finding in-progress sync operations', {
      userId,
    });

    try {
      const operations = await collection
        .find({
          userId,
          status: { $in: ['PENDING', 'IN_PROGRESS'] },
        })
        .toArray();

      logger.debug('Retrieved in-progress sync operations', {
        userId,
        count: operations.length,
      });

      const validatedOperations: SyncOperation[] = [];
      for (const operation of operations) {
        const { _id, ...operationData } = operation as any;
        const validationResult = this.validateSafe(operationData);
        if (validationResult.success && validationResult.data) {
          validatedOperations.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync operation during findInProgress', {
            error: validationResult.error,
          });
        }
      }

      return validatedOperations;
    } catch (error) {
      logger.error('Error finding in-progress sync operations', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find sync operations by user ID with optional limit
   */
  async findByUserId(userId: string, limit: number = 50): Promise<SyncOperation[]> {
    const collection = await this.getCollection();

    logger.debug('Finding sync operations by user ID', {
      userId,
      limit,
    });

    try {
      const operations = await collection
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      logger.debug('Retrieved sync operations by user ID', {
        userId,
        count: operations.length,
      });

      const validatedOperations: SyncOperation[] = [];
      for (const operation of operations) {
        const { _id, ...operationData } = operation as any;
        const validationResult = this.validateSafe(operationData);
        if (validationResult.success && validationResult.data) {
          validatedOperations.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid sync operation during findByUserId', {
            error: validationResult.error,
          });
        }
      }

      return validatedOperations;
    } catch (error) {
      logger.error('Error finding sync operations by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new sync operation
   */
  async create(data: CreateSyncOperation): Promise<SyncOperation> {
    const collection = await this.getCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new sync operation', {
      userId: data.userId,
      instanceId: data.instanceId,
      direction: data.direction,
    });

    try {
      const operation: SyncOperation = {
        ...data,
        id,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(operation);

      const result = await collection.insertOne(validated as any);

      logger.info('Sync operation created successfully', {
        operationId: id,
        userId: data.userId,
        instanceId: data.instanceId,
        direction: data.direction,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating sync operation', {
        userId: data.userId,
        instanceId: data.instanceId,
        direction: data.direction,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a sync operation
   */
  async update(id: string, data: Partial<SyncOperation>): Promise<SyncOperation | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating sync operation', {
      operationId: id,
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
        logger.warn('Sync operation not found during update', {
          operationId: id,
        });
        return null;
      }

      const { _id, ...operationData } = result as any;

      const validationResult = this.validateSafe(operationData);
      if (!validationResult.success) {
        logger.warn('Updated sync operation validation failed', {
          operationId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Sync operation updated successfully', {
        operationId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating sync operation', {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Mark sync operation as completed
   */
  async complete(
    id: string,
    status: 'COMPLETED' | 'FAILED',
    entityCounts?: Record<string, number>,
    conflicts?: SyncConflict[],
    errors?: string[]
  ): Promise<SyncOperation | null> {
    const now = this.getCurrentTimestamp();

    logger.debug('Completing sync operation', {
      operationId: id,
      status,
    });

    const updateData: Partial<SyncOperation> = {
      status,
      completedAt: now,
    };

    if (entityCounts) {
      updateData.entityCounts = entityCounts;
    }

    if (conflicts) {
      updateData.conflicts = conflicts;
    }

    if (errors) {
      updateData.errors = errors;
    }

    return this.update(id, updateData);
  }

  /**
   * Add error to sync operation
   */
  async addError(id: string, error: string): Promise<SyncOperation | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Adding error to sync operation', {
      operationId: id,
      error,
    });

    try {
      const result = await collection.findOneAndUpdate(
        { id },
        {
          $push: { errors: error },
          $set: { updatedAt: now },
        } as any,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Sync operation not found during addError', {
          operationId: id,
        });
        return null;
      }

      const { _id, ...operationData } = result as any;

      const validationResult = this.validateSafe(operationData);
      if (!validationResult.success) {
        logger.warn('Updated sync operation validation failed after addError', {
          operationId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Error added to sync operation', {
        operationId: id,
      });

      return validationResult.data || null;
    } catch (err) {
      logger.error('Error adding error to sync operation', {
        operationId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Add conflict to sync operation
   */
  async addConflict(id: string, conflict: SyncConflict): Promise<SyncOperation | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Adding conflict to sync operation', {
      operationId: id,
      conflict,
    });

    try {
      const result = await collection.findOneAndUpdate(
        { id },
        {
          $push: { conflicts: conflict },
          $set: { updatedAt: now },
        } as any,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Sync operation not found during addConflict', {
          operationId: id,
        });
        return null;
      }

      const { _id, ...operationData } = result as any;

      const validationResult = this.validateSafe(operationData);
      if (!validationResult.success) {
        logger.warn('Updated sync operation validation failed after addConflict', {
          operationId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Conflict added to sync operation', {
        operationId: id,
      });

      return validationResult.data || null;
    } catch (err) {
      logger.error('Error adding conflict to sync operation', {
        operationId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Update entity counts for sync operation
   */
  async updateEntityCounts(
    id: string,
    entityCounts: Record<string, number>
  ): Promise<SyncOperation | null> {
    logger.debug('Updating entity counts for sync operation', {
      operationId: id,
      entityCounts,
    });

    return this.update(id, { entityCounts });
  }

  /**
   * Delete a sync operation
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection();

    logger.debug('Deleting sync operation', {
      operationId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Sync operation not found during delete', {
          operationId: id,
        });
        return false;
      }

      logger.info('Sync operation deleted successfully', {
        operationId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting sync operation', {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete old sync operations (for cleanup)
   */
  async deleteOlderThan(olderThan: Date): Promise<number> {
    const collection = await this.getCollection();
    const olderThanIso = olderThan.toISOString();

    logger.debug('Deleting sync operations older than', {
      olderThan: olderThanIso,
    });

    try {
      const result = await collection.deleteMany({
        createdAt: { $lt: olderThanIso },
        status: { $in: ['COMPLETED', 'FAILED'] },
      });

      logger.info('Old sync operations deleted', {
        olderThan: olderThanIso,
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting old sync operations', {
        olderThan: olderThanIso,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
