/**
 * Vector Indices Repository
 *
 * Backend-agnostic repository for Vector Index entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 *
 * Stores character vector indices (embeddings for semantic search) in a database.
 * Each document represents a complete vector index for a single character.
 */

import { logger } from '@/lib/logger';
import { VectorIndex, VectorIndexSchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Vector Indices Repository
 * Implements CRUD operations for vector indices with character-based lookups.
 */
export class VectorIndicesRepository extends AbstractBaseRepository<VectorIndex> {
  constructor() {
    super('vector_indices', VectorIndexSchema);
  }

  /**
   * Find a vector index by ID
   */
  async findById(id: string): Promise<VectorIndex | null> {
    return this._findById(id);
  }

  /**
   * Find all vector indices
   */
  async findAll(): Promise<VectorIndex[]> {
    return this._findAll();
  }

  /**
   * Find a vector index by character ID
   */
  async findByCharacterId(characterId: string): Promise<VectorIndex | null> {
    try {
      const index = await this.findOneByFilter({ characterId } as QueryFilter);

      if (!index) {
        return null;
      }
      return index;
    } catch (error) {
      logger.error('Error finding vector index by character ID', {
        context: 'VectorIndicesRepository.findByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new vector index
   */
  async create(
    data: Omit<VectorIndex, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<VectorIndex> {
    try {
      const index = await this._create(data, options);

      logger.info('Vector index created', {
        characterId: data.characterId,
        entryCount: index.entries.length,
      });

      return index;
    } catch (error) {
      logger.error('Error creating vector index', {
        context: 'VectorIndicesRepository.create',
        characterId: data.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a vector index
   */
  async update(id: string, data: Partial<VectorIndex>): Promise<VectorIndex | null> {
    try {
      const result = await this._update(id, data);

      if (result) {
      }

      return result;
    } catch (error) {
      logger.error('Error updating vector index', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Save a complete vector index for a character (creates or updates)
   * Uses upsert semantics - completely replaces the index for a character
   */
  async save(characterId: string, index: Omit<VectorIndex, 'id'>): Promise<VectorIndex> {
    try {
      const now = this.getCurrentTimestamp();

      // Try to find existing index by character ID
      const existing = await this.findByCharacterId(characterId);

      if (existing) {
        // Update existing
        const updated = await this.update(existing.id, {
          ...index,
          updatedAt: now,
        });

        if (!updated) {
          throw new Error(`Failed to update vector index for character ${characterId}`);
        }
        return updated;
      } else {
        // Create new
        const doc: Omit<VectorIndex, 'createdAt' | 'updatedAt'> = {
          ...index,
          id: characterId, // Use characterId as the document ID
          characterId,
        };

        const created = await this.create(doc);
        return created;
      }
    } catch (error) {
      logger.error('Error saving vector index', {
        context: 'VectorIndicesRepository.save',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a vector index by ID
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);
      return result;
    } catch (error) {
      logger.error('Error deleting vector index', {
        context: 'VectorIndicesRepository.delete',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a vector index by character ID
   */
  async deleteByCharacterId(characterId: string): Promise<boolean> {
    try {
      const index = await this.findByCharacterId(characterId);
      if (!index) {
        return false;
      }

      return this.delete(index.id);
    } catch (error) {
      logger.error('Error deleting vector index by character ID', {
        context: 'VectorIndicesRepository.deleteByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Check if a vector index exists for a character
   */
  async exists(characterId: string): Promise<boolean> {
    try {
      const index = await this.findByCharacterId(characterId);
      return index !== null;
    } catch (error) {
      logger.error('Error checking vector index existence', {
        context: 'VectorIndicesRepository.exists',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get all character IDs that have vector indices
   */
  async getAllCharacterIds(): Promise<string[]> {
    try {
      const indices = await this.findAll();
      return indices.map((index) => index.characterId);
    } catch (error) {
      logger.error('Error getting all character IDs', {
        context: 'VectorIndicesRepository.getAllCharacterIds',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

// Singleton instance
let instance: VectorIndicesRepository | null = null;

export function getVectorIndicesRepository(): VectorIndicesRepository {
  if (!instance) {
    instance = new VectorIndicesRepository();
  }
  return instance;
}
