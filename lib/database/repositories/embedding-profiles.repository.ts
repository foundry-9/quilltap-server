/**
 * Embedding Profiles Repository
 *
 * Backend-agnostic repository for EmbeddingProfile entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { EmbeddingProfile, EmbeddingProfileSchema } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Embedding Profiles Repository
 * Manages EmbeddingProfile entities with user-scoping and tag support
 */
export class EmbeddingProfilesRepository extends TaggableBaseRepository<EmbeddingProfile> {
  constructor() {
    super('embedding_profiles', EmbeddingProfileSchema);
  }

  // ============================================================================
  // EMBEDDING PROFILE OPERATIONS
  // ============================================================================

  /**
   * Find an embedding profile by ID
   */
  async findById(id: string): Promise<EmbeddingProfile | null> {
    return this._findById(id);
  }

  /**
   * Find all embedding profiles
   */
  async findAll(): Promise<EmbeddingProfile[]> {
    return this._findAll();
  }

  /**
   * Find embedding profile by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<EmbeddingProfile | null> {
    try {
      const profile = await this.findOneByFilter({
        userId,
        name,
      } as QueryFilter);

      if (!profile) {
        return null;
      }
      return profile;
    } catch (error) {
      logger.error('Error finding embedding profile by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find default embedding profile for user
   */
  async findDefault(userId: string): Promise<EmbeddingProfile | null> {
    try {
      const profile = await this.findOneByFilter({
        userId,
        isDefault: true,
      } as QueryFilter);

      if (!profile) {
        return null;
      }
      return profile;
    } catch (error) {
      logger.error('Error finding default embedding profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new embedding profile
   */
  async create(
    data: Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<EmbeddingProfile> {
    try {
      const profile = await this._create(data, options);

      logger.info('Embedding profile created successfully', {
        profileId: profile.id,
        userId: data.userId,
        name: data.name,
        provider: data.provider,
      });

      return profile;
    } catch (error) {
      logger.error('Error creating embedding profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an embedding profile
   */
  async update(id: string, data: Partial<EmbeddingProfile>): Promise<EmbeddingProfile | null> {
    try {
      // Remove id and createdAt to prevent accidental overwrites
      const updateData = { ...data };
      delete updateData.id;
      delete updateData.createdAt;

      const profile = await this._update(id, updateData);

      if (profile) {
        logger.info('Embedding profile updated successfully', {
          profileId: id,
        });
      }

      return profile;
    } catch (error) {
      logger.error('Error updating embedding profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an embedding profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Embedding profile deleted successfully', {
          profileId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting embedding profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Unset all embedding profiles for a user as default
   * Used when setting a new default profile
   */
  async unsetAllDefaults(userId: string): Promise<boolean> {
    try {
      const count = await this.updateMany(
        { userId, isDefault: true } as QueryFilter,
        { isDefault: false } as Partial<EmbeddingProfile>
      );

      logger.info('All default embedding profiles unset for user', {
        userId,
        modifiedCount: count,
      });

      return count > 0 || (await this.count({ userId } as QueryFilter)) === 0;
    } catch (error) {
      logger.error('Error unsetting all default embedding profiles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
