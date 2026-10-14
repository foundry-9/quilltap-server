/**
 * Vector Store Unit Tests
 *
 * The vector store is a pure in-process cache of `memories.embedding` /
 * `memories.tier` (Phase B of the memory refactor retired the
 * `vector_entries` mirror). These tests cover CharacterVectorStore — loading
 * from `memories.findIndexRowsByCharacterId`, mixed-length entries, tier
 * stamps, search — and VectorStoreManager's memoised loading.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock dependencies
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

type IndexRow = { id: string; embedding: Float32Array; tier: 'hot' | 'cold' }

const mockFindIndexRows = jest.fn<(characterId: string) => Promise<IndexRow[]>>()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    memories: { findIndexRowsByCharacterId: (characterId: string) => mockFindIndexRows(characterId) },
  }),
}))

// Override the global mock from jest.setup.ts so we test the real implementation
jest.mock('@/lib/embedding/vector-store', () => {
  return jest.requireActual('@/lib/embedding/vector-store')
})

// Provide cosine similarity inline — it's pure math with no external deps
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: (a: ArrayLike<number>, b: ArrayLike<number>) => {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  },
}))

// Use require to import after mock setup (jest.mock is hoisted above imports)
const vectorStoreModule = require('@/lib/embedding/vector-store')
const CharacterVectorStore = vectorStoreModule.CharacterVectorStore as typeof import('@/lib/embedding/vector-store').CharacterVectorStore
const VectorStoreManager = vectorStoreModule.VectorStoreManager as typeof import('@/lib/embedding/vector-store').VectorStoreManager
const isHotVector = vectorStoreModule.isHotVector as typeof import('@/lib/embedding/vector-store').isHotVector
type VectorMetadata = import('@/lib/embedding/vector-store').VectorMetadata

const f32 = (values: number[]) => new Float32Array(values)

function makeMetadata(overrides: Partial<VectorMetadata> = {}): VectorMetadata {
  return {
    memoryId: 'mem-1',
    characterId: 'char-1',
    ...overrides,
  }
}

function row(id: string, embedding: number[], tier: 'hot' | 'cold' = 'hot'): IndexRow {
  return { id, embedding: f32(embedding), tier }
}

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('CharacterVectorStore', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindIndexRows.mockResolvedValue([])
  })

  describe('initialization', () => {
    it('starts with null dimensions and zero size', () => {
      const store = new CharacterVectorStore('char-1')
      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })
  })

  describe('load', () => {
    it('loads every index row of the character from memories', async () => {
      mockFindIndexRows.mockResolvedValue([row('v1', [1, 0, 0]), row('v2', [0, 1, 0])])

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(mockFindIndexRows).toHaveBeenCalledWith('char-1')
      expect(store.size).toBe(2)
      expect(store.getDimensions()).toBe(3)
      expect(store.hasVector('v1')).toBe(true)
      expect(store.hasVector('v2')).toBe(true)
      const entry = store.getAllEntries().find((e) => e.id === 'v1')!
      expect(entry.metadata).toEqual({ memoryId: 'v1', characterId: 'char-1', tier: 'hot' })
      expect(entry.embedding).toBeInstanceOf(Float32Array)
    })

    it('stamps tiers from the rows, and search can filter on them', async () => {
      mockFindIndexRows.mockResolvedValue([row('v1', [1, 0]), row('v2', [0.9, 0.1], 'cold')])

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.tierOf('v1')).toBe('hot')
      expect(store.tierOf('v2')).toBe('cold')
      expect(store.tierOf('nope')).toBeUndefined()

      const query = f32([1, 0])
      expect(store.search(query, 5).map((r) => r.id)).toEqual(['v1', 'v2'])
      expect(store.search(query, 5, isHotVector).map((r) => r.id)).toEqual(['v1'])

      // An in-memory re-stamp moves the entry between tiers.
      store.setTier(['v1'], 'cold')
      store.setTier(['v2'], 'hot')
      expect(store.tierOf('v1')).toBe('cold')
      expect(store.search(query, 5, isHotVector).map((r) => r.id)).toEqual(['v2'])
    })

    it('starts empty when the character has no embedded memories', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })

    it('starts empty (and does not throw) on a database error', async () => {
      mockFindIndexRows.mockRejectedValue(new Error('DB error'))

      const store = new CharacterVectorStore('char-1')
      await store.addVector('stale', f32([1, 0]), makeMetadata())
      await expect(store.load()).resolves.toBeUndefined()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })

    it('replaces existing in-memory entries when loading', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('local-1', f32([1, 2, 3]), makeMetadata())

      mockFindIndexRows.mockResolvedValue([row('db-1', [1, 0])])
      await store.load()

      expect(store.hasVector('local-1')).toBe(false)
      expect(store.hasVector('db-1')).toBe(true)
      expect(store.getDimensions()).toBe(2)
    })

    it('holds rows of mixed lengths (a corpus part-way through a re-embed)', async () => {
      mockFindIndexRows.mockResolvedValue([
        row('old-1', [1, 0]),
        row('new-1', [1, 0, 0]),
        row('new-2', [0, 1, 0]),
      ])

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.size).toBe(3)
      expect(store.getDimensions()).toBe(3) // the most common length
      expect(store.countWithDimensions(3)).toBe(2)
      expect(store.countWithDimensions(2)).toBe(1)
      expect(store.countWithDimensions(4)).toBe(0)
    })
  })

  describe('addVector', () => {
    it('adds a vector and sets dimensions on first add', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 2, 3]), makeMetadata())

      expect(store.size).toBe(1)
      expect(store.getDimensions()).toBe(3)
      expect(store.hasVector('v1')).toBe(true)
    })

    it('accepts a vector of another length rather than throwing', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 2, 3]), makeMetadata())
      await store.addVector('v2', f32([1, 2]), makeMetadata({ memoryId: 'v2' }))

      expect(store.size).toBe(2)
      expect(store.countWithDimensions(3)).toBe(1)
      expect(store.countWithDimensions(2)).toBe(1)
    })

    it('overwrites an existing vector with the same id, re-counting its length', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0, 0]), makeMetadata())
      await store.addVector('v1', f32([0, 1]), makeMetadata())

      expect(store.size).toBe(1)
      expect(store.countWithDimensions(3)).toBe(0)
      expect(store.countWithDimensions(2)).toBe(1)
      expect(store.getDimensions()).toBe(2)
      expect(Array.from(store.getAllEntries()[0].embedding)).toEqual([0, 1])
    })
  })

  describe('removeVector', () => {
    it('removes an existing vector and its length count', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0]), makeMetadata())

      const removed = await store.removeVector('v1')

      expect(removed).toBe(true)
      expect(store.size).toBe(0)
      expect(store.hasVector('v1')).toBe(false)
      expect(store.getDimensions()).toBeNull()
      expect(store.countWithDimensions(2)).toBe(0)
    })

    it('returns false for non-existent vector', async () => {
      const store = new CharacterVectorStore('char-1')
      const removed = await store.removeVector('nonexistent')

      expect(removed).toBe(false)
    })
  })

  describe('search', () => {
    it('returns empty array for empty store', () => {
      const store = new CharacterVectorStore('char-1')
      expect(store.search(f32([1, 0, 0]))).toEqual([])
    })

    it('returns results sorted by similarity score descending', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0, 0]), makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', f32([0, 1, 0]), makeMetadata({ memoryId: 'v2' }))
      await store.addVector('v3', f32([0.9, 0.1, 0]), makeMetadata({ memoryId: 'v3' }))

      const results = store.search(f32([1, 0, 0]))

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('v1')
      expect(results[0].score).toBeCloseTo(1.0)
      expect(results[1].id).toBe('v3')
      expect(results[2].id).toBe('v2')
    })

    it('respects the limit parameter', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0]), makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', f32([0, 1]), makeMetadata({ memoryId: 'v2' }))
      await store.addVector('v3', f32([0.5, 0.5]), makeMetadata({ memoryId: 'v3' }))

      expect(store.search(f32([1, 0]), 2)).toHaveLength(2)
    })

    it('applies filter predicate', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0]), makeMetadata({ memoryId: 'v1', extra: 'keep' }))
      await store.addVector('v2', f32([0.9, 0.1]), makeMetadata({ memoryId: 'v2', extra: 'skip' }))

      const results = store.search(f32([1, 0]), 10, (meta) => meta.extra === 'keep')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('v1')
    })

    it('returns empty results when no entry has the query length', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0, 0]), makeMetadata())

      expect(store.search(f32([1, 0]))).toHaveLength(0)
    })

    it('scores only the entries whose length matches the query', async () => {
      mockFindIndexRows.mockResolvedValue([
        row('old-1', [1, 0]),
        row('old-2', [0, 1]),
        row('new-1', [1, 0, 0]),
      ])
      const store = new CharacterVectorStore('char-1')
      await store.load()

      // The query matches the minority length: those entries are still found.
      expect(store.search(f32([1, 0]), 10).map((r) => r.id).sort()).toEqual(['old-1', 'old-2'])
      expect(store.search(f32([1, 0, 0]), 10).map((r) => r.id)).toEqual(['new-1'])
    })
  })

  describe('clear', () => {
    it('removes all entries and resets dimensions', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0]), makeMetadata())
      await store.addVector('v2', f32([0, 1]), makeMetadata({ memoryId: 'v2' }))

      store.clear()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
      expect(store.countWithDimensions(2)).toBe(0)
    })
  })

  describe('getAllEntries', () => {
    it('returns all stored entries', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', f32([1, 0]), makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', f32([0, 1]), makeMetadata({ memoryId: 'v2' }))

      const entries = store.getAllEntries()

      expect(entries).toHaveLength(2)
      expect(entries.map((e) => e.id).sort()).toEqual(['v1', 'v2'])
    })
  })

  describe('search heap/linear parity', () => {
    // Guards the bounded top-K heap path introduced to stop big-character
    // semantic searches from pinning the main thread. Heap and linear paths
    // must return identical (id, score) tuples for the same query — the
    // heap is a performance rewrite of the same contract.
    it('returns identical top-K for heap and linear paths on a 5000-entry store', async () => {
      const store = new CharacterVectorStore('char-parity')
      const dim = 8
      const n = 5000

      // Deterministic pseudorandom unit vectors — no Math.random so the
      // failure mode is reproducible.
      let seed = 0xdeadbeef
      const next = () => {
        seed = (seed * 1103515245 + 12345) >>> 0
        return (seed & 0x7fffffff) / 0x7fffffff
      }
      const randomUnit = () => {
        const v = new Float32Array(dim)
        let sum = 0
        for (let i = 0; i < dim; i++) { v[i] = next() - 0.5; sum += v[i] * v[i] }
        const norm = Math.sqrt(sum)
        for (let i = 0; i < dim; i++) v[i] /= norm
        return v
      }

      for (let i = 0; i < n; i++) {
        await store.addVector(`v${i}`, randomUnit(), makeMetadata({ memoryId: `v${i}` }))
      }

      const query = randomUnit()
      const limit = 20

      // The public search() picks the heap path here (n=5000 > 1000 and
      // limit*4=80 < n). Compare against the private linear path directly.
      const heapResults = store.search(query, limit)
      const linearResults = (store as unknown as {
        searchLinear: (q: Float32Array, l: number, f?: (m: VectorMetadata) => boolean) => {
          score: number
        }[]
      }).searchLinear(query, limit)

      // Tie-break order between entries with identical scores is not
      // contractually stable, so only the score sequence is compared.
      expect(heapResults).toHaveLength(limit)
      expect(heapResults.map((r) => r.score)).toEqual(linearResults.map((r) => r.score))
      for (let i = 1; i < heapResults.length; i++) {
        expect(heapResults[i - 1].score).toBeGreaterThanOrEqual(heapResults[i].score)
      }
    })

    it('falls back to linear path for small corpora', async () => {
      const store = new CharacterVectorStore('char-small')
      for (let i = 0; i < 50; i++) {
        await store.addVector(`v${i}`, f32([Math.cos(i), Math.sin(i)]), makeMetadata({ memoryId: `v${i}` }))
      }
      const results = store.search(f32([1, 0]), 5)
      expect(results).toHaveLength(5)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
      }
    })
  })
})

describe('VectorStoreManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindIndexRows.mockResolvedValue([])
  })

  describe('getStore', () => {
    it('creates and loads a new store for an unknown character', async () => {
      mockFindIndexRows.mockResolvedValue([row('v1', [1, 0])])
      const manager = new VectorStoreManager()

      const store = await manager.getStore('char-1')

      expect(store.size).toBe(1)
      expect(mockFindIndexRows).toHaveBeenCalledWith('char-1')
    })

    it('returns the cached store on subsequent calls without reloading', async () => {
      const manager = new VectorStoreManager()

      const first = await manager.getStore('char-1')
      const second = await manager.getStore('char-1')

      expect(first).toBe(second)
      expect(mockFindIndexRows).toHaveBeenCalledTimes(1)
    })

    it('shares one load and one store between concurrent first uses', async () => {
      const gate = deferred<IndexRow[]>()
      mockFindIndexRows.mockReturnValueOnce(gate.promise)
      const manager = new VectorStoreManager()

      const a = manager.getStore('char-1')
      const b = manager.getStore('char-1')
      gate.resolve([row('v1', [1, 0])])
      const [storeA, storeB] = await Promise.all([a, b])

      expect(storeA).toBe(storeB)
      expect(storeA.size).toBe(1)
      expect(mockFindIndexRows).toHaveBeenCalledTimes(1)
      expect(await manager.getStore('char-1')).toBe(storeA)
    })

    it('creates separate stores for different characters', async () => {
      const manager = new VectorStoreManager()

      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      expect(store1).not.toBe(store2)
      expect(mockFindIndexRows).toHaveBeenCalledWith('char-1')
      expect(mockFindIndexRows).toHaveBeenCalledWith('char-2')
    })
  })

  describe('getLoadedStore', () => {
    it('returns undefined and never starts a load for a character nobody has used', async () => {
      const manager = new VectorStoreManager()

      expect(await manager.getLoadedStore('char-1')).toBeUndefined()
      expect(mockFindIndexRows).not.toHaveBeenCalled()
      expect(manager.getStats().loadedStores).toBe(0)
    })

    it('returns the loaded store', async () => {
      const manager = new VectorStoreManager()
      const store = await manager.getStore('char-1')

      expect(await manager.getLoadedStore('char-1')).toBe(store)
    })

    it('awaits an in-flight load and returns the store it produces', async () => {
      const gate = deferred<IndexRow[]>()
      mockFindIndexRows.mockReturnValueOnce(gate.promise)
      const manager = new VectorStoreManager()

      const loading = manager.getStore('char-1')
      const loaded = manager.getLoadedStore('char-1')
      gate.resolve([row('v1', [1, 0])])

      const [store, viaLoaded] = await Promise.all([loading, loaded])
      expect(viaLoaded).toBe(store)
      expect(mockFindIndexRows).toHaveBeenCalledTimes(1)
    })
  })

  describe('unloadStore', () => {
    it('removes the store from the cache, so the next use reloads from the rows', async () => {
      const manager = new VectorStoreManager()
      const first = await manager.getStore('char-1')

      expect(manager.unloadStore('char-1')).toBe(true)
      expect(await manager.getLoadedStore('char-1')).toBeUndefined()

      const second = await manager.getStore('char-1')
      expect(second).not.toBe(first)
      expect(mockFindIndexRows).toHaveBeenCalledTimes(2)
    })

    it('returns false for a non-cached store', () => {
      const manager = new VectorStoreManager()
      expect(manager.unloadStore('nonexistent')).toBe(false)
    })

    it('does not keep a store whose load was in flight when it was unloaded', async () => {
      const gate = deferred<IndexRow[]>()
      mockFindIndexRows.mockReturnValueOnce(gate.promise)
      const manager = new VectorStoreManager()

      const loading = manager.getStore('char-1')
      manager.unloadStore('char-1')
      gate.resolve([row('stale', [1, 0])])

      // The caller that asked still gets a store...
      const handedOut = await loading
      expect(handedOut.hasVector('stale')).toBe(true)
      // ...but it was not kept: the next use loads afresh.
      expect(manager.getStats().loadedStores).toBe(0)
      mockFindIndexRows.mockResolvedValueOnce([row('fresh', [0, 1])])
      const next = await manager.getStore('char-1')
      expect(next).not.toBe(handedOut)
      expect(next.hasVector('fresh')).toBe(true)
      expect(next.hasVector('stale')).toBe(false)
    })
  })

  describe('unloadAll', () => {
    it('drops every cached store', async () => {
      const manager = new VectorStoreManager()
      await manager.getStore('char-1')
      await manager.getStore('char-2')

      manager.unloadAll()

      expect(manager.getStats().loadedStores).toBe(0)
      expect(await manager.getLoadedStore('char-1')).toBeUndefined()
      expect(await manager.getLoadedStore('char-2')).toBeUndefined()
    })

    it('does not keep a store whose load was in flight', async () => {
      const gate = deferred<IndexRow[]>()
      mockFindIndexRows.mockReturnValueOnce(gate.promise)
      const manager = new VectorStoreManager()

      const loading = manager.getStore('char-1')
      manager.unloadAll()
      gate.resolve([row('stale', [1, 0])])
      await loading

      expect(manager.getStats().loadedStores).toBe(0)
    })
  })

  describe('getStats', () => {
    it('returns correct counts', async () => {
      mockFindIndexRows.mockImplementation(async (characterId: string) =>
        characterId === 'char-1' ? [row('v1', [1, 0]), row('v2', [0, 1])] : [row('v3', [1, 0])]
      )
      const manager = new VectorStoreManager()
      await manager.getStore('char-1')
      await manager.getStore('char-2')

      expect(manager.getStats()).toEqual({ loadedStores: 2, totalVectors: 3 })
    })

    it('returns zeros when empty', () => {
      const manager = new VectorStoreManager()
      expect(manager.getStats()).toEqual({ loadedStores: 0, totalVectors: 0 })
    })
  })
})
