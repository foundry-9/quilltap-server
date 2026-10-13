/**
 * `memoryIndex` — the owner of every memory vector and tier.
 *
 * `memories.embedding` and `memories.tier` are the only stored copy of a
 * memory's vector and tier; the per-character in-process store
 * (`lib/embedding/vector-store.ts`) is a cache of them, loaded with one query
 * and searched by brute-force cosine. This module is the only writer of
 * either column and the only importer of that cache:
 *
 *   - {@link MemoryIndex.upsert} writes a row's embedding (and any fields that
 *     must land in the same update) and puts the vector in the cache;
 *   - {@link MemoryIndex.indexInserted} caches the vector of a row its creator
 *     just inserted *with* its embedding, so a new row is never written twice;
 *   - {@link MemoryIndex.setTier} moves rows between tiers and re-stamps them;
 *   - {@link MemoryIndex.remove} evicts rows `retireMemories` has deleted;
 *   - {@link MemoryIndex.reload} / {@link MemoryIndex.reloadAll} drop a cache,
 *     so the next search reads the rows again.
 *
 * Because the rows are the truth, a cache that fails to update is simply
 * dropped: the next search reloads it. The cache is kept in step only when
 * it is already loaded (or loading); a write to a character nobody has
 * searched costs no load.
 *
 * **In the job child** the row writes go through the repository proxy, so
 * they buffer and commit with the job; the child's own cache is updated in
 * place so later steps of the same job see their writes, and the parent drops
 * its cache for every character a committed batch touched
 * (`lib/background-jobs/host/vector-store-invalidation.ts`). Phase C of the
 * memory refactor moves admission to the parent, after which the child's
 * writes here become a throw.
 *
 * @module memory/index-store/memory-index
 */

import type { Memory, MemoryTier } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import {
  getVectorStoreManager,
  isHotVector,
  type ICharacterVectorStore,
  type VectorEntry,
  type VectorMetadata,
  type VectorSearchResult,
} from '@/lib/embedding/vector-store'

export type { VectorSearchResult as MemoryIndexHit, VectorEntry as MemoryIndexEntryView } from '@/lib/embedding/vector-store'

const log = logger.child({ module: 'memory:index-store' })

/** One vector to write or cache. `tier` defaults to what the row already says. */
export interface MemoryIndexEntry {
  id: string
  embedding: Float32Array
  tier?: MemoryTier
}

/** An upsert entry; `alongside` lands in the same row update as the embedding. */
export interface MemoryIndexUpsert extends MemoryIndexEntry {
  /**
   * Other fields of the row written in the same update, so new text and its
   * vector are never on disk apart (an edit, a reinforcement fold, a digest
   * revision). Never `embedding` or `tier`.
   */
  alongside?: Partial<Omit<Memory, 'embedding' | 'tier' | 'id' | 'characterId'>>
}

export interface MemoryIndexSearchOptions {
  limit: number
  /** Recall paths read the hot tier only; the gate and the search tool read both. */
  hotOnly: boolean
  /** Ids to leave out of the scan (they never take a top-K slot). */
  exclude?: ReadonlySet<string>
}

/** What the index holds for a character, measured against a query's length. */
export interface MemoryIndexShape {
  size: number
  /** The most common vector length, or null when the index is empty. */
  dominantDimensions: number | null
  /** Entries whose length equals the query's — the ones a search can score. */
  matching: number
}

export interface MemoryIndex {
  search(characterId: string, vector: Float32Array, opts: MemoryIndexSearchOptions): Promise<VectorSearchResult[]>
  shape(characterId: string, queryDimensions: number): Promise<MemoryIndexShape>
  entries(characterId: string): Promise<VectorEntry[]>
  upsert(characterId: string, entries: readonly MemoryIndexUpsert[]): Promise<Array<Memory | null>>
  indexInserted(characterId: string, entries: readonly MemoryIndexEntry[]): Promise<void>
  setTier(
    characterId: string,
    ids: readonly string[],
    tier: MemoryTier,
    extra?: Partial<Pick<Memory, 'supersededById' | 'consolidatedAt'>>,
  ): Promise<number>
  remove(characterId: string, ids: readonly string[]): Promise<number>
  reload(characterId: string): void
  reloadAll(): void
}

/**
 * Run a cache mutation against the character's store if it is loaded or
 * loading. A failure drops the cache — the rows are already right, and the
 * next search reloads them — and is never rethrown.
 */
async function withLoadedStore(
  characterId: string,
  what: string,
  mutate: (store: ICharacterVectorStore) => Promise<number> | number,
): Promise<number> {
  const manager = getVectorStoreManager()
  try {
    const store = await manager.getLoadedStore(characterId)
    if (!store) return 0
    return await mutate(store)
  } catch (error) {
    manager.unloadStore(characterId)
    log.warn('Memory index cache update failed; dropped the cache so the next search reloads it', {
      characterId,
      what,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

function metadataFor(characterId: string, id: string, tier: MemoryTier): VectorMetadata {
  return { memoryId: id, characterId, tier }
}

class ProcessMemoryIndex implements MemoryIndex {
  async search(
    characterId: string,
    vector: Float32Array,
    opts: MemoryIndexSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const store = await getVectorStoreManager().getStore(characterId)
    const exclude = opts.exclude && opts.exclude.size > 0 ? opts.exclude : undefined
    const filter = opts.hotOnly || exclude
      ? (metadata: VectorMetadata) =>
          (!exclude || !exclude.has(metadata.memoryId)) && (!opts.hotOnly || isHotVector(metadata))
      : undefined
    return store.search(vector, opts.limit, filter)
  }

  async shape(characterId: string, queryDimensions: number): Promise<MemoryIndexShape> {
    const store = await getVectorStoreManager().getStore(characterId)
    return {
      size: store.size,
      dominantDimensions: store.getDimensions(),
      matching: store.countWithDimensions(queryDimensions),
    }
  }

  async entries(characterId: string): Promise<VectorEntry[]> {
    const store = await getVectorStoreManager().getStore(characterId)
    return store.getAllEntries()
  }

  async upsert(characterId: string, entries: readonly MemoryIndexUpsert[]): Promise<Array<Memory | null>> {
    if (entries.length === 0) return []
    const repos = getRepositories()
    const rows: Array<Memory | null> = []
    for (const entry of entries) {
      const patch: Partial<Memory> = { ...(entry.alongside ?? {}), embedding: entry.embedding }
      rows.push(await repos.memories.updateForCharacter(characterId, entry.id, patch))
    }

    const cached = await withLoadedStore(characterId, 'upsert', async (store) => {
      let n = 0
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        // An explicit null is the repository saying the row is gone (retired
        // between the caller's read and this write): caching its vector would
        // be the orphan-at-rank-1 of bug 200. A buffered write in the job
        // child returns undefined, not null, and is cached.
        if (rows[i] === null) {
          log.debug('Upsert found no row; vector not cached', { characterId, memoryId: entry.id })
          continue
        }
        // The tier the caller states, else the row's as written, else the
        // cached entry's (a buffered write in the job child returns no row).
        const tier: MemoryTier = entry.tier ?? rows[i]?.tier ?? store.tierOf(entry.id) ?? 'hot'
        await store.addVector(entry.id, entry.embedding, metadataFor(characterId, entry.id, tier))
        n++
      }
      return n
    })

    log.debug('Upserted memory vectors', {
      characterId,
      count: entries.length,
      withFields: entries.filter((e) => e.alongside && Object.keys(e.alongside).length > 0).length,
      cached,
    })
    return rows
  }

  async indexInserted(characterId: string, entries: readonly MemoryIndexEntry[]): Promise<void> {
    if (entries.length === 0) return
    const cached = await withLoadedStore(characterId, 'indexInserted', async (store) => {
      for (const entry of entries) {
        await store.addVector(entry.id, entry.embedding, metadataFor(characterId, entry.id, entry.tier ?? 'hot'))
      }
      return entries.length
    })
    log.debug('Indexed newly inserted memories', { characterId, count: entries.length, cached })
  }

  async setTier(
    characterId: string,
    ids: readonly string[],
    tier: MemoryTier,
    extra: Partial<Pick<Memory, 'supersededById' | 'consolidatedAt'>> = {},
  ): Promise<number> {
    if (ids.length === 0) return 0
    const changed = await getRepositories().memories.updateTierBulk(characterId, [...ids], tier, extra)
    await withLoadedStore(characterId, 'setTier', (store) => {
      store.setTier(ids, tier)
      return ids.length
    })
    log.debug('Moved memories between tiers through the index', {
      characterId,
      tier,
      requested: ids.length,
      changed,
    })
    return changed
  }

  async remove(characterId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    const removed = await withLoadedStore(characterId, 'remove', async (store) => {
      let n = 0
      for (const id of ids) {
        if (await store.removeVector(id)) n++
      }
      return n
    })
    log.debug('Evicted retired memories from the index', { characterId, requested: ids.length, removed })
    return removed
  }

  reload(characterId: string): void {
    const dropped = getVectorStoreManager().unloadStore(characterId)
    log.debug('Dropped memory index cache', { characterId, dropped })
  }

  reloadAll(): void {
    getVectorStoreManager().unloadAll()
    log.debug('Dropped every memory index cache')
  }
}

/** The process's memory index — parent or job child. */
export const memoryIndex: MemoryIndex = new ProcessMemoryIndex()
