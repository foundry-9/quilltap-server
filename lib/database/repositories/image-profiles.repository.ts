/**
 * Image Profiles Repository
 *
 * Backend-agnostic repository for ImageProfile entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { ImageProfile, ImageProfileSchema } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';

/**
 * Image Profiles Repository
 * Implements CRUD operations for image profiles with user-scoping, tag support, and default profile management.
 */
export class ImageProfilesRepository extends TaggableBaseRepository<ImageProfile> {
  constructor() {
    super('image_profiles', ImageProfileSchema);
  }

  /**
   * Find image profiles by name for a user
   */
  async findByName(userId: string, name: string): Promise<ImageProfile | null> {
    return this.safeQuery(
      () => this.findOneByFilter({
        userId,
        name,
      }),
      'Error finding image profile by name',
      { userId, name }
    );
  }

  /**
   * Find the default image profile for a user
   */
  async findDefault(userId: string): Promise<ImageProfile | null> {
    return this.safeQuery(
      () => this.findOneByFilter({
        userId,
        isDefault: true,
      }),
      'Error finding default image profile',
      { userId }
    );
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
    return this.safeQuery(
      async () => {
        const profile = await this._create(data, options);

        logger.info('Image profile created successfully', {
          profileId: profile.id,
          userId: data.userId,
          name: data.name,
          provider: data.provider,
        });

        return profile;
      },
      'Error creating image profile',
      { userId: data.userId, name: data.name, provider: data.provider }
    );
  }

  /**
   * Update an image profile
   */
  async update(id: string, data: Partial<ImageProfile>): Promise<ImageProfile | null> {
    return this.safeQuery(
      async () => {
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
      },
      'Error updating image profile',
      { profileId: id }
    );
  }

  /**
   * Delete an image profile
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Image profile deleted successfully', {
            profileId: id,
          });
        }

        return result;
      },
      'Error deleting image profile',
      { profileId: id }
    );
  }

  /**
   * Set all profiles for a user to isDefault=false
   * Used to ensure only one default profile per user
   */
  async unsetAllDefaults(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.updateMany(
          { userId, isDefault: true },
          { isDefault: false } as Partial<ImageProfile>
        );

        logger.info('All default image profiles unset for user', {
          userId,
          modifiedCount: count,
        });

        return count;
      },
      'Error unsetting all default image profiles',
      { userId }
    );
  }
}
