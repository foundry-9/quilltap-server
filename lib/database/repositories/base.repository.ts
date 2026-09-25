/**
 * Abstract Base Repository
 *
 * Backend-agnostic base class for repositories that works with
 * SQLite through the database abstraction layer.
 */

import { z } from 'zod';
import { DatabaseCollection, TypedQueryFilter, QueryOptions, UpdateSpec, BaseEntity } from '../interfaces';
import { getDatabaseAsync, ensureCollection } from '../manager';
import { logger } from '@/lib/logger';
import { escapeRegex } from '@/lib/utils/regex';
import { safeQuery as standaloneSafeQuery, extractErrorMessage } from './safe-query';

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
  /** Preserve original createdAt timestamp (for sync, batch extraction) */
  createdAt?: string;
  /** Preserve original updatedAt timestamp (for batch extraction when updatedAt should match createdAt) */
  updatedAt?: string;
}

/**
 * Validation result
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Which SQLite database a repository's rows live in. The main database is
 * the default; a repository on one of the dedicated databases extends
 * `AbstractDedicatedDbRepository` (`./dedicated-db.repository`) and says so
 * here. The background-job applier partitions a child's buffered writes by
 * this same set of targets (`lib/background-jobs/host/write-partition.ts`).
 */
export type RepositoryDbTarget = 'main' | 'mountIndex' | 'llmLogs';

// ============================================================================
// Abstract Base Repository
// ============================================================================

/**
 * Abstract base repository providing common CRUD operations
 * that work with any database backend.
 */
export abstract class AbstractBaseRepository<T extends BaseEntity> {
  /** The database this repository's table lives in. */
  readonly dbTarget: RepositoryDbTarget = 'main';
  protected readonly collectionName: string;
  protected readonly schema: z.ZodType;
  private collectionInitialized = false;

  constructor(collectionName: string, schema: z.ZodType) {
    this.collectionName = collectionName;
    this.schema = schema;
  }

  /**
   * Execute an async operation with standardized error handling.
   * Auto-injects `collection: this.collectionName` into the context.
   *
   * @overload Rethrow mode — no fallback argument; logs then re-throws.
   */
  protected async safeQuery<R>(
    operation: () => Promise<R>,
    errorMessage: string,
    context?: Record<string, unknown>
  ): Promise<R>;

  /**
   * @overload Fallback mode — returns `fallback` on error instead of throwing.
   */
  protected async safeQuery<R>(
    operation: () => Promise<R>,
    errorMessage: string,
    context: Record<string, unknown>,
    fallback: R
  ): Promise<R>;

  /**
   * Implementation — delegates to standalone safeQuery with collection injected.
   */
  protected async safeQuery<R>(
    operation: () => Promise<R>,
    errorMessage: string,
    context: Record<string, unknown> = {},
    ...rest: [] | [R]
  ): Promise<R> {
    const enrichedContext = { collection: this.collectionName, ...context };
    if (rest.length > 0) {
      return standaloneSafeQuery(operation, errorMessage, enrichedContext, rest[0] as R);
    }
    return standaloneSafeQuery(operation, errorMessage, enrichedContext);
  }

  /**
   * Get the collection instance
   */
  protected async getCollection(): Promise<DatabaseCollection<T>> {
    // Ensure collection exists on first access
    if (!this.collectionInitialized) {
      await this.safeQuery(
        async () => {
          await ensureCollection(this.collectionName, this.schema);
          this.collectionInitialized = true;
        },
        'Failed to ensure collection exists',
      );
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
        error: extractErrorMessage(error),
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
    return crypto.randomUUID();
  }

  /**
   * Get current ISO-8601 timestamp
   */
  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Escape special regex characters in a string for safe use in RegExp construction
   */
  protected escapeRegex(str: string): string {
    return escapeRegex(str);
  }

  /**
   * Create a filter for a field that may be null.
   * When value is non-null, filters by exact match.
   * When value is null, matches records where the field is null or does not exist.
   */
  protected createNullableFilter<K extends string & keyof T>(field: K, value: string | null): TypedQueryFilter<T> {
    if (value !== null) {
      return { [field]: value } as TypedQueryFilter<T>;
    }
    return { $or: [{ [field]: null } as TypedQueryFilter<T>, { [field]: { $exists: false } } as TypedQueryFilter<T>] } as TypedQueryFilter<T>;
  }

  // ============================================================================
  // Public CRUD (default implementations — subclasses override when they need
  // extra behavior such as logging, overlay application, or input shaping)
  // ============================================================================

  /**
   * Find entity by ID.
   *
   * Default: delegates straight to {@link _findById}. Subclasses override
   * when they need to apply an overlay, hydrate joins, or otherwise post-
   * process the row.
   */
  async findById(id: string): Promise<T | null> {
    return this._findById(id);
  }

  /**
   * Find all entities.
   *
   * Default: delegates straight to {@link _findAll}. Subclasses override
   * when they need filtering, sorting, or overlay application.
   */
  async findAll(): Promise<T[]> {
    return this._findAll();
  }

  /**
   * Create a new entity. Subclasses provide their own implementation —
   * typically a `safeQuery` wrapper that applies defaults, validates, and
   * logs around {@link _create}.
   */
  abstract create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T>;

  /**
   * Update an entity. Subclasses provide their own implementation —
   * typically a `safeQuery` wrapper that logs around {@link _update}.
   */
  abstract update(id: string, data: Partial<T>): Promise<T | null>;

  /**
   * Delete an entity. Subclasses provide their own implementation —
   * typically a `safeQuery` wrapper that logs around {@link _delete}.
   */
  abstract delete(id: string): Promise<boolean>;

  // ============================================================================
  // Common Implementations
  // ============================================================================

  /**
   * Find entity by ID (default implementation)
   */
  protected async _findById(id: string): Promise<T | null> {
    return this.safeQuery(async () => {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id } as TypedQueryFilter<T>);

      if (!result) {
        return null;
      }

      return this.validate(result);
    }, 'Error finding entity by ID', { id }, null);
  }

  /**
   * Find all entities (default implementation)
   */
  protected async _findAll(): Promise<T[]> {
    return this.safeQuery(async () => {
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
    }, 'Error finding all entities', {}, []);
  }

  /**
   * Find entities by filter
   */
  protected async findByFilter(filter: TypedQueryFilter<T>, options?: QueryOptions): Promise<T[]> {
    return this.safeQuery(async () => {
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
    }, 'Error finding entities by filter', {}, []);
  }

  /**
   * Find single entity by filter
   */
  protected async findOneByFilter(filter: TypedQueryFilter<T>): Promise<T | null> {
    return this.safeQuery(async () => {
      const collection = await this.getCollection();
      const result = await collection.findOne(filter);

      if (!result) {
        return null;
      }

      return this.validate(result);
    }, 'Error finding entity by filter', {}, null);
  }

  /**
   * Message safeQuery logs when `_create` fails; subclasses that persist a
   * narrower row name their entity here.
   */
  protected createErrorMessage(): string {
    return 'Error creating entity';
  }

  /**
   * Row transform applied to the validated entity just before INSERT.
   * Subclasses whose table has fewer columns than the schema (vault- or
   * store-resident fields) strip those keys here; `_create` still returns
   * the full validated entity.
   */
  protected toPersistedRow(validated: T): T {
    return validated;
  }

  /**
   * Fields a whole-row `_update` writes only when the caller's patch names
   * them. `_update` rebuilds the row from a snapshot it read a moment earlier,
   * so any schema field it writes back can rewind a newer value written
   * between that read and its own write. A field listed here is left out of
   * the `$set` unless the patch sets it, so an unrelated update (a title, a
   * counter) can never carry a stale copy of it back over a newer one.
   * Default: none.
   */
  protected patchOnlyFields(): readonly string[] {
    return [];
  }

  /**
   * Create entity (default implementation)
   */
  protected async _create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T> {
    return this.safeQuery(async () => {
      const id = options?.id || this.generateId();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;

      const updatedAt = options?.updatedAt || now;

      const entityInput = {
        ...data,
        id,
        createdAt,
        updatedAt,
      };

      const validated = this.validate(entityInput);
      const collection = await this.getCollection();
      await collection.insertOne(this.toPersistedRow(validated));

      logger.info('Entity created', {
        collection: this.collectionName,
        id,
      });

      return validated;
    }, this.createErrorMessage());
  }

  /**
   * Update entity (default implementation)
   */
  protected async _update(id: string, data: Partial<T>): Promise<T | null> {
    return this.safeQuery(async () => {
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
        updatedAt: ('updatedAt' in data) ? (data as Record<string, unknown>).updatedAt : now,
      } as T;

      const validated = this.validate(updated);
      const collection = await this.getCollection();

      // Leave out the patch-only fields the caller did not name, so this
      // write cannot rewind them from the snapshot read above.
      let toSet: Record<string, unknown> = validated as unknown as Record<string, unknown>;
      const skipped = this.patchOnlyFields().filter((field) => !(field in data));
      if (skipped.length > 0) {
        toSet = { ...toSet };
        for (const field of skipped) delete toSet[field];
      }

      await collection.updateOne(
        { id } as TypedQueryFilter<T>,
        { $set: toSet } as UpdateSpec<T>
      );
      return validated;
    }, 'Error updating entity', { id });
  }

  /**
   * Delete entity (default implementation)
   */
  protected async _delete(id: string): Promise<boolean> {
    return this.safeQuery(async () => {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id } as TypedQueryFilter<T>);

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
    }, 'Error deleting entity', { id });
  }

  /**
   * Count entities matching a filter
   *
   * Returns 0 when the query fails, so a caller cannot distinguish "no rows"
   * from "the database was unreachable". Use {@link countOrThrow} when that
   * difference matters.
   */
  async count(filter?: TypedQueryFilter<T>): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return collection.countDocuments(filter);
      },
      'Error counting entities',
      {},
      0,
    );
  }

  /**
   * Count entities matching a filter, throwing if the query fails
   *
   * The emptiness probe for callers that take a destructive branch on "the
   * table is empty" — seeding being the motivating case. `count()` and the
   * `find*` family all collapse an infrastructure failure into `0`/`[]`, which
   * makes a locked or unopenable database indistinguishable from a virgin one.
   * Counting also runs beneath row validation and any document-store overlay,
   * so a row that fails to hydrate still registers as present.
   *
   * @throws whatever the underlying query threw
   */
  async countOrThrow(filter?: TypedQueryFilter<T>): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return collection.countDocuments(filter);
      },
      'Error counting entities (strict)',
      {},
    );
  }

  /**
   * Check if an entity exists
   */
  async exists(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return collection.exists({ id } as TypedQueryFilter<T>);
      },
      'Error checking entity existence',
      { id },
      false,
    );
  }

  /**
   * Delete multiple entities matching a filter
   */
  protected async deleteMany(filter: TypedQueryFilter<T>): Promise<number> {
    return this.safeQuery(async () => {
      const collection = await this.getCollection();
      const result = await collection.deleteMany(filter);

      logger.info('Entities deleted', {
        collection: this.collectionName,
        count: result.deletedCount,
      });

      return result.deletedCount;
    }, 'Error deleting entities');
  }

  /**
   * Update multiple entities matching a filter
   */
  protected async updateMany(filter: TypedQueryFilter<T>, update: Partial<T>): Promise<number> {
    return this.safeQuery(async () => {
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
    }, 'Error updating entities');
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
    return this.findByFilter({ userId } as TypedQueryFilter<T>);
  }

  /**
   * Find entities by multiple IDs
   */
  async findByIds(ids: string[]): Promise<T[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.findByFilter({ id: { $in: ids } } as TypedQueryFilter<T>);
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
    return this.findByFilter({ tags: { $in: [tagId] } } as TypedQueryFilter<T>);
  }

  /**
   * Add a tag to an entity
   */
  async addTag(entityId: string, tagId: string): Promise<T | null> {
    return this.safeQuery(async () => {
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
    }, 'Error adding tag to entity', { entityId, tagId });
  }

  /**
   * Remove a tag from an entity
   */
  async removeTag(entityId: string, tagId: string): Promise<T | null> {
    return this.safeQuery(async () => {
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
    }, 'Error removing tag from entity', { entityId, tagId });
  }
}
