/**
 * Vector Indices Repository (Normalized BLOB Storage)
 *
 * Manages two tables for vector storage:
 * - `vector_indices`: Per-character metadata (id, characterId, version, dimensions, timestamps)
 * - `vector_entries`: Per-embedding rows with Float32 BLOB storage
 *
 * Embeddings are stored as compact Float32 BLOBs (~4x smaller than JSON text).
 * The `memories.embedding` column also uses BLOB storage via registered blob columns.
 */

import { logger } from '@/lib/logger';
import {
  VectorIndexMeta, VectorIndexMetaSchema,
  VectorEntryRow, VectorEntryRowSchema,
} from '@/lib/schemas/types';
import { getDatabaseAsync, ensureCollection, registerBlobColumns } from '../manager';
import { DatabaseCollection, TypedQueryFilter, UpdateSpec } from '../interfaces';

// ============================================================================
// Repository Class
// ============================================================================

export class VectorIndicesRepository {
  private initialized = false;

  /**
   * Ensure both tables exist and blob columns are registered.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Ensure vector_indices table (metadata)
    await ensureCollection('vector_indices', VectorIndexMetaSchema);

    // Ensure vector_entries table (per-embedding rows)
    await ensureCollection('vector_entries', VectorEntryRowSchema);

    // Register BLOB columns
    await registerBlobColumns('vector_entries', ['embedding']);
    await registerBlobColumns('memories', ['embedding']);

    this.initialized = true;
  }

  /**
   * Get the vector_indices collection (metadata table)
   */
  private async getMetaCollection(): Promise<DatabaseCollection<VectorIndexMeta>> {
    await this.ensureInitialized();
    const db = await getDatabaseAsync();
    return db.getCollection<VectorIndexMeta>('vector_indices');
  }

  /**
   * Get the vector_entries collection (per-embedding table)
   */
  private async getEntriesCollection(): Promise<DatabaseCollection<VectorEntryRow>> {
    await this.ensureInitialized();
    const db = await getDatabaseAsync();
    return db.getCollection<VectorEntryRow>('vector_entries');
  }

  // ==========================================================================
  // Meta Operations (vector_indices table)
  // ==========================================================================

  /**
   * Find metadata for a character's vector index
   */
  async findMetaByCharacterId(characterId: string): Promise<VectorIndexMeta | null> {
    try {
      const collection = await this.getMetaCollection();
      return await collection.findOne({ characterId } as TypedQueryFilter<VectorIndexMeta>);
    } catch (error) {
      logger.error('Error finding vector index meta', {
        context: 'VectorIndicesRepository.findMetaByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Save metadata for a character's vector index (upsert)
   */
  async saveMeta(characterId: string, dimensions: number): Promise<void> {
    try {
      const collection = await this.getMetaCollection();
      const now = new Date().toISOString();
      const existing = await this.findMetaByCharacterId(characterId);

      if (existing) {
        await collection.updateOne(
          { id: existing.id } as TypedQueryFilter<VectorIndexMeta>,
          { $set: { dimensions, updatedAt: now } } as UpdateSpec<VectorIndexMeta>
        );
      } else {
        await collection.insertOne({
          id: characterId,
          characterId,
          version: 1,
          dimensions,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (error) {
      logger.error('Error saving vector index meta', {
        context: 'VectorIndicesRepository.saveMeta',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete metadata for a character
   */
  async deleteMetaByCharacterId(characterId: string): Promise<boolean> {
    try {
      const collection = await this.getMetaCollection();
      const result = await collection.deleteMany({ characterId } as TypedQueryFilter<VectorIndexMeta>);
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Error deleting vector index meta', {
        context: 'VectorIndicesRepository.deleteMetaByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ==========================================================================
  // Entry Operations (vector_entries table)
  // ==========================================================================

  /**
   * Find all entries for a character
   */
  async findEntriesByCharacterId(characterId: string): Promise<VectorEntryRow[]> {
    try {
      const collection = await this.getEntriesCollection();
      return await collection.find({ characterId } as TypedQueryFilter<VectorEntryRow>);
    } catch (error) {
      logger.error('Error finding vector entries', {
        context: 'VectorIndicesRepository.findEntriesByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Add a single entry
   */
  async addEntry(entry: { id: string; characterId: string; embedding: Float32Array }): Promise<void> {
    try {
      const collection = await this.getEntriesCollection();
      await collection.insertOne({
        id: entry.id,
        characterId: entry.characterId,
        embedding: entry.embedding,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error adding vector entry', {
        context: 'VectorIndicesRepository.addEntry',
        id: entry.id,
        characterId: entry.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add multiple entries in a batch
   */
  async addEntries(entries: { id: string; characterId: string; embedding: Float32Array }[]): Promise<void> {
    if (entries.length === 0) return;

    try {
      const collection = await this.getEntriesCollection();
      const now = new Date().toISOString();
      const rows = entries.map(e => ({
        id: e.id,
        characterId: e.characterId,
        embedding: e.embedding,
        createdAt: now,
      }));
      await collection.insertMany(rows);
    } catch (error) {
      logger.error('Error batch adding vector entries', {
        context: 'VectorIndicesRepository.addEntries',
        count: entries.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a single entry by ID
   */
  async removeEntry(id: string): Promise<boolean> {
    try {
      const collection = await this.getEntriesCollection();
      const result = await collection.deleteOne({ id } as TypedQueryFilter<VectorEntryRow>);
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Error removing vector entry', {
        context: 'VectorIndicesRepository.removeEntry',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Remove multiple entries by IDs
   */
  async removeEntries(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    try {
      const collection = await this.getEntriesCollection();
      let removed = 0;
      for (const id of ids) {
        const result = await collection.deleteOne({ id } as TypedQueryFilter<VectorEntryRow>);
        removed += result.deletedCount;
      }
      return removed;
    } catch (error) {
      logger.error('Error batch removing vector entries', {
        context: 'VectorIndicesRepository.removeEntries',
        count: ids.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Update an entry's embedding
   */
  async updateEntryEmbedding(id: string, embedding: Float32Array): Promise<boolean> {
    try {
      const collection = await this.getEntriesCollection();
      const result = await collection.updateOne(
        { id } as TypedQueryFilter<VectorEntryRow>,
        { $set: { embedding } } as UpdateSpec<VectorEntryRow>
      );
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Error updating vector entry embedding', {
        context: 'VectorIndicesRepository.updateEntryEmbedding',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Remove all entries for a character
   */
  async removeEntriesByCharacterId(characterId: string): Promise<number> {
    try {
      const collection = await this.getEntriesCollection();
      const result = await collection.deleteMany({ characterId } as TypedQueryFilter<VectorEntryRow>);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error removing all vector entries for character', {
        context: 'VectorIndicesRepository.removeEntriesByCharacterId',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Check if an entry exists
   */
  async entryExists(id: string): Promise<boolean> {
    try {
      const collection = await this.getEntriesCollection();
      return await collection.exists({ id } as TypedQueryFilter<VectorEntryRow>);
    } catch (error) {
      logger.error('Error checking vector entry existence', {
        context: 'VectorIndicesRepository.entryExists',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ==========================================================================
  // Combined Operations
  // ==========================================================================

  /**
   * Delete a character's vector index entirely (meta + entries)
   */
  async deleteByCharacterId(characterId: string): Promise<boolean> {
    try {
      const entriesRemoved = await this.removeEntriesByCharacterId(characterId);
      const metaDeleted = await this.deleteMetaByCharacterId(characterId);

      logger.info('Vector index deleted for character', {
        context: 'VectorIndicesRepository.deleteByCharacterId',
        characterId,
        entriesRemoved,
        metaDeleted,
      });

      return metaDeleted || entriesRemoved > 0;
    } catch (error) {
      logger.error('Error deleting vector index for character', {
        context: 'VectorIndicesRepository.deleteByCharacterId',
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
      const collection = await this.getMetaCollection();
      const metas = await collection.find({});
      return metas.map(m => m.characterId);
    } catch (error) {
      logger.error('Error getting all character IDs', {
        context: 'VectorIndicesRepository.getAllCharacterIds',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: VectorIndicesRepository | null = null;

export function getVectorIndicesRepository(): VectorIndicesRepository {
  // In the forked job-runner child, return the proxied vectorIndices from
  // the main repository container. Without this, callers like
  // `CharacterVectorStore.save()` would talk to the unwrapped repository
  // and try to write to the readonly DB connection — bypassing the
  // proxy's batched-writes mechanism entirely.
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { getRepositories } = require('@/lib/repositories/factory') as
      typeof import('@/lib/repositories/factory');
    return getRepositories().vectorIndices as unknown as VectorIndicesRepository;
  }

  if (!instance) {
    instance = new VectorIndicesRepository();
  }
  return instance;
}
