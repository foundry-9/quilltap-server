/**
 * MongoDB Base Repository
 *
 * Abstract base class for all MongoDB-backed repositories.
 * Provides common patterns for CRUD operations on MongoDB collections.
 */

import { Collection } from 'mongodb';
import { z } from 'zod';
import { getMongoDatabase } from '../client';
import { logger } from '@/lib/logger';

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
 * Base repository with common methods for MongoDB
 */
export abstract class MongoBaseRepository<T> {
  protected collectionName: string;
  protected schema: z.ZodType;

  constructor(collectionName: string, schema: z.ZodType) {
    this.collectionName = collectionName;
    this.schema = schema;
  }

  /**
   * Get MongoDB collection instance
   */
  protected async getCollection(): Promise<Collection> {
    try {
      const db = await getMongoDatabase();
      return db.collection(this.collectionName);
    } catch (error) {
      logger.error('Failed to get MongoDB collection', {
        collection: this.collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
  protected validateSafe(data: unknown): { success: boolean; data?: T; error?: string } {
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

  /**
   * Abstract methods that subclasses must implement
   */
  abstract findById(id: string): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T | null>;
  abstract delete(id: string): Promise<boolean>;

  /**
   * Create or update an entity by ID.
   * Used for sync operations where the ID is known (from remote instance).
   * If entity exists, updates it. If not, creates it with the specified ID.
   *
   * @param id The entity ID
   * @param data The entity data
   * @param options Options including original createdAt timestamp
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
}
