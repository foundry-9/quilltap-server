/**
 * Embedding Status Repository
 *
 * Repository for tracking embedding status of entities (memories, files, etc.).
 * Used to monitor which items need embedding and handle failures.
 */

import { logger } from '@/lib/logger';
import {
  EmbeddingStatus,
  EmbeddingStatusSchema,
  EmbeddingStatusValue,
  EmbeddableEntityType,
} from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Embedding Status Repository
 *
 * Manages embedding status tracking for entities.
 */
export class EmbeddingStatusRepository extends AbstractBaseRepository<EmbeddingStatus> {
  constructor() {
    super('embedding_status', EmbeddingStatusSchema);
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find status by ID
   */
  async findById(id: string): Promise<EmbeddingStatus | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id } as QueryFilter);
      return result;
    } catch (error) {
      logger.error('Error finding embedding status by ID', {
        context: 'EmbeddingStatusRepository.findById',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all status records
   */
  async findAll(): Promise<EmbeddingStatus[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({});
    } catch (error) {
      logger.error('Error finding all embedding statuses', {
        context: 'EmbeddingStatusRepository.findAll',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find status by entity
   */
  async findByEntity(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string
  ): Promise<EmbeddingStatus | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({
        entityType,
        entityId,
        profileId,
      } as QueryFilter);
      return result;
    } catch (error) {
      logger.error('Error finding embedding status by entity', {
        context: 'EmbeddingStatusRepository.findByEntity',
        entityType,
        entityId,
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all statuses for a user
   */
  async findByUserId(userId: string): Promise<EmbeddingStatus[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({ userId } as QueryFilter);
    } catch (error) {
      logger.error('Error finding embedding statuses by user ID', {
        context: 'EmbeddingStatusRepository.findByUserId',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all statuses for a profile
   */
  async findByProfileId(profileId: string): Promise<EmbeddingStatus[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({ profileId } as QueryFilter);
    } catch (error) {
      logger.error('Error finding embedding statuses by profile ID', {
        context: 'EmbeddingStatusRepository.findByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all pending statuses for a profile
   */
  async findPendingByProfileId(profileId: string): Promise<EmbeddingStatus[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({
        profileId,
        status: 'PENDING',
      } as QueryFilter);
    } catch (error) {
      logger.error('Error finding pending embedding statuses', {
        context: 'EmbeddingStatusRepository.findPendingByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all statuses with a specific status value
   */
  async findByStatus(status: EmbeddingStatusValue): Promise<EmbeddingStatus[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({ status } as QueryFilter);
    } catch (error) {
      logger.error('Error finding embedding statuses by status', {
        context: 'EmbeddingStatusRepository.findByStatus',
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new status record
   */
  async create(
    data: Omit<EmbeddingStatus, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<EmbeddingStatus> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const status: EmbeddingStatus = {
        id: options?.id || this.generateId(),
        ...data,
        createdAt: options?.createdAt || now,
        updatedAt: now,
      };

      const validated = this.validate(status);
      await collection.insertOne(validated);

      return validated;
    } catch (error) {
      logger.error('Error creating embedding status', {
        context: 'EmbeddingStatusRepository.create',
        entityType: data.entityType,
        entityId: data.entityId,
        profileId: data.profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a status record
   */
  async update(id: string, data: Partial<EmbeddingStatus>): Promise<EmbeddingStatus | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      // Remove immutable fields
      const updateData = { ...data };
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.updateOne(
        { id } as QueryFilter,
        { $set: { ...updateData, updatedAt: now } }
      );

      if (result.modifiedCount === 0) {
        return null;
      }

      return this.findById(id);
    } catch (error) {
      logger.error('Error updating embedding status', {
        context: 'EmbeddingStatusRepository.update',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Upsert status by entity (create or update)
   */
  async upsertByEntity(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string,
    data: Partial<Omit<EmbeddingStatus, 'id' | 'createdAt' | 'updatedAt' | 'entityType' | 'entityId' | 'profileId'>>
  ): Promise<EmbeddingStatus> {
    const existing = await this.findByEntity(entityType, entityId, profileId);

    if (existing) {
      const updated = await this.update(existing.id, data);
      if (!updated) {
        throw new Error(`Failed to update embedding status for ${entityType} ${entityId}`);
      }
      return updated;
    }

    return this.create({
      userId: data.userId || '',
      entityType,
      entityId,
      profileId,
      status: data.status || 'PENDING',
      embeddedAt: data.embeddedAt,
      error: data.error,
    });
  }

  /**
   * Mark entity as embedded
   */
  async markAsEmbedded(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string
  ): Promise<EmbeddingStatus | null> {
    const existing = await this.findByEntity(entityType, entityId, profileId);
    if (!existing) {
      return null;
    }

    return this.update(existing.id, {
      status: 'EMBEDDED',
      embeddedAt: this.getCurrentTimestamp(),
      error: null,
    });
  }

  /**
   * Mark entity as failed
   */
  async markAsFailed(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string,
    error: string
  ): Promise<EmbeddingStatus | null> {
    const existing = await this.findByEntity(entityType, entityId, profileId);
    if (!existing) {
      return null;
    }

    return this.update(existing.id, {
      status: 'FAILED',
      error,
    });
  }

  /**
   * Mark all entities as pending for a profile (for re-embedding)
   */
  async markAllPendingByProfileId(profileId: string): Promise<number> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.updateMany(
        { profileId } as QueryFilter,
        {
          $set: {
            status: 'PENDING',
            embeddedAt: null,
            error: null,
            updatedAt: now,
          },
        }
      );

      logger.info('Marked all embeddings as pending for profile', {
        context: 'EmbeddingStatusRepository.markAllPendingByProfileId',
        profileId,
        modifiedCount: result.modifiedCount,
      });

      return result.modifiedCount;
    } catch (error) {
      logger.error('Error marking all embeddings as pending', {
        context: 'EmbeddingStatusRepository.markAllPendingByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a status record
   */
  async delete(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id } as QueryFilter);

      if (result.deletedCount > 0) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error deleting embedding status', {
        context: 'EmbeddingStatusRepository.delete',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete status by entity
   */
  async deleteByEntity(
    entityType: EmbeddableEntityType,
    entityId: string
  ): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        entityType,
        entityId,
      } as QueryFilter);

      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting embedding status by entity', {
        context: 'EmbeddingStatusRepository.deleteByEntity',
        entityType,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all statuses for a profile
   */
  async deleteByProfileId(profileId: string): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ profileId } as QueryFilter);

      if (result.deletedCount > 0) {
        logger.info('Embedding statuses deleted by profile ID', {
          context: 'EmbeddingStatusRepository.deleteByProfileId',
          profileId,
          deletedCount: result.deletedCount,
        });
      }

      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting embedding statuses by profile ID', {
        context: 'EmbeddingStatusRepository.deleteByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get embedding statistics for a profile
   */
  async getStatsByProfileId(profileId: string): Promise<{
    total: number;
    pending: number;
    embedded: number;
    failed: number;
  }> {
    try {
      const statuses = await this.findByProfileId(profileId);

      const stats = {
        total: statuses.length,
        pending: 0,
        embedded: 0,
        failed: 0,
      };

      for (const status of statuses) {
        switch (status.status) {
          case 'PENDING':
            stats.pending++;
            break;
          case 'EMBEDDED':
            stats.embedded++;
            break;
          case 'FAILED':
            stats.failed++;
            break;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Error getting embedding stats', {
        context: 'EmbeddingStatusRepository.getStatsByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { total: 0, pending: 0, embedded: 0, failed: 0 };
    }
  }
}
