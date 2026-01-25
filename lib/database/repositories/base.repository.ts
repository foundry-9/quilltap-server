/**
 * Abstract Base Repository
 *
 * Backend-agnostic base class for repositories that works with
 * SQLite through the database abstraction layer.
 */

import { z } from 'zod';
import { DatabaseCollection, QueryFilter, QueryOptions, UpdateSpec, BaseEntity } from '../interfaces';
import { getDatabaseAsync, ensureCollection } from '../manager';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating entities with pre-specified values.
 * Used by sync to preserve original IDs and timestamps from remote instances.
 */
export interface CreateOptions {
  /** Pre-specified ID (for sync - use remote ID instead of generating new) */
  id?: string;
  /** Preserve original createdAt timestamp (for sync) */
  createdAt?: string;
}

/**
 * Validation result
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================================
// Abstract Base Repository
// ============================================================================

/**
 * Abstract base repository providing common CRUD operations
 * that work with any database backend.
 */
export abstract class AbstractBaseRepository<T extends BaseEntity> {
  protected readonly collectionName: string;
  protected readonly schema: z.ZodType;
  private collectionInitialized = false;

  constructor(collectionName: string, schema: z.ZodType) {
    this.collectionName = collectionName;
    this.schema = schema;
  }

  /**
   * Get the collection instance
   */
  protected async getCollection(): Promise<DatabaseCollection<T>> {
    // Ensure collection exists on first access
    if (!this.collectionInitialized) {
      try {
        await ensureCollection(this.collectionName, this.schema);
        this.collectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure collection exists', {
          collection: this.collectionName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const db = await getDatabaseAsync();
    return db.getCollection<T>(this.collectionName);
  }

  /**
   * Validate data against schema
   */
  protected validate(data: unknown): T {
    try {
      const validated = this.schema.parse(data) as T;
      return validated;
    } catch (error) {
      logger.error('Data validation failed', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Safely validate without throwing
   */
  protected validateSafe(data: unknown): ValidationResult<T> {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('Safe validation failed', {
        collection: this.collectionName,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  protected generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO-8601 timestamp
   */
  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  // ============================================================================
  // Abstract Methods (required implementations)
  // ============================================================================

  /**
   * Find entity by ID
   */
  abstract findById(id: string): Promise<T | null>;

  /**
   * Find all entities
   */
  abstract findAll(): Promise<T[]>;

  /**
   * Create a new entity
   */
  abstract create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T>;

  /**
   * Update an entity
   */
  abstract update(id: string, data: Partial<T>): Promise<T | null>;

  /**
   * Delete an entity
   */
  abstract delete(id: string): Promise<boolean>;

  // ============================================================================
  // Common Implementations
  // ============================================================================

  /**
   * Find entity by ID (default implementation)
   */
  protected async _findById(id: string): Promise<T | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id } as QueryFilter);

      if (!result) {
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding entity by ID', {
        collection: this.collectionName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all entities (default implementation)
   */
  protected async _findAll(): Promise<T[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({});

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((item): item is T => item !== null);
    } catch (error) {
      logger.error('Error finding all entities', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find entities by filter
   */
  protected async findByFilter(filter: QueryFilter, options?: QueryOptions): Promise<T[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find(filter, options);

      return results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((item): item is T => item !== null);
    } catch (error) {
      logger.error('Error finding entities by filter', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find single entity by filter
   */
  protected async findOneByFilter(filter: QueryFilter): Promise<T | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne(filter);

      if (!result) {
        return null;
      }

      return this.validate(result);
    } catch (error) {
      logger.error('Error finding entity by filter', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create entity (default implementation)
   */
  protected async _create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T> {
    try {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const entityInput = {
        ...data,
        id,
        createdAt,
        updatedAt: now,
      };

      const validated = this.validate(entityInput);
      const collection = await this.getCollection();
      await collection.insertOne(validated);

      logger.info('Entity created', {
        collection: this.collectionName,
        id,
      });

      return validated;
    } catch (error) {
      logger.error('Error creating entity', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update entity (default implementation)
   */
  protected async _update(id: string, data: Partial<T>): Promise<T | null> {
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Entity not found for update', {
          collection: this.collectionName,
          id,
        });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      } as T;

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      await collection.updateOne(
        { id } as QueryFilter,
        { $set: validated } as UpdateSpec<T>
      );
      return validated;
    } catch (error) {
      logger.error('Error updating entity', {
        collection: this.collectionName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete entity (default implementation)
   */
  protected async _delete(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id } as QueryFilter);

      if (result.deletedCount === 0) {
        logger.warn('Entity not found for deletion', {
          collection: this.collectionName,
          id,
        });
        return false;
      }

      logger.info('Entity deleted', {
        collection: this.collectionName,
        id,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting entity', {
        collection: this.collectionName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create or update an entity by ID.
   * Used for sync operations where the ID is known.
   */
  async createOrUpdate(
    id: string,
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { createdAt?: string }
  ): Promise<T> {
    const existing = await this.findById(id);
    if (existing) {
      const updated = await this.update(id, data as Partial<T>);
      if (!updated) {
        throw new Error(`Failed to update entity ${id}`);
      }
      return updated;
    }
    return this.create(data, { id, createdAt: options?.createdAt });
  }

  /**
   * Count entities matching a filter
   */
  async count(filter?: QueryFilter): Promise<number> {
    try {
      const collection = await this.getCollection();
      return collection.countDocuments(filter);
    } catch (error) {
      logger.error('Error counting entities', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Check if an entity exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      return collection.exists({ id } as QueryFilter);
    } catch (error) {
      logger.error('Error checking entity existence', {
        collection: this.collectionName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Delete multiple entities matching a filter
   */
  protected async deleteMany(filter: QueryFilter): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany(filter);

      logger.info('Entities deleted', {
        collection: this.collectionName,
        count: result.deletedCount,
      });

      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting entities', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update multiple entities matching a filter
   */
  protected async updateMany(filter: QueryFilter, update: Partial<T>): Promise<number> {
    try {
      const collection = await this.getCollection();
      const result = await collection.updateMany(
        filter,
        {
          $set: {
            ...update,
            updatedAt: this.getCurrentTimestamp(),
          },
        } as UpdateSpec<T>
      );
      return result.modifiedCount;
    } catch (error) {
      logger.error('Error updating entities', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// ============================================================================
// User-Owned Base Repository
// ============================================================================

import { UserOwnedEntity } from '../interfaces';

/**
 * Base repository for user-owned entities
 */
export abstract class UserOwnedBaseRepository<T extends UserOwnedEntity> extends AbstractBaseRepository<T> {
  /**
   * Find entities by user ID
   */
  async findByUserId(userId: string): Promise<T[]> {
    return this.findByFilter({ userId } as QueryFilter);
  }

  /**
   * Find entities by multiple IDs
   */
  async findByIds(ids: string[]): Promise<T[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.findByFilter({ id: { $in: ids } } as QueryFilter);
  }
}

// ============================================================================
// Taggable Base Repository
// ============================================================================

import { TaggableEntity } from '../interfaces';

/**
 * Base repository for taggable entities
 */
export abstract class TaggableBaseRepository<T extends TaggableEntity> extends UserOwnedBaseRepository<T> {
  /**
   * Find entities by tag ID
   */
  async findByTag(tagId: string): Promise<T[]> {
    return this.findByFilter({ tags: { $in: [tagId] } } as QueryFilter);
  }

  /**
   * Add a tag to an entity
   */
  async addTag(entityId: string, tagId: string): Promise<T | null> {
    try {
      const entity = await this.findById(entityId);
      if (!entity) {
        logger.warn('Entity not found for tag addition', {
          collection: this.collectionName,
          entityId,
        });
        return null;
      }

      if (!entity.tags.includes(tagId)) {
        entity.tags.push(tagId);
        return await this.update(entityId, { tags: entity.tags } as Partial<T>);
      }
      return entity;
    } catch (error) {
      logger.error('Error adding tag to entity', {
        collection: this.collectionName,
        entityId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from an entity
   */
  async removeTag(entityId: string, tagId: string): Promise<T | null> {
    try {
      const entity = await this.findById(entityId);
      if (!entity) {
        logger.warn('Entity not found for tag removal', {
          collection: this.collectionName,
          entityId,
        });
        return null;
      }

      const beforeCount = entity.tags.length;
      entity.tags = entity.tags.filter((id) => id !== tagId);
      const afterCount = entity.tags.length;

      if (beforeCount !== afterCount) {
        return await this.update(entityId, { tags: entity.tags } as Partial<T>);
      }
      return entity;
    } catch (error) {
      logger.error('Error removing tag from entity', {
        collection: this.collectionName,
        entityId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
