/**
 * Embedding Profiles Repository
 *
 * Backend-agnostic repository for EmbeddingProfile entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { EmbeddingProfile, EmbeddingProfileSchema } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';

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
   * Find embedding profile by name for a specific user
   */
  async findByName(userId: string, name: string): Promise<EmbeddingProfile | null> {
    return this.safeQuery(
      async () => {
        const profile = await this.findOneByFilter({
          userId,
          name,
        });

        if (!profile) {
          return null;
        }
        return profile;
      },
      'Error finding embedding profile by name',
      { userId, name },
      null
    );
  }

  /**
   * Find default embedding profile for user
   */
  async findDefault(userId: string): Promise<EmbeddingProfile | null> {
    return this.safeQuery(
      async () => {
        const profile = await this.findOneByFilter({
          userId,
          isDefault: true,
        });

        if (!profile) {
          return null;
        }
        return profile;
      },
      'Error finding default embedding profile',
      { userId },
      null
    );
  }

  /**
   * Create a new embedding profile
   */
  async create(
    data: Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<EmbeddingProfile> {
    return this.safeQuery(
      async () => {
        const profile = await this._create(data, options);

        logger.info('Embedding profile created successfully', {
          profileId: profile.id,
          userId: data.userId,
          name: data.name,
          provider: data.provider,
        });

        return profile;
      },
      'Error creating embedding profile',
      { userId: data.userId, name: data.name, provider: data.provider }
    );
  }

  /**
   * Update an embedding profile
   */
  async update(id: string, data: Partial<EmbeddingProfile>): Promise<EmbeddingProfile | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error updating embedding profile',
      { profileId: id }
    );
  }

  /**
   * Delete an embedding profile
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Embedding profile deleted successfully', {
            profileId: id,
          });
        }

        return result;
      },
      'Error deleting embedding profile',
      { profileId: id }
    );
  }

  /**
   * Unset all embedding profiles for a user as default
   * Used when setting a new default profile
   */
  async unsetAllDefaults(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.updateMany(
          { userId, isDefault: true },
          { isDefault: false } as Partial<EmbeddingProfile>
        );

        logger.info('All default embedding profiles unset for user', {
          userId,
          modifiedCount: count,
        });

        return count;
      },
      'Error unsetting all default embedding profiles',
      { userId }
    );
  }
}
