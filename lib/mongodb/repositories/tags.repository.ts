/**
 * MongoDB Tags Repository
 *
 * Handles CRUD operations for Tag entities in MongoDB.
 * Provides tag management with case-insensitive search capabilities.
 */

import { logger } from '@/lib/logger';
import { Tag, TagSchema } from '@/lib/schemas/types';
import { MongoBaseRepository, CreateOptions } from './base.repository';

/**
 * MongoDB Tags Repository
 * Implements CRUD operations for tags with the same API as the JSON repository
 */
export class MongoTagsRepository extends MongoBaseRepository<Tag> {
  constructor() {
    super('tags', TagSchema);
  }

  /**
   * Find a tag by ID
   */
  async findById(id: string): Promise<Tag | null> {
    const collection = await this.getCollection();

    try {
      const tag = await collection.findOne({ id });

      if (!tag) {
        logger.debug('Tag not found', { tagId: id });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...tagData } = tag as any;

      const validationResult = this.validateSafe(tagData);
      if (!validationResult.success) {
        logger.warn('Tag validation failed', {
          tagId: id,
          error: validationResult.error,
        });
        return null;
      }

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding tag by ID', {
        tagId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all tags
   */
  async findAll(): Promise<Tag[]> {
    const collection = await this.getCollection();

    try {
      const tags = await collection.find({}).toArray();

      // Map MongoDB documents to Tag objects, removing _id field
      const validatedTags: Tag[] = [];
      for (const tag of tags) {
        const { _id, ...tagData } = tag as any;
        const validationResult = this.validateSafe(tagData);
        if (validationResult.success && validationResult.data) {
          validatedTags.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid tag during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedTags;
    } catch (error) {
      logger.error('Error finding all tags', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find tags by user ID
   */
  async findByUserId(userId: string): Promise<Tag[]> {
    const collection = await this.getCollection();

    try {
      const tags = await collection.find({ userId }).toArray();

      // Map MongoDB documents to Tag objects, removing _id field
      const validatedTags: Tag[] = [];
      for (const tag of tags) {
        const { _id, ...tagData } = tag as any;
        const validationResult = this.validateSafe(tagData);
        if (validationResult.success && validationResult.data) {
          validatedTags.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid tag during findByUserId', {
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedTags;
    } catch (error) {
      logger.error('Error finding tags by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find tag by name (case-insensitive)
   */
  async findByName(userId: string, name: string): Promise<Tag | null> {
    const collection = await this.getCollection();
    const nameLower = name.toLowerCase();

    try {
      const tag = await collection.findOne({
        userId,
        nameLower,
      });

      if (!tag) {
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...tagData } = tag as any;

      const validationResult = this.validateSafe(tagData);
      if (!validationResult.success) {
        logger.warn('Tag validation failed during findByName', {
          userId,
          name,
          error: validationResult.error,
        });
        return null;
      }

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding tag by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const collection = await this.getCollection();
    const id = options?.id || this.generateId();
    const now = this.getCurrentTimestamp();
    const createdAt = options?.createdAt || now;

    try {
      // Auto-generate nameLower from name if not provided
      const nameLower = (data.nameLower || data.name).toLowerCase();

      const tag: Tag = {
        ...data,
        id,
        nameLower,
        quickHide: typeof data.quickHide === 'boolean' ? data.quickHide : false,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(tag);

      // Insert into MongoDB (MongoDB will add _id automatically)
      const result = await collection.insertOne(validated as any);

      logger.info('Tag created successfully', {
        tagId: id,
        userId: data.userId,
        name: data.name,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating tag', {
        userId: data.userId,
        name: data.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a tag
   */
  async update(id: string, data: Partial<Tag>): Promise<Tag | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    try {
      // Prepare update data
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      // If name is being updated, update nameLower as well
      if (data.name) {
        updateData.nameLower = data.name.toLowerCase();
      }

      // Remove id and createdAt to prevent accidental overwrites
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Tag not found during update', {
          tagId: id,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...tagData } = result as any;

      const validationResult = this.validateSafe(tagData);
      if (!validationResult.success) {
        logger.warn('Updated tag validation failed', {
          tagId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Tag updated successfully', {
        tagId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating tag', {
        tagId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a tag
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection();

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Tag not found during delete', {
          tagId: id,
        });
        return false;
      }

      logger.info('Tag deleted successfully', {
        tagId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting tag', {
        tagId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

}
