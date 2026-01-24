/**
 * Sync Operations Repository
 *
 * Backend-agnostic repository for SyncOperation entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Provides audit logging of sync operations for debugging and user visibility.
 */

import { logger } from '@/lib/logger';
import {
  SyncOperation,
  SyncOperationSchema,
  CreateSyncOperation,
  SyncConflict,
  SyncProgress,
} from '@/lib/sync/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter, QueryOptions } from '../interfaces';

/**
 * Sync Operations Repository
 * Implements CRUD operations for sync operation audit logs
 */
export class SyncOperationsRepository extends UserOwnedBaseRepository<SyncOperation> {
  constructor() {
    super('sync_operations', SyncOperationSchema);
  }

  /**
   * Find a sync operation by ID
   */
  async findById(id: string): Promise<SyncOperation | null> {
    logger.debug('Finding sync operation by ID', {
      operationId: id,
    });

    try {
      const operation = await this._findById(id);

      if (operation) {
        logger.debug('Sync operation found by ID', {
          operationId: id,
        });
      } else {
        logger.debug('Sync operation not found', {
          operationId: id,
        });
      }

      return operation;
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
    logger.debug('Finding all sync operations');

    try {
      const operations = await this._findAll();

      logger.debug('Retrieved all sync operations', {
        count: operations.length,
      });

      return operations;
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
    logger.debug('Finding sync operations by instance ID', {
      userId,
      instanceId,
      limit,
    });

    try {
      const options: QueryOptions = {
        limit,
        sort: { createdAt: -1 },
      };

      const operations = await this.findByFilter(
        { userId, instanceId } as QueryFilter,
        options
      );

      logger.debug('Retrieved sync operations by instance ID', {
        userId,
        instanceId,
        count: operations.length,
      });

      return operations;
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
    logger.debug('Finding in-progress sync operations', {
      userId,
    });

    try {
      const operations = await this.findByFilter({
        userId,
        status: { $in: ['PENDING', 'IN_PROGRESS'] },
      } as QueryFilter);

      logger.debug('Retrieved in-progress sync operations', {
        userId,
        count: operations.length,
      });

      return operations;
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
    logger.debug('Finding sync operations by user ID', {
      userId,
      limit,
    });

    try {
      const options: QueryOptions = {
        limit,
        sort: { createdAt: -1 },
      };

      const operations = await this.findByFilter(
        { userId } as QueryFilter,
        options
      );

      logger.debug('Retrieved sync operations by user ID', {
        userId,
        count: operations.length,
      });

      return operations;
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
  async create(
    data: CreateSyncOperation,
    options?: CreateOptions
  ): Promise<SyncOperation> {
    logger.debug('Creating new sync operation', {
      userId: data.userId,
      instanceId: data.instanceId,
      direction: data.direction,
    });

    try {
      const operation = await this._create(data, options);

      logger.info('Sync operation created successfully', {
        operationId: operation.id,
        userId: data.userId,
        instanceId: data.instanceId,
        direction: data.direction,
      });

      return operation;
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
    logger.debug('Updating sync operation', {
      operationId: id,
    });

    try {
      const operation = await this._update(id, data);

      if (operation) {
        logger.info('Sync operation updated successfully', {
          operationId: id,
        });
      } else {
        logger.warn('Sync operation not found during update', {
          operationId: id,
        });
      }

      return operation;
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
    const now = this.getCurrentTimestamp();

    logger.debug('Adding error to sync operation', {
      operationId: id,
      error,
    });

    try {
      const operation = await this.findById(id);
      if (!operation) {
        logger.warn('Sync operation not found during addError', {
          operationId: id,
        });
        return null;
      }

      const updatedErrors = [...(operation.errors || []), error];
      const result = await this.update(id, {
        errors: updatedErrors,
        updatedAt: now,
      } as Partial<SyncOperation>);

      if (result) {
        logger.debug('Error added to sync operation', {
          operationId: id,
        });
      }

      return result;
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
    const now = this.getCurrentTimestamp();

    logger.debug('Adding conflict to sync operation', {
      operationId: id,
      conflict,
    });

    try {
      const operation = await this.findById(id);
      if (!operation) {
        logger.warn('Sync operation not found during addConflict', {
          operationId: id,
        });
        return null;
      }

      const updatedConflicts = [...(operation.conflicts || []), conflict];
      const result = await this.update(id, {
        conflicts: updatedConflicts,
        updatedAt: now,
      } as Partial<SyncOperation>);

      if (result) {
        logger.debug('Conflict added to sync operation', {
          operationId: id,
        });
      }

      return result;
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

    return this.update(id, { entityCounts } as Partial<SyncOperation>);
  }

  /**
   * Update progress for sync operation (for real-time progress tracking)
   */
  async updateProgress(id: string, progress: SyncProgress): Promise<SyncOperation | null> {
    const now = this.getCurrentTimestamp();

    logger.debug('Updating progress for sync operation', {
      operationId: id,
      phase: progress.phase,
      currentItemName: progress.currentItemName,
    });

    try {
      const result = await this.update(id, {
        progress,
        updatedAt: now,
      } as Partial<SyncOperation>);

      if (result) {
        logger.debug('Progress updated for sync operation', {
          operationId: id,
          phase: progress.phase,
        });
      } else {
        logger.warn('Sync operation not found during updateProgress', {
          operationId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error updating progress for sync operation', {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a sync operation
   */
  async delete(id: string): Promise<boolean> {
    logger.debug('Deleting sync operation', {
      operationId: id,
    });

    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Sync operation deleted successfully', {
          operationId: id,
        });
      } else {
        logger.warn('Sync operation not found during delete', {
          operationId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting sync operation', {
        operationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all sync operations for a specific user
   */
  async deleteByUserId(userId: string): Promise<number> {
    logger.debug('Deleting all sync operations for user', {
      userId,
    });

    try {
      const count = await this.deleteMany({ userId } as QueryFilter);

      logger.info('Sync operations deleted for user', {
        userId,
        deletedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error deleting sync operations for user', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete old sync operations (for cleanup)
   */
  async deleteOlderThan(olderThan: Date): Promise<number> {
    const olderThanIso = olderThan.toISOString();

    logger.debug('Deleting sync operations older than', {
      olderThan: olderThanIso,
    });

    try {
      const count = await this.deleteMany({
        createdAt: { $lt: olderThanIso },
        status: { $in: ['COMPLETED', 'FAILED'] },
      } as QueryFilter);

      logger.info('Old sync operations deleted', {
        olderThan: olderThanIso,
        deletedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error deleting old sync operations', {
        olderThan: olderThanIso,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
