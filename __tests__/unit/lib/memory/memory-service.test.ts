/**
 * Unit tests for Memory Service
 * Tests the create paths and the vector-index rebuild. (Deletion moved to
 * `lib/memory/retire.ts`; the hand edit to `lib/memory/admission`, tested in
 * update-memory.test.ts.)
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

jest.mock('@/lib/memory/index-store', () => ({
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
  embeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).embeddingTextFor,
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
const indexMock = jest.requireMock('@/lib/memory/index-store') as {
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

describe('Memory Service', () => {
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
  let createMemoryWithGate: typeof import('@/lib/memory/memory-service').createMemoryWithGate
  let createMemoryWithEmbedding: typeof import('@/lib/memory/memory-service').createMemoryWithEmbedding
  let rebuildVectorIndex: typeof import('@/lib/memory/memory-service').rebuildVectorIndex

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
      const serviceModule = require('@/lib/memory/memory-service')
      createMemoryWithGate = serviceModule.createMemoryWithGate
      createMemoryWithEmbedding = serviceModule.createMemoryWithEmbedding
      rebuildVectorIndex = serviceModule.rebuildVectorIndex
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // createMemoryWithEmbedding Tests
  // ============================================================================
  describe('createMemoryWithEmbedding', () => {
    const memoryData = {
      characterId: 'char-1',
      content: 'New memory content',
      summary: 'New summary',
      importance: 0.8,
    }

    const options = {
      userId: 'user-123',
    }

    it('should create memory with embedding', async () => {
      const createdMemory = { id: 'new-memory', ...memoryData, embedding: [0.1, 0.2, 0.3] }
      mockMemoriesRepo.create.mockResolvedValue(createdMemory)
      mockGenerateEmbedding.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        model: 'test-model',
      })

      const result = await createMemoryWithEmbedding(memoryData, { ...options, skipGate: true })

      // Embedding first, then one insert that carries it (bug 220).
      expect(mockGenerateEmbedding).toHaveBeenCalled()
      expect(mockMemoriesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: [0.1, 0.2, 0.3] }),
        undefined
      )
      expect(mockGenerateEmbedding.mock.invocationCallOrder[0]).toBeLessThan(
        mockMemoriesRepo.create.mock.invocationCallOrder[0]
      )
      // The row already carries its vector: the index caches it, no second write.
      expect(mockIndex.indexInserted).toHaveBeenCalledWith('char-1', [
        { id: 'new-memory', embedding: [0.1, 0.2, 0.3], tier: 'hot' },
      ])
      expect(mockIndex.upsert).not.toHaveBeenCalled()
      expect(mockMemoriesRepo.updateForCharacter).not.toHaveBeenCalled()
      expect(result!.id).toBe('new-memory')
    })

    it('should skip embedding when skipEmbedding is true', async () => {
      const createdMemory = { id: 'new-memory', ...memoryData }
      mockMemoriesRepo.create.mockResolvedValue(createdMemory)

      const result = await createMemoryWithEmbedding(memoryData, {
        ...options,
        skipEmbedding: true,
      })

      expect(mockMemoriesRepo.create).toHaveBeenCalled()
      expect(mockGenerateEmbedding).not.toHaveBeenCalled()
      expect(result!.id).toBe('new-memory')
    })

    it('writes no row when embedding fails after the retry (bug 220)', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('Embedding failed'))

      const outcome = await createMemoryWithGate(memoryData, { ...options, skipGate: true })

      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
      expect(mockMemoriesRepo.create).not.toHaveBeenCalled()
      expect(mockIndex.indexInserted).not.toHaveBeenCalled()
      expect(outcome.memory).toBeNull()
      expect(outcome.action).toBe('SKIP_EMBEDDING_FAILED')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('writes the row once the retry succeeds (bug 220)', async () => {
      mockGenerateEmbedding
        .mockRejectedValueOnce(new Error('transient') as never)
        .mockResolvedValueOnce({ embedding: [0.4, 0.5, 0.6], model: 'm' } as never)
      mockMemoriesRepo.create.mockResolvedValue({ id: 'new-memory', ...memoryData })

      const outcome = await createMemoryWithGate(memoryData, { ...options, skipGate: true })

      expect(mockMemoriesRepo.create).toHaveBeenCalledTimes(1)
      expect(outcome.action).toBe('SKIP_GATE')
      expect(outcome.memory!.id).toBe('new-memory')
    })
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

  // ============================================================================
  // createMemoryWithGate — INSERT_RELATED link preservation (Bug 26)
  // ============================================================================
  describe('createMemoryWithGate INSERT_RELATED (Bug 26)', () => {
    it('returns the POST-LINK row so relatedMemoryIds carries the gate links', async () => {
      // A gate hit in the RELATED band (0.70–0.85) routes to INSERT_RELATED.
      const relatedMemory = {
        id: 'related-1',
        characterId: 'char-1',
        content: 'A related memory',
        summary: 'related',
        relatedMemoryIds: [],
      }

      mockGenerateEmbedding.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        model: 'test-model',
      })
      // One neighbour in the RELATED band → INSERT_RELATED.
      mockIndex.search.mockResolvedValue([
        { id: 'related-1', score: 0.75, metadata: { memoryId: 'related-1', characterId: 'char-1', tier: 'hot' } },
      ])
      ;(mockMemoriesRepo as any).findByIds = jest.fn<any>().mockResolvedValue([relatedMemory])

      // create() persists with relatedMemoryIds: [] (the stale array that used
      // to leak out as outcome.memory).
      mockMemoriesRepo.create.mockResolvedValue({
        id: 'new-mem',
        characterId: 'char-1',
        relatedMemoryIds: [],
      })
      // updateForCharacter echoes the patch merged onto the row — mirrors the
      // real repo returning the persisted state.
      mockMemoriesRepo.updateForCharacter.mockImplementation(
        (charId: string, id: string, patch: Record<string, unknown>) =>
          Promise.resolve({ id, characterId: charId, relatedMemoryIds: [], ...patch }),
      )

      const outcome = await createMemoryWithGate(
        {
          characterId: 'char-1',
          content: 'A brand new observation',
          summary: 'new',
          importance: 0.6,
          // MANUAL keeps the name-presence / episodic-fallback safety nets out
          // of the way; they don't matter to the link-preservation path.
          source: 'MANUAL',
        },
        { userId: 'user-123' },
      )

      expect(outcome.action).toBe('INSERT_RELATED')
      // The gate wrote 'related-1' onto the new row; the returned memory must
      // reflect it (pre-fix this was the stale [] and the fold pass clobbered it).
      expect(outcome.memory?.relatedMemoryIds).toEqual(['related-1'])
      expect(outcome.relatedMemoryIds).toEqual(['related-1'])
      // The link write actually happened on both rows, as deltas (bug 231).
      expect(mockMemoriesRepo.addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'new-mem', ['related-1'])
      expect(mockMemoriesRepo.addRelatedMemoryIds).toHaveBeenCalledWith('char-1', 'related-1', ['new-mem'])
    })
  })

  // ============================================================================
  // createMemoryWithGate INSERT — one persist tail for both create paths
  // ============================================================================
  describe('createMemoryWithGate INSERT persist tail', () => {
    const data = {
      characterId: 'char-1',
      content: 'A brand new observation',
      summary: 'new',
      importance: 0.6,
      source: 'MANUAL' as const,
    }

    beforeEach(() => {
      mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test-model' })
      mockIndex.search.mockResolvedValue([])
      ;(mockMemoriesRepo as any).findByIds = jest.fn<any>().mockResolvedValue([])
      mockMemoriesRepo.create.mockImplementation(async (row: any) => ({ id: 'new-mem', ...row }))
      mockMemoriesRepo.updateForCharacter.mockImplementation(async (c: any, id: any, patch: any) => ({ id, characterId: c, ...patch }))
    })

    it('writes the gate embedding in the create call — no row ever exists without it', async () => {
      const outcome = await createMemoryWithGate(data, { userId: 'user-123' })

      expect(outcome.action).toBe('INSERT')
      expect(mockMemoriesRepo.create).toHaveBeenCalledTimes(1)
      expect(mockMemoriesRepo.create.mock.calls[0][0]).toMatchObject({ embedding: [0.1, 0.2, 0.3] })
      expect(mockMemoriesRepo.updateForCharacter).not.toHaveBeenCalled()
      expect(mockIndex.indexInserted).toHaveBeenCalledWith('char-1', [
        { id: 'new-mem', embedding: [0.1, 0.2, 0.3], tier: 'hot' },
      ])
      expect(mockIndex.upsert).not.toHaveBeenCalled()
      expect(outcome.memory).toMatchObject({ id: 'new-mem', embedding: [0.1, 0.2, 0.3] })
    })

    it('the direct (skipGate) path persists exactly as the gate path does', async () => {
      await createMemoryWithGate(data, { userId: 'user-123' })
      const gateCreate = mockMemoriesRepo.create.mock.calls[0]
      const gateVector = mockIndex.indexInserted.mock.calls[0]
      jest.clearAllMocks()
      mockIndex.indexInserted.mockResolvedValue(undefined)
      mockMemoriesRepo.create.mockImplementation(async (row: any) => ({ id: 'new-mem', ...row }))
      mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test-model' })

      await createMemoryWithGate(data, { userId: 'user-123', skipGate: true })

      expect(mockMemoriesRepo.create.mock.calls[0]).toEqual(gateCreate)
      expect(mockIndex.indexInserted.mock.calls[0]).toEqual(gateVector)
      expect(mockMemoriesRepo.updateForCharacter).not.toHaveBeenCalled()
    })
  })
})
