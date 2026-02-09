/**
 * Tags Repository
 *
 * Backend-agnostic repository for Tag entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { Tag, TagSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Tags Repository
 * Implements CRUD operations for tags with user-scoping and case-insensitive search.
 */
export class TagsRepository extends UserOwnedBaseRepository<Tag> {
  constructor() {
    super('tags', TagSchema);
  }

  /**
   * Find a tag by ID
   */
  async findById(id: string): Promise<Tag | null> {
    return this._findById(id);
  }

  /**
   * Find all tags
   */
  async findAll(): Promise<Tag[]> {
    return this._findAll();
  }

  /**
   * Find multiple tags by their IDs in a single query
   * @param ids Array of tag IDs
   * @returns Promise<Tag[]> Array of found tags (may be shorter than input if some IDs don't exist)
   */
  async findByIds(ids: string[]): Promise<Tag[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.safeQuery(
      () => this.findByFilter({ id: { $in: ids } } as QueryFilter),
      'Error finding tags by IDs',
      { idCount: ids.length }
    );
  }

  /**
   * Find tag by name (case-insensitive)
   */
  async findByName(userId: string, name: string): Promise<Tag | null> {
    const nameLower = name.toLowerCase();

    return this.safeQuery(
      () => this.findOneByFilter({
        userId,
        nameLower,
      } as QueryFilter),
      'Error finding tag by name',
      { userId, name }
    );
  }

  /**
   * Create a new tag
   * @param data The tag data
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Tag> {
    return this.safeQuery(
      async () => {
        // Auto-generate nameLower from name if not provided
        const nameLower = (data.nameLower || data.name).toLowerCase();
        const quickHide = typeof data.quickHide === 'boolean' ? data.quickHide : false;

        const tagData = {
          ...data,
          nameLower,
          quickHide,
        };

        const tag = await this._create(tagData, options);

        logger.info('Tag created successfully', {
          tagId: tag.id,
          userId: data.userId,
          name: data.name,
        });

        return tag;
      },
      'Error creating tag',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a tag
   */
  async update(id: string, data: Partial<Tag>): Promise<Tag | null> {
    return this.safeQuery(
      async () => {
        // If name is being updated, update nameLower as well
        const updateData = { ...data };
        if (data.name) {
          updateData.nameLower = data.name.toLowerCase();
        }

        // Remove id and createdAt to prevent accidental overwrites
        delete updateData.id;
        delete updateData.createdAt;

        const tag = await this._update(id, updateData);

        if (tag) {
          logger.info('Tag updated successfully', { tagId: id });
        }

        return tag;
      },
      'Error updating tag',
      { tagId: id }
    );
  }

  /**
   * Delete a tag
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Tag deleted successfully', { tagId: id });
        }

        return result;
      },
      'Error deleting tag',
      { tagId: id }
    );
  }
}
