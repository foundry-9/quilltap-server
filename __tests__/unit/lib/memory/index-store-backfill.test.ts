/**
 * Unit tests for the memory index backfill (`lib/memory/index-store/backfill.ts`)
 * Tests the vector-index rebuild. (Creation moved to `lib/memory/admission`,
 * tested in admission-admit.test.ts; deletion to `lib/memory/retire.ts`; the
 * hand edit to `updateMemory`, tested in update-memory.test.ts.)
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EmbeddingError'
    }
  },
  cosineSimilarity: jest.fn(),
}))

jest.mock('@/lib/memory/index-store/memory-index', () => ({
  memoryIndex: {
    search: jest.fn(),
    shape: jest.fn(),
    upsert: jest.fn(),
    indexInserted: jest.fn(),
    setTier: jest.fn(),
    remove: jest.fn(),
    reload: jest.fn(),
    reloadAll: jest.fn(),
    entries: jest.fn(),
  },
}))

jest.mock('@/lib/logger', () => {
  const childLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  return {
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnValue(childLogger),
    },
  }
})

// Get mocked modules
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const embeddingMock = jest.requireMock('@/lib/embedding/embedding-service') as {
  generateEmbeddingForUser: jest.Mock
  EmbeddingError: typeof Error
  cosineSimilarity: jest.Mock
}
const indexMock = jest.requireMock('@/lib/memory/index-store/memory-index') as {
  memoryIndex: Record<'search' | 'shape' | 'upsert' | 'indexInserted' | 'setTier' | 'reload' | 'entries', jest.Mock<any>>
}
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock
    debug: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockGenerateEmbedding = embeddingMock.generateEmbeddingForUser
const mockIndex = indexMock.memoryIndex
const mockLogger = loggerMock.logger

describe('Memory index backfill', () => {
  let mockMemoriesRepo: {
    create: jest.Mock
    findById: jest.Mock
    findByCharacterId: jest.Mock
    findBySourceMessageId: jest.Mock
    updateForCharacter: jest.Mock
    deleteForCharacter: jest.Mock
    deleteBySourceMessageId: jest.Mock
    searchByContent: jest.Mock
    countWithoutEmbedding: jest.Mock
  }

  // Import the module functions after mocks are set up
  let rebuildVectorIndex: typeof import('@/lib/memory/index-store/backfill').rebuildVectorIndex

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockMemoriesRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByCharacterId: jest.fn(),
      findBySourceMessageId: jest.fn(),
      updateForCharacter: jest.fn(),
      addRelatedMemoryIds: jest.fn(),
      deleteForCharacter: jest.fn(),
      deleteBySourceMessageId: jest.fn(),
      searchByContent: jest.fn(),
      countWithoutEmbedding: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      memories: mockMemoriesRepo,
    } as any)

    // Setup the mock memory index
    mockIndex.search.mockResolvedValue([])
    mockIndex.indexInserted.mockResolvedValue(undefined)
    mockIndex.upsert.mockResolvedValue([])
    mockIndex.setTier.mockResolvedValue(0)
    mockIndex.entries.mockResolvedValue([])

    // Fresh import for each test
    jest.isolateModules(() => {
      const serviceModule = require('@/lib/memory/index-store/backfill')
      rebuildVectorIndex = serviceModule.rebuildVectorIndex
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // rebuildVectorIndex — the rows are the index (bug 205)
  // ============================================================================
  describe('rebuildVectorIndex', () => {
    it('drops the cache and reloads it from the rows, so tiers come with the vectors', async () => {
      mockIndex.entries.mockResolvedValue([
        { id: 'hot-1', embedding: new Float32Array([1, 0]), metadata: { memoryId: 'hot-1', characterId: 'char-1', tier: 'hot' } },
        { id: 'cold-1', embedding: new Float32Array([0, 1]), metadata: { memoryId: 'cold-1', characterId: 'char-1', tier: 'cold' } },
        { id: 'legacy', embedding: new Float32Array([1, 1]), metadata: { memoryId: 'legacy', characterId: 'char-1', tier: 'hot' } },
      ])
      mockMemoriesRepo.countWithoutEmbedding.mockResolvedValue(1)

      const result = await rebuildVectorIndex('char-1')

      expect(mockIndex.reload).toHaveBeenCalledWith('char-1')
      expect(mockIndex.entries).toHaveBeenCalledWith('char-1')
      // Reload first, so the entries counted are the ones read fresh from the rows.
      expect(mockIndex.reload.mock.invocationCallOrder[0]).toBeLessThan(
        mockIndex.entries.mock.invocationCallOrder[0],
      )
      expect(mockMemoriesRepo.countWithoutEmbedding).toHaveBeenCalledWith('char-1')
      // Nothing is written: the rows already hold every vector and tier.
      expect(mockIndex.upsert).not.toHaveBeenCalled()
      expect(mockIndex.indexInserted).not.toHaveBeenCalled()
      expect(result).toEqual({ indexed: 3, failed: 1 })
    })
  })
})
