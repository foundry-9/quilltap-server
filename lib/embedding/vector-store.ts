/**
 * Vector Store — the in-process cache behind `memoryIndex`
 *
 * One `CharacterVectorStore` per character holds that character's memory
 * vectors in memory for brute-force cosine search. It is a **cache**, never a
 * copy: `memories.embedding` and `memories.tier` are the only stored truth
 * (the `vector_entries` mirror was retired in Phase B of the memory
 * refactor), a store loads them with one query, and nothing here writes the
 * database.
 *
 * Only `lib/memory/index-store/` may import this module (a test greps for any
 * other importer): every write of an embedding or a tier, and every eviction,
 * goes through `memoryIndex`, which writes the row and keeps the cache in step.
 */

import { cosineSimilarity } from './embedding-service'
import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { processSingleton } from '@/lib/utils/process-singleton'

/**
 * Metadata associated with a vector entry
 */
export interface VectorMetadata {
  /** Memory ID this vector belongs to */
  memoryId: string
  /** Character ID for filtering */
  characterId: string
  /**
   * Memory tier, read with the vector from `memories.tier` at
   * {@link CharacterVectorStore.load} and kept in step by `memoryIndex`.
   * Absent reads as hot.
   */
  tier?: 'hot' | 'cold'
  /** Additional metadata */
  [key: string]: unknown
}

/**
 * A single entry in the vector store
 */
export interface VectorEntry {
  /** Unique identifier (typically the memory ID) */
  id: string
  /** The embedding vector (unit-length Float32Array) */
  embedding: Float32Array
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
  /** Insert or replace an entry (in memory only). */
  addVector(id: string, embedding: Float32Array, metadata: VectorMetadata): Promise<void>
  /** Drop an entry (in memory only). */
  removeVector(id: string): Promise<boolean>
  hasVector(id: string): boolean
  /** The cached tier of an entry, or undefined when it is not in the store. */
  tierOf(id: string): 'hot' | 'cold' | undefined
  readonly size: number
  /** The most common vector length in the store, or null when it is empty. */
  getDimensions(): number | null
  /** How many entries have exactly `dimensions` components. */
  countWithDimensions(dimensions: number): number
  search(queryEmbedding: Float32Array, limit?: number, filter?: (metadata: VectorMetadata) => boolean): VectorSearchResult[]
  getAllEntries(): VectorEntry[]
  clear(): void
  /** Re-stamp the tier of entries already in the store (in-memory only). */
  setTier(ids: readonly string[], tier: 'hot' | 'cold'): void
}

/**
 * Search predicate for recall paths that must only see hot memories (frozen
 * archive, dynamic head, proactive search, inter-character). The memory gate
 * and the `search` tool search both tiers and pass no predicate.
 */
export function isHotVector(metadata: VectorMetadata): boolean {
  return metadata.tier !== 'cold'
}

/**
 * The in-memory vector cache for a single character, loaded from its memory
 * rows. Entries of any length are held: a corpus part-way through a re-embed
 * has two, and search scores only the entries whose length matches the query.
 */
export class CharacterVectorStore implements ICharacterVectorStore {
  private entries: Map<string, VectorEntry> = new Map()
  /** Entry count per vector length, so the dominant length is O(distinct lengths). */
  private lengthCounts: Map<number, number> = new Map()

  constructor(private readonly characterId: string) {}

  /**
   * Load the character's vectors and tiers from `memories` (one query). A
   * failed read leaves the store empty — search then finds nothing and recall
   * falls back to text search — rather than throwing into a turn.
   */
  async load(): Promise<void> {
    this.entries.clear()
    this.lengthCounts.clear()
    try {
      const rows = await getRepositories().memories.findIndexRowsByCharacterId(this.characterId)
      const loadedAt = new Date().toISOString()
      let cold = 0
      for (const row of rows) {
        this.put({
          id: row.id,
          embedding: row.embedding,
          metadata: { memoryId: row.id, characterId: this.characterId, tier: row.tier },
          createdAt: loadedAt,
        })
        if (row.tier === 'cold') cold++
      }
      logger.debug('Loaded vector index from memory rows', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
        entries: rows.length,
        cold,
        dimensions: this.getDimensions(),
      })
    } catch (error) {
      logger.error('Error loading vector index from memory rows', {
        context: 'CharacterVectorStore.load',
        characterId: this.characterId,
        error: error instanceof Error ? error.message : String(error),
      })
      this.entries.clear()
      this.lengthCounts.clear()
    }
  }

  private put(entry: VectorEntry): void {
    const previous = this.entries.get(entry.id)
    if (previous) this.uncount(previous.embedding.length)
    this.entries.set(entry.id, entry)
    this.lengthCounts.set(entry.embedding.length, (this.lengthCounts.get(entry.embedding.length) ?? 0) + 1)
  }

  private uncount(length: number): void {
    const n = (this.lengthCounts.get(length) ?? 0) - 1
    if (n > 0) this.lengthCounts.set(length, n)
    else this.lengthCounts.delete(length)
  }

  async addVector(
    id: string,
    embedding: Float32Array,
    metadata: VectorMetadata
  ): Promise<void> {
    this.put({ id, embedding, metadata, createdAt: new Date().toISOString() })
  }

  async removeVector(id: string): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.entries.delete(id)
    this.uncount(entry.embedding.length)
    return true
  }

  hasVector(id: string): boolean {
    return this.entries.has(id)
  }

  tierOf(id: string): 'hot' | 'cold' | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    return entry.metadata.tier === 'cold' ? 'cold' : 'hot'
  }

  get size(): number {
    return this.entries.size
  }

  getDimensions(): number | null {
    let best: number | null = null
    let bestCount = 0
    for (const [length, count] of this.lengthCounts) {
      if (count > bestCount) {
        best = length
        bestCount = count
      }
    }
    return best
  }

  countWithDimensions(dimensions: number): number {
    return this.lengthCounts.get(dimensions) ?? 0
  }

  /**
   * Search for similar vectors using cosine similarity.
   *
   * For large stores (> ~1000 entries and a small limit), uses a bounded
   * min-heap of size `limit` to avoid allocating + full-sorting one
   * VectorSearchResult per entry on every call. V8's Array.prototype.sort
   * with a JS comparator is ~O(n log n) with a very high per-comparison
   * constant, and was pinning the main thread for minutes on characters
   * with tens of thousands of memories.
   *
   * For small corpora the linear scan + sort is faster in practice (tight
   * inner loop, no heap bookkeeping), so we fall back to it below the
   * threshold.
   */
  search(
    queryEmbedding: Float32Array,
    limit: number = 10,
    filter?: (metadata: VectorMetadata) => boolean
  ): VectorSearchResult[] {
    if (this.entries.size === 0) {
      return []
    }

    // No entry of the query's length — log and return empty results instead
    // of crashing. This typically means the search embedding profile differs
    // from the one the corpus was embedded with; the caller should fall back
    // to text search. Entries of other lengths are skipped below.
    if (this.countWithDimensions(queryEmbedding.length) === 0) {
      logger.warn('Query vector dimension mismatch — search embedding profile likely differs from index', {
        context: 'CharacterVectorStore.search',
        characterId: this.characterId,
        storedDimensions: this.getDimensions(),
        queryDimensions: queryEmbedding.length,
      })
      return []
    }

    // Small corpora or large limits relative to corpus size: the heap path
    // is no faster than a straight sort and adds bookkeeping overhead.
    if (this.entries.size < 1000 || limit * 4 >= this.entries.size) {
      return this.searchLinear(queryEmbedding, limit, filter)
    }

    return this.searchHeap(queryEmbedding, limit, filter)
  }

  /**
   * Linear path: score every candidate, full-sort, slice. Used for small
   * corpora (< 1000 entries) or when `limit` is a large fraction of the
   * corpus and the heap offers no advantage.
   */
  private searchLinear(
    queryEmbedding: Float32Array,
    limit: number,
    filter?: (metadata: VectorMetadata) => boolean
  ): VectorSearchResult[] {
    const results: VectorSearchResult[] = []

    for (const entry of this.entries.values()) {
      if (filter && !filter(entry.metadata)) {
        continue
      }

      if (entry.embedding.length !== queryEmbedding.length) {
        continue
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding)
      results.push({
        id: entry.id,
        score,
        metadata: entry.metadata,
      })
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Heap path: maintain a bounded min-heap of size `limit`. Skip entries
   * whose score can't beat the current worst in the heap — that's the
   * part that makes this actually faster than the linear path at scale.
   * Drain the heap into a descending-sorted array at the end.
   *
   * The heap is stored as two parallel arrays (scores and results) so the
   * hot comparison reads a primitive number rather than a property off a
   * wrapped object — matters because `sift` runs O(log k) per candidate
   * across n entries.
   */
  private searchHeap(
    queryEmbedding: Float32Array,
    limit: number,
    filter?: (metadata: VectorMetadata) => boolean
  ): VectorSearchResult[] {
    const heapScores: number[] = new Array(limit)
    const heapResults: VectorSearchResult[] = new Array(limit)
    let heapSize = 0

    const siftUp = (i: number) => {
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (heapScores[parent] <= heapScores[i]) break
        const ts = heapScores[parent]; heapScores[parent] = heapScores[i]; heapScores[i] = ts
        const tr = heapResults[parent]; heapResults[parent] = heapResults[i]; heapResults[i] = tr
        i = parent
      }
    }

    const siftDown = (i: number) => {
      while (true) {
        const l = i * 2 + 1
        const r = i * 2 + 2
        let min = i
        if (l < heapSize && heapScores[l] < heapScores[min]) min = l
        if (r < heapSize && heapScores[r] < heapScores[min]) min = r
        if (min === i) break
        const ts = heapScores[min]; heapScores[min] = heapScores[i]; heapScores[i] = ts
        const tr = heapResults[min]; heapResults[min] = heapResults[i]; heapResults[i] = tr
        i = min
      }
    }

    for (const entry of this.entries.values()) {
      if (filter && !filter(entry.metadata)) {
        continue
      }

      if (entry.embedding.length !== queryEmbedding.length) {
        continue
      }

      const score = cosineSimilarity(queryEmbedding, entry.embedding)

      if (heapSize < limit) {
        heapScores[heapSize] = score
        heapResults[heapSize] = { id: entry.id, score, metadata: entry.metadata }
        heapSize++
        siftUp(heapSize - 1)
      } else if (score > heapScores[0]) {
        // Replace the worst entry with this one and sift down. This avoids
        // allocating a VectorSearchResult for the majority of entries that
        // can't make the top-K anyway (heapScores[0] is always the worst).
        heapScores[0] = score
        heapResults[0] = { id: entry.id, score, metadata: entry.metadata }
        siftDown(0)
      }
    }

    // Drain the heap into descending order.
    const out: VectorSearchResult[] = new Array(heapSize)
    for (let i = heapSize - 1; i >= 0; i--) {
      out[i] = heapResults[0]
      heapScores[0] = heapScores[heapSize - 1]
      heapResults[0] = heapResults[heapSize - 1]
      heapSize--
      if (heapSize > 0) siftDown(0)
    }
    return out
  }

  setTier(ids: readonly string[], tier: 'hot' | 'cold'): void {
    let changed = 0
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && entry.metadata.tier !== tier) {
        entry.metadata = { ...entry.metadata, tier }
        changed++
      }
    }
    logger.debug('Re-stamped vector tiers', {
      context: 'CharacterVectorStore.setTier',
      characterId: this.characterId,
      tier,
      requested: ids.length,
      changed,
    })
  }

  /** Every entry, for read-only walks (consolidation clustering, the optimizer). */
  getAllEntries(): VectorEntry[] {
    return Array.from(this.entries.values())
  }

  clear(): void {
    this.entries.clear()
    this.lengthCounts.clear()
  }
}

/**
 * Process-wide cache of per-character stores. Loading is memoised per
 * character: two first uses at once share one load and one store, rather
 * than each building its own and the later one silently replacing the
 * earlier (and any write the earlier had taken in the meantime).
 */
export class VectorStoreManager {
  private stores: Map<string, ICharacterVectorStore> = new Map()
  private loading: Map<string, Promise<ICharacterVectorStore>> = new Map()

  /** The character's store, loading it from its memory rows on first use. */
  async getStore(characterId: string): Promise<ICharacterVectorStore> {
    const loaded = this.stores.get(characterId)
    if (loaded) return loaded
    const pending = this.loading.get(characterId)
    if (pending) return pending

    const load: Promise<ICharacterVectorStore> = this.loadAndKeep(characterId, () => load)
    this.loading.set(characterId, load)
    try {
      return await load
    } finally {
      if (this.loading.get(characterId) === load) this.loading.delete(characterId)
    }
  }

  /**
   * Load a store and keep it, unless an unload landed while the load was in
   * flight (`current()` is no longer the pending load): that store is handed to
   * the callers that asked for it, but not kept.
   */
  private async loadAndKeep(
    characterId: string,
    current: () => Promise<ICharacterVectorStore>,
  ): Promise<ICharacterVectorStore> {
    const store = new CharacterVectorStore(characterId)
    await store.load()
    if (this.loading.get(characterId) === current()) {
      this.stores.set(characterId, store)
    }
    return store
  }

  /**
   * The character's store if it is loaded or loading (awaiting an in-flight
   * load, so a write that lands during it is not lost); never starts a load.
   */
  async getLoadedStore(characterId: string): Promise<ICharacterVectorStore | undefined> {
    return this.stores.get(characterId) ?? (await this.loading.get(characterId))
  }

  /** Drop a character's cached store; the next use reloads from its rows. */
  unloadStore(characterId: string): boolean {
    this.loading.delete(characterId)
    return this.stores.delete(characterId)
  }

  /** Drop every cached store (after a corpus-wide rewrite such as a Matryoshka re-apply). */
  unloadAll(): void {
    this.loading.clear()
    this.stores.clear()
  }

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

/**
 * The process's one vector store manager (bug 235).
 *
 * Next.js can evaluate this module more than once in one process — the
 * instrumentation bundle (where the job dispatcher's post-commit
 * `memoryIndex.reload` runs) and each route bundle (chat recall, the memories
 * API) get their own copy. A module-level singleton gave each copy its own
 * cache, so a reload reached only the dispatcher's while recall kept serving
 * vectors from before a reindex. One process, one cache.
 */
export function getVectorStoreManager(): VectorStoreManager {
  return processSingleton('embedding.vectorStoreManager', () => new VectorStoreManager())
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
