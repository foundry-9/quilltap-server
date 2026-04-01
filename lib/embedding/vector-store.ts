/**
 * Vector Store
 * Sprint 4: Vector Database Integration
 *
 * In-memory vector store with database persistence for semantic search.
 * Uses cosine similarity for nearest neighbor search.
 *
 * Design decisions:
 * - Per-character vector indices for isolation and efficient loading
 * - In-memory search with persistence (suitable for <1000 memories per character)
 * - Cosine similarity for text embedding comparison
 * - Normalized BLOB storage: each embedding stored as a Float32 BLOB row
 * - Incremental persistence: only changed entries written on save()
 */

import { cosineSimilarity } from './embedding-service'
import { getVectorIndicesRepository } from '@/lib/database/repositories/vector-indices.repository'
import { logger } from '@/lib/logger'

/**
 * Metadata associated with a vector entry
 */
export interface VectorMetadata {
  /** Memory ID this vector belongs to */
  memoryId: string
  /** Character ID for filtering */
  characterId: string
  /** Additional metadata */
  [key: string]: unknown
}

/**
 * A single entry in the vector store
 */
export interface VectorEntry {
  /** Unique identifier (typically the memory ID) */
  id: string
  /** The embedding vector */
  embedding: number[]
  /** Associated metadata */
  metadata: VectorMetadata
  /** When this entry was created */
  createdAt: string
}

/**
 * Result of a vector search
 */
export interface VectorSearchResult {
  /** The matched entry ID */
  id: string
  /** Cosine similarity score (0-1, higher is more similar) */
  score: number
  /** Associated metadata */
  metadata: VectorMetadata
}

/**
 * Interface for vector store implementations
 */
export interface ICharacterVectorStore {
  load(): Promise<void>
  save(): Promise<void>
  addVector(id: string, embedding: number[], metadata: VectorMetadata): Promise<void>
  removeVector(id: string): Promise<boolean>
  updateVector(id: string, embedding: number[]): Promise<boolean>
  hasVector(id: string): boolean
  readonly size: number
  getDimensions(): number | null
  search(queryEmbedding: number[], limit?: number, filter?: (metadata: VectorMetadata) => boolean): VectorSearchResult[]
  getAllEntries(): VectorEntry[]
  clear(): void
}

/**
 * Database-backed vector store for a single character
 * Uses in-memory storage with incremental database persistence
 */
export class CharacterVectorStore implements ICharacterVectorStore {
  private entries: Map<string, VectorEntry> = new Map()
  private dimensions: number | null = null
  private createdAt: string = new Date().toISOString()

  // Granular dirty tracking for incremental persistence
  private addedIds: Set<string> = new Set()
  private removedIds: Set<string> = new Set()
  private updatedIds: Set<string> = new Set()

  constructor(private readonly characterId: string) {}

  /**
   * Load the vector index from the database
   */
  async load(): Promise<void> {
    try {
      const repo = getVectorIndicesRepository()
      const meta = await repo.findMetaByCharacterId(this.characterId)
      const entryRows = await repo.findEntriesByCharacterId(this.characterId)

      this.entries.clear()
      for (const row of entryRows) {
        this.entries.set(row.id, {
          id: row.id,
          embedding: row.embedding,
          metadata: {
            memoryId: row.id,
            characterId: row.characterId,
          },
          createdAt: row.createdAt,
        })
      }

      if (meta) {
        this.dimensions = meta.dimensions
        this.createdAt = meta.createdAt
      } else {
        this.dimensions = entryRows.length > 0 ? entryRows[0].embedding.length : null
      }

      this.addedIds.clear()
      this.removedIds.clear()
      this.updatedIds.clear()

    } catch (error) {
      logger.error('Error loading vector index from database', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Start fresh on error
      this.entries.clear()
      this.dimensions = null
      this.addedIds.clear()
      this.removedIds.clear()
      this.updatedIds.clear()
    }
  }

  /**
   * Save changed entries to the database (incremental)
   */
  async save(): Promise<void> {
    const hasChanges = this.addedIds.size > 0 || this.removedIds.size > 0 || this.updatedIds.size > 0
    if (!hasChanges && this.entries.size === 0) {
      return // Nothing to save
    }

    try {
      const repo = getVectorIndicesRepository()

      // Batch insert added entries
      if (this.addedIds.size > 0) {
        const newEntries = Array.from(this.addedIds)
          .map(id => this.entries.get(id))
          .filter((e): e is VectorEntry => e !== undefined)
          .map(e => ({
            id: e.id,
            characterId: this.characterId,
            embedding: e.embedding,
          }))

        if (newEntries.length > 0) {
          await repo.addEntries(newEntries)
        }
      }

      // Batch delete removed entries
      if (this.removedIds.size > 0) {
        await repo.removeEntries(Array.from(this.removedIds))
      }

      // Batch update changed embeddings
      if (this.updatedIds.size > 0) {
        for (const id of this.updatedIds) {
          const entry = this.entries.get(id)
          if (entry) {
            await repo.updateEntryEmbedding(id, entry.embedding)
          }
        }
      }

      // Save meta (always update to keep updatedAt current)
      if (hasChanges) {
        await repo.saveMeta(this.characterId, this.dimensions || 0)
      }

      // Clear tracking sets
      this.addedIds.clear()
      this.removedIds.clear()
      this.updatedIds.clear()

    } catch (error) {
      logger.error('Error saving vector index to database', {
        context: 'CharacterVectorStore.save',
        characterId: this.characterId,
        added: this.addedIds.size,
        removed: this.removedIds.size,
        updated: this.updatedIds.size,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Add a vector to the store
   */
  async addVector(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void> {
    // Validate dimensions
    if (this.dimensions !== null && embedding.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      )
    }

    if (this.dimensions === null) {
      this.dimensions = embedding.length
    }

    const entry: VectorEntry = {
      id,
      embedding,
      metadata,
      createdAt: new Date().toISOString(),
    }

    this.entries.set(id, entry)
    this.addedIds.add(id)
    // If it was previously removed, cancel the removal
    this.removedIds.delete(id)
  }

  /**
   * Remove a vector from the store
   */
  async removeVector(id: string): Promise<boolean> {
    const deleted = this.entries.delete(id)
    if (deleted) {
      // If it was just added (not yet persisted), just un-add it
      if (this.addedIds.has(id)) {
        this.addedIds.delete(id)
      } else {
        this.removedIds.add(id)
      }
      this.updatedIds.delete(id)
    }
    return deleted
  }

  /**
   * Update a vector's embedding
   */
  async updateVector(id: string, embedding: number[]): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry) {
      return false
    }

    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      )
    }

    entry.embedding = embedding
    // Only track as updated if it was already persisted (not just added)
    if (!this.addedIds.has(id)) {
      this.updatedIds.add(id)
    }
    return true
  }

  /**
   * Check if a vector exists
   */
  hasVector(id: string): boolean {
    return this.entries.has(id)
  }

  /**
   * Get the number of vectors stored
   */
  get size(): number {
    return this.entries.size
  }

  /**
   * Get the embedding dimensions
   */
  getDimensions(): number | null {
    return this.dimensions
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  search(
    queryEmbedding: number[],
    limit: number = 10,
    filter?: (metadata: VectorMetadata) => boolean
  ): VectorSearchResult[] {
    if (this.entries.size === 0) {
      return []
    }

    // Validate query dimensions
    if (this.dimensions !== null && queryEmbedding.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${queryEmbedding.length}`
      )
    }

    const results: VectorSearchResult[] = []

    for (const entry of this.entries.values()) {
      // Apply filter if provided
      if (filter && !filter(entry.metadata)) {
        continue
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding)
      results.push({
        id: entry.id,
        score,
        metadata: entry.metadata,
      })
    }

    // Sort by score (descending) and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get all entries (for debugging/export)
   */
  getAllEntries(): VectorEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * Clear all entries
   */
  clear(): void {
    // Mark all existing entries as removed (if they were persisted)
    for (const id of this.entries.keys()) {
      if (!this.addedIds.has(id)) {
        this.removedIds.add(id)
      }
    }
    this.entries.clear()
    this.dimensions = null
    this.addedIds.clear()
    this.updatedIds.clear()
  }
}

/**
 * Global vector store manager
 * Handles loading and caching of per-character vector stores
 */
export class VectorStoreManager {
  private stores: Map<string, ICharacterVectorStore> = new Map()

  constructor() {

  }

  /**
   * Get or create a vector store for a character
   */
  async getStore(characterId: string): Promise<ICharacterVectorStore> {
    let store = this.stores.get(characterId)

    if (!store) {
      store = new CharacterVectorStore(characterId)
      await store.load()
      this.stores.set(characterId, store)
    }

    return store
  }

  /**
   * Save all dirty stores
   */
  async saveAll(): Promise<void> {
    const savePromises: Promise<void>[] = []

    for (const store of this.stores.values()) {
      savePromises.push(store.save())
    }

    await Promise.all(savePromises)
  }

  /**
   * Save a specific character's store
   */
  async saveStore(characterId: string): Promise<void> {
    const store = this.stores.get(characterId)
    if (store) {
      await store.save()
    }
  }

  /**
   * Remove a character's store from cache (doesn't delete from storage)
   */
  unloadStore(characterId: string): boolean {
    return this.stores.delete(characterId)
  }

  /**
   * Delete a character's vector index entirely
   */
  async deleteStore(characterId: string): Promise<boolean> {
    this.stores.delete(characterId)

    const repo = getVectorIndicesRepository()
    return repo.deleteByCharacterId(characterId)
  }

  /**
   * Get stats about loaded stores
   */
  getStats(): { loadedStores: number; totalVectors: number } {
    let totalVectors = 0
    for (const store of this.stores.values()) {
      totalVectors += store.size
    }

    return {
      loadedStores: this.stores.size,
      totalVectors,
    }
  }
}

// Singleton instance
let vectorStoreManager: VectorStoreManager | null = null

/**
 * Get the global vector store manager instance
 */
export function getVectorStoreManager(): VectorStoreManager {
  if (!vectorStoreManager) {
    vectorStoreManager = new VectorStoreManager()
  }
  return vectorStoreManager
}

/**
 * Convenience function to get a character's vector store
 */
export async function getCharacterVectorStore(
  characterId: string
): Promise<ICharacterVectorStore> {
  const manager = getVectorStoreManager()
  return manager.getStore(characterId)
}
