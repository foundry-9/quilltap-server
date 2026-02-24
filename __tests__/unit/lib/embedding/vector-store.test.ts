/**
 * Vector Store Unit Tests
 *
 * Tests CharacterVectorStore and VectorStoreManager against
 * the normalized BLOB-backed vector index repository.
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

const mockRepo = {
  findMetaByCharacterId: jest.fn(),
  findEntriesByCharacterId: jest.fn(),
  saveMeta: jest.fn(),
  addEntry: jest.fn(),
  addEntries: jest.fn(),
  removeEntry: jest.fn(),
  removeEntries: jest.fn(),
  updateEntryEmbedding: jest.fn(),
  removeEntriesByCharacterId: jest.fn(),
  deleteMetaByCharacterId: jest.fn(),
  deleteByCharacterId: jest.fn(),
  entryExists: jest.fn(),
  getAllCharacterIds: jest.fn(),
}

jest.mock('@/lib/database/repositories/vector-indices.repository', () => ({
  getVectorIndicesRepository: () => mockRepo,
}))

// Override the global mock from jest.setup.ts so we test the real implementation
jest.mock('@/lib/embedding/vector-store', () => {
  return jest.requireActual('@/lib/embedding/vector-store')
})

// Provide cosine similarity inline — it's pure math with no external deps
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: (a: number[], b: number[]) => {
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
type VectorMetadata = import('@/lib/embedding/vector-store').VectorMetadata

// Test data helpers
function makeMetadata(overrides: Partial<VectorMetadata> = {}): VectorMetadata {
  return {
    memoryId: 'mem-1',
    characterId: 'char-1',
    ...overrides,
  }
}

function makeEntryRows(characterId: string, entries: Array<{ id: string; embedding: number[] }>) {
  return entries.map(e => ({
    id: e.id,
    characterId,
    embedding: e.embedding,
    createdAt: '2025-01-01T00:00:00.000Z',
  }))
}

function makeMeta(characterId: string, dimensions: number) {
  return {
    id: characterId,
    characterId,
    version: 1,
    dimensions,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }
}

describe('CharacterVectorStore', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepo.findMetaByCharacterId.mockResolvedValue(null)
    mockRepo.findEntriesByCharacterId.mockResolvedValue([])
    mockRepo.saveMeta.mockResolvedValue(undefined)
    mockRepo.addEntries.mockResolvedValue(undefined)
    mockRepo.removeEntries.mockResolvedValue(0)
    mockRepo.updateEntryEmbedding.mockResolvedValue(true)
    mockRepo.deleteByCharacterId.mockResolvedValue(true)
  })

  describe('initialization', () => {
    it('starts with null dimensions and zero size', () => {
      const store = new CharacterVectorStore('char-1')
      expect(store.getDimensions()).toBeNull()
      expect(store.size).toBe(0)
    })
  })

  describe('load', () => {
    it('loads entries from the database', async () => {
      const entryRows = makeEntryRows('char-1', [
        { id: 'v1', embedding: [1, 0, 0] },
        { id: 'v2', embedding: [0, 1, 0] },
      ])
      const meta = makeMeta('char-1', 3)
      mockRepo.findMetaByCharacterId.mockResolvedValue(meta)
      mockRepo.findEntriesByCharacterId.mockResolvedValue(entryRows)

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.size).toBe(2)
      expect(store.getDimensions()).toBe(3)
      expect(store.hasVector('v1')).toBe(true)
      expect(store.hasVector('v2')).toBe(true)
    })

    it('starts fresh when no index exists in database', async () => {
      mockRepo.findMetaByCharacterId.mockResolvedValue(null)
      mockRepo.findEntriesByCharacterId.mockResolvedValue([])

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })

    it('starts fresh on database error', async () => {
      mockRepo.findMetaByCharacterId.mockRejectedValue(new Error('DB error'))

      const store = new CharacterVectorStore('char-1')
      await store.load()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })

    it('clears existing in-memory entries when loading', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('local-1', [1, 2, 3], makeMetadata())

      mockRepo.findMetaByCharacterId.mockResolvedValue(null)
      mockRepo.findEntriesByCharacterId.mockResolvedValue([])
      await store.load()

      expect(store.size).toBe(0)
      expect(store.hasVector('local-1')).toBe(false)
    })
  })

  describe('save', () => {
    it('saves added entries to the database', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      await store.save()

      expect(mockRepo.addEntries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'v1', characterId: 'char-1', embedding: [1, 0] }),
        ])
      )
      expect(mockRepo.saveMeta).toHaveBeenCalledWith('char-1', 2)
    })

    it('skips save when not dirty and empty', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.save()

      expect(mockRepo.addEntries).not.toHaveBeenCalled()
      expect(mockRepo.saveMeta).not.toHaveBeenCalled()
    })

    it('throws on database error during save', async () => {
      mockRepo.addEntries.mockRejectedValue(new Error('Save failed'))

      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      await expect(store.save()).rejects.toThrow('Save failed')
    })

    it('clears dirty tracking after successful save', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      await store.save()
      mockRepo.addEntries.mockClear()
      mockRepo.saveMeta.mockClear()

      // Calling save again should be a no-op (no changes tracked)
      await store.save()
      expect(mockRepo.addEntries).not.toHaveBeenCalled()
      expect(mockRepo.saveMeta).not.toHaveBeenCalled()
    })

    it('handles removed entries', async () => {
      // Load existing entries
      const entryRows = makeEntryRows('char-1', [{ id: 'v1', embedding: [1, 0] }])
      mockRepo.findMetaByCharacterId.mockResolvedValue(makeMeta('char-1', 2))
      mockRepo.findEntriesByCharacterId.mockResolvedValue(entryRows)

      const store = new CharacterVectorStore('char-1')
      await store.load()

      // Remove
      await store.removeVector('v1')
      await store.save()

      expect(mockRepo.removeEntries).toHaveBeenCalledWith(['v1'])
    })

    it('handles updated entries', async () => {
      // Load existing entries
      const entryRows = makeEntryRows('char-1', [{ id: 'v1', embedding: [1, 0] }])
      mockRepo.findMetaByCharacterId.mockResolvedValue(makeMeta('char-1', 2))
      mockRepo.findEntriesByCharacterId.mockResolvedValue(entryRows)

      const store = new CharacterVectorStore('char-1')
      await store.load()

      // Update
      await store.updateVector('v1', [0, 1])
      await store.save()

      expect(mockRepo.updateEntryEmbedding).toHaveBeenCalledWith('v1', [0, 1])
    })
  })

  describe('addVector', () => {
    it('adds a vector and sets dimensions on first add', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 2, 3], makeMetadata())

      expect(store.size).toBe(1)
      expect(store.getDimensions()).toBe(3)
      expect(store.hasVector('v1')).toBe(true)
    })

    it('throws on dimension mismatch', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 2, 3], makeMetadata())

      await expect(
        store.addVector('v2', [1, 2], makeMetadata({ memoryId: 'v2' }))
      ).rejects.toThrow('Vector dimension mismatch: expected 3, got 2')
    })

    it('overwrites existing vector with same id', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0, 0], makeMetadata())
      await store.addVector('v1', [0, 1, 0], makeMetadata())

      expect(store.size).toBe(1)
      const entries = store.getAllEntries()
      expect(entries[0].embedding).toEqual([0, 1, 0])
    })
  })

  describe('removeVector', () => {
    it('removes an existing vector', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      const removed = await store.removeVector('v1')

      expect(removed).toBe(true)
      expect(store.size).toBe(0)
      expect(store.hasVector('v1')).toBe(false)
    })

    it('returns false for non-existent vector', async () => {
      const store = new CharacterVectorStore('char-1')

      const removed = await store.removeVector('nonexistent')

      expect(removed).toBe(false)
    })
  })

  describe('updateVector', () => {
    it('updates an existing vector embedding', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      const updated = await store.updateVector('v1', [0, 1])

      expect(updated).toBe(true)
      const entries = store.getAllEntries()
      expect(entries[0].embedding).toEqual([0, 1])
    })

    it('returns false for non-existent vector', async () => {
      const store = new CharacterVectorStore('char-1')

      const updated = await store.updateVector('nonexistent', [1, 0])

      expect(updated).toBe(false)
    })

    it('throws on dimension mismatch during update', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0, 0], makeMetadata())

      await expect(
        store.updateVector('v1', [1, 0])
      ).rejects.toThrow('Vector dimension mismatch: expected 3, got 2')
    })
  })

  describe('search', () => {
    it('returns empty array for empty store', () => {
      const store = new CharacterVectorStore('char-1')
      const results = store.search([1, 0, 0])

      expect(results).toEqual([])
    })

    it('returns results sorted by similarity score descending', async () => {
      const store = new CharacterVectorStore('char-1')
      // Vector [1,0,0] is more similar to query [1,0,0] than [0,1,0]
      await store.addVector('v1', [1, 0, 0], makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', [0, 1, 0], makeMetadata({ memoryId: 'v2' }))
      await store.addVector('v3', [0.9, 0.1, 0], makeMetadata({ memoryId: 'v3' }))

      const results = store.search([1, 0, 0])

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('v1') // Exact match - highest score
      expect(results[0].score).toBeCloseTo(1.0)
      expect(results[1].id).toBe('v3') // Close match
      // v2 is orthogonal, lowest score
      expect(results[2].id).toBe('v2')
    })

    it('respects the limit parameter', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', [0, 1], makeMetadata({ memoryId: 'v2' }))
      await store.addVector('v3', [0.5, 0.5], makeMetadata({ memoryId: 'v3' }))

      const results = store.search([1, 0], 2)

      expect(results).toHaveLength(2)
    })

    it('applies filter predicate', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata({ memoryId: 'v1', extra: 'keep' }))
      await store.addVector('v2', [0.9, 0.1], makeMetadata({ memoryId: 'v2', extra: 'skip' }))

      const results = store.search([1, 0], 10, (meta) => meta.extra === 'keep')

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('v1')
    })

    it('throws on query dimension mismatch', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0, 0], makeMetadata())

      expect(() => store.search([1, 0])).toThrow(
        'Query vector dimension mismatch: expected 3, got 2'
      )
    })
  })

  describe('clear', () => {
    it('removes all entries and resets dimensions', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())
      await store.addVector('v2', [0, 1], makeMetadata({ memoryId: 'v2' }))

      store.clear()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })
  })

  describe('getAllEntries', () => {
    it('returns all stored entries', async () => {
      const store = new CharacterVectorStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata({ memoryId: 'v1' }))
      await store.addVector('v2', [0, 1], makeMetadata({ memoryId: 'v2' }))

      const entries = store.getAllEntries()

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.id).sort()).toEqual(['v1', 'v2'])
    })
  })
})

describe('VectorStoreManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepo.findMetaByCharacterId.mockResolvedValue(null)
    mockRepo.findEntriesByCharacterId.mockResolvedValue([])
    mockRepo.saveMeta.mockResolvedValue(undefined)
    mockRepo.addEntries.mockResolvedValue(undefined)
    mockRepo.removeEntries.mockResolvedValue(0)
    mockRepo.deleteByCharacterId.mockResolvedValue(true)
  })

  describe('getStore', () => {
    it('creates and loads a new store for unknown character', async () => {
      const manager = new VectorStoreManager()
      const store = await manager.getStore('char-1')

      expect(store).toBeDefined()
      expect(store.size).toBe(0)
      expect(mockRepo.findMetaByCharacterId).toHaveBeenCalledWith('char-1')
    })

    it('returns cached store on subsequent calls', async () => {
      const manager = new VectorStoreManager()
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-1')

      expect(store1).toBe(store2)
      // Only one load call
      expect(mockRepo.findMetaByCharacterId).toHaveBeenCalledTimes(1)
    })

    it('creates separate stores for different characters', async () => {
      const manager = new VectorStoreManager()
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      expect(store1).not.toBe(store2)
    })
  })

  describe('saveAll', () => {
    it('saves all loaded stores', async () => {
      const manager = new VectorStoreManager()
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      await store1.addVector('v1', [1, 0], makeMetadata({ characterId: 'char-1' }))
      await store2.addVector('v2', [0, 1], makeMetadata({ characterId: 'char-2' }))

      await manager.saveAll()

      // Both stores should have saved their entries
      expect(mockRepo.addEntries).toHaveBeenCalledTimes(2)
      expect(mockRepo.saveMeta).toHaveBeenCalledTimes(2)
    })
  })

  describe('saveStore', () => {
    it('saves a specific store', async () => {
      const manager = new VectorStoreManager()
      const store = await manager.getStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())

      await manager.saveStore('char-1')

      expect(mockRepo.addEntries).toHaveBeenCalledTimes(1)
    })

    it('does nothing for non-loaded store', async () => {
      const manager = new VectorStoreManager()
      await manager.saveStore('nonexistent')

      expect(mockRepo.addEntries).not.toHaveBeenCalled()
    })
  })

  describe('unloadStore', () => {
    it('removes store from cache', async () => {
      const manager = new VectorStoreManager()
      await manager.getStore('char-1')

      const unloaded = manager.unloadStore('char-1')

      expect(unloaded).toBe(true)
      expect(manager.getStats().loadedStores).toBe(0)
    })

    it('returns false for non-cached store', () => {
      const manager = new VectorStoreManager()
      const unloaded = manager.unloadStore('nonexistent')

      expect(unloaded).toBe(false)
    })
  })

  describe('deleteStore', () => {
    it('removes from cache and deletes from database', async () => {
      const manager = new VectorStoreManager()
      await manager.getStore('char-1')

      const deleted = await manager.deleteStore('char-1')

      expect(deleted).toBe(true)
      expect(mockRepo.deleteByCharacterId).toHaveBeenCalledWith('char-1')
      expect(manager.getStats().loadedStores).toBe(0)
    })
  })

  describe('getStats', () => {
    it('returns correct counts', async () => {
      const manager = new VectorStoreManager()
      const store = await manager.getStore('char-1')
      await store.addVector('v1', [1, 0], makeMetadata())
      await store.addVector('v2', [0, 1], makeMetadata({ memoryId: 'v2' }))

      await manager.getStore('char-2')

      const stats = manager.getStats()

      expect(stats.loadedStores).toBe(2)
      expect(stats.totalVectors).toBe(2)
    })

    it('returns zeros when empty', () => {
      const manager = new VectorStoreManager()
      const stats = manager.getStats()

      expect(stats.loadedStores).toBe(0)
      expect(stats.totalVectors).toBe(0)
    })
  })
})
