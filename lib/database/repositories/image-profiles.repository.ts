/**
 * Image Profiles Repository
 *
 * Backend-agnostic repository for ImageProfile entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { ImageProfile, ImageProfileSchema } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Image Profiles Repository
 * Implements CRUD operations for image profiles with user-scoping, tag support, and default profile management.
 */
export class ImageProfilesRepository extends TaggableBaseRepository<ImageProfile> {
  constructor() {
    super('image_profiles', ImageProfileSchema);
  }

  /**
   * Find an image profile by ID
   */
  async findById(id: string): Promise<ImageProfile | null> {
    return this._findById(id);
  }

  /**
   * Find all image profiles
   */
  async findAll(): Promise<ImageProfile[]> {
    return this._findAll();
  }

  /**
   * Find image profiles by name for a user
   */
  async findByName(userId: string, name: string): Promise<ImageProfile | null> {
    try {
      const profile = await this.findOneByFilter({
        userId,
        name,
      } as QueryFilter);

      return profile;
    } catch (error) {
      logger.error('Error finding image profile by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find the default image profile for a user
   */
  async findDefault(userId: string): Promise<ImageProfile | null> {
    try {
      const profile = await this.findOneByFilter({
        userId,
        isDefault: true,
      } as QueryFilter);

      return profile;
    } catch (error) {
      logger.error('Error finding default image profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new image profile
   * @param data The image profile data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<ImageProfile, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ImageProfile> {
    try {
      const profile = await this._create(data, options);

      logger.info('Image profile created successfully', {
        profileId: profile.id,
        userId: data.userId,
        name: data.name,
        provider: data.provider,
      });

      return profile;
    } catch (error) {
      logger.error('Error creating image profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an image profile
   */
  async update(id: string, data: Partial<ImageProfile>): Promise<ImageProfile | null> {
    try {
      // Remove id and createdAt to prevent accidental overwrites
      const updateData = { ...data };
      delete updateData.id;
      delete updateData.createdAt;

      const profile = await this._update(id, updateData);

      if (profile) {
        logger.info('Image profile updated successfully', {
          profileId: id,
        });
      }

      return profile;
    } catch (error) {
      logger.error('Error updating image profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an image profile
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);

      if (result) {
        logger.info('Image profile deleted successfully', {
          profileId: id,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting image profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set all profiles for a user to isDefault=false
   * Used to ensure only one default profile per user
   */
  async unsetAllDefaults(userId: string): Promise<number> {
    try {
      const count = await this.updateMany(
        { userId, isDefault: true } as QueryFilter,
        { isDefault: false } as Partial<ImageProfile>
      );

      logger.info('All default image profiles unset for user', {
        userId,
        modifiedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error unsetting all default image profiles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
