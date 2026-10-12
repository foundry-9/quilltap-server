/**
 * Unit tests for Memory Service
 * Tests the memory service functions including cascade delete operations.
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

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
  getVectorStoreManager: jest.fn(),
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

// memory-service now routes deletions through the chokepoint helpers in
// memory-gate. Stub those so this file's tests don't need a real DB; pass the
// rest of memory-gate through unchanged.
jest.mock('@/lib/memory/memory-gate', () => {
  const actual = jest.requireActual<typeof import('@/lib/memory/memory-gate')>(
    '@/lib/memory/memory-gate'
  )
  return {
    ...actual,
    deleteMemoryWithUnlink: jest.fn(),
    deleteMemoriesWithUnlinkBatch: jest.fn(),
    deleteMemoriesWithUnlinkBatchReport: jest.fn(),
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
const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as {
  getCharacterVectorStore: jest.Mock
  getVectorStoreManager: jest.Mock
}
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock
    debug: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
}

const memoryGateMock = jest.requireMock('@/lib/memory/memory-gate') as {
  deleteMemoryWithUnlink: jest.Mock
  deleteMemoriesWithUnlinkBatch: jest.Mock
  deleteMemoriesWithUnlinkBatchReport: jest.Mock
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockGenerateEmbedding = embeddingMock.generateEmbeddingForUser
const mockGetCharacterVectorStore = vectorStoreMock.getCharacterVectorStore
const mockLogger = loggerMock.logger
const mockDeleteMemoryWithUnlink = memoryGateMock.deleteMemoryWithUnlink
const mockDeleteMemoriesWithUnlinkBatch = memoryGateMock.deleteMemoriesWithUnlinkBatchReport

// Mock memories
const mockMemories = [
  {
    id: 'memory-1',
    characterId: 'char-1',
    content: 'Test memory 1',
    summary: 'Summary 1',
    importance: 0.7,
    sourceMessageId: 'msg-1',
    embedding: [0.1, 0.2, 0.3],
  },
  {
    id: 'memory-2',
    characterId: 'char-2',
    content: 'Test memory 2',
    summary: 'Summary 2',
    importance: 0.5,
    sourceMessageId: 'msg-1',
    embedding: [0.4, 0.5, 0.6],
  },
  {
    id: 'memory-3',
    characterId: 'char-1',
    content: 'Test memory 3',
    summary: 'Summary 3',
    importance: 0.6,
    sourceMessageId: 'msg-2',
    embedding: null,
  },
]

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
  }

  let mockVectorStore: {
    addVector: jest.Mock
    updateVector: jest.Mock
    removeVector: jest.Mock
    hasVector: jest.Mock
    search: jest.Mock
    save: jest.Mock
  }

  // Import the module functions after mocks are set up
  let createMemoryWithGate: typeof import('@/lib/memory/memory-service').createMemoryWithGate
  let createMemoryWithEmbedding: typeof import('@/lib/memory/memory-service').createMemoryWithEmbedding
  let updateMemoryWithEmbedding: typeof import('@/lib/memory/memory-service').updateMemoryWithEmbedding
  let deleteMemoryWithVector: typeof import('@/lib/memory/memory-service').deleteMemoryWithVector
  let deleteMemoriesBySourceMessageWithVectors: typeof import('@/lib/memory/memory-service').deleteMemoriesBySourceMessageWithVectors
  let deleteMemoriesBySourceMessagesWithVectors: typeof import('@/lib/memory/memory-service').deleteMemoriesBySourceMessagesWithVectors

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
    }

    mockGetRepositories.mockReturnValue({
      memories: mockMemoriesRepo,
    } as any)

    // Setup mock vector store
    mockVectorStore = {
      addVector: jest.fn(),
      updateVector: jest.fn(),
      removeVector: jest.fn(),
      hasVector: jest.fn(),
      search: jest.fn(),
      save: jest.fn(),
    }
    mockGetCharacterVectorStore.mockResolvedValue(mockVectorStore)

    // Fresh import for each test
    jest.isolateModules(() => {
      const serviceModule = require('@/lib/memory/memory-service')
      createMemoryWithGate = serviceModule.createMemoryWithGate
      createMemoryWithEmbedding = serviceModule.createMemoryWithEmbedding
      updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      deleteMemoryWithVector = serviceModule.deleteMemoryWithVector
      deleteMemoriesBySourceMessageWithVectors = serviceModule.deleteMemoriesBySourceMessageWithVectors
      deleteMemoriesBySourceMessagesWithVectors = serviceModule.deleteMemoriesBySourceMessagesWithVectors
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
      expect(mockVectorStore.addVector).toHaveBeenCalled()
      expect(mockVectorStore.save).toHaveBeenCalled()
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
      expect(mockVectorStore.addVector).not.toHaveBeenCalled()
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
  // rebuildVectorIndex — tier rides with the vector (bug 205)
  // ============================================================================
  describe('rebuildVectorIndex', () => {
    it('stamps each rebuilt entry with its row tier so cold rows stay out of hot-only recall', async () => {
      const manager = {
        deleteStore: jest.fn(async () => true),
        getStore: jest.fn(async () => mockVectorStore),
      }
      vectorStoreMock.getVectorStoreManager.mockReturnValue(manager)
      mockMemoriesRepo.findByCharacterId.mockResolvedValue([
        { id: 'hot-1', characterId: 'char-1', tier: 'hot', embedding: new Float32Array([1, 0]) },
        { id: 'cold-1', characterId: 'char-1', tier: 'cold', embedding: new Float32Array([0, 1]) },
        { id: 'legacy', characterId: 'char-1', embedding: new Float32Array([1, 1]) },
        { id: 'bare', characterId: 'char-1', tier: 'cold', embedding: null },
      ])

      const { rebuildVectorIndex } = require('@/lib/memory/memory-service')
      const result = await rebuildVectorIndex('char-1', { userId: 'user-123' })

      expect(manager.deleteStore).toHaveBeenCalledWith('char-1')
      expect(result).toEqual({ indexed: 3, failed: 0 })
      const tiers = Object.fromEntries(
        mockVectorStore.addVector.mock.calls.map((call: any[]) => [call[0], call[2].tier])
      )
      expect(tiers).toEqual({ 'hot-1': 'hot', 'cold-1': 'cold', legacy: 'hot' })

      const { isHotVector } = jest.requireActual<typeof import('@/lib/embedding/vector-store')>(
        '@/lib/embedding/vector-store'
      )
      const coldMeta = mockVectorStore.addVector.mock.calls.find((c: any[]) => c[0] === 'cold-1')![2]
      expect(isHotVector(coldMeta as any)).toBe(false)
      expect(mockVectorStore.save).toHaveBeenCalled()
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
      mockVectorStore.search.mockReturnValue([{ id: 'related-1', score: 0.75 }])
      mockVectorStore.hasVector.mockReturnValue(false)
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
      mockVectorStore.search.mockReturnValue([])
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
      expect(mockVectorStore.addVector).toHaveBeenCalledWith('new-mem', [0.1, 0.2, 0.3], {
        memoryId: 'new-mem',
        characterId: 'char-1',
        tier: 'hot',
      })
      expect(outcome.memory).toMatchObject({ id: 'new-mem', embedding: [0.1, 0.2, 0.3] })
    })

    it('the direct (skipGate) path persists exactly as the gate path does', async () => {
      await createMemoryWithGate(data, { userId: 'user-123' })
      const gateCreate = mockMemoriesRepo.create.mock.calls[0]
      const gateVector = mockVectorStore.addVector.mock.calls[0]
      jest.clearAllMocks()
      mockMemoriesRepo.create.mockImplementation(async (row: any) => ({ id: 'new-mem', ...row }))
      mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test-model' })

      await createMemoryWithGate(data, { userId: 'user-123', skipGate: true })

      expect(mockMemoriesRepo.create.mock.calls[0]).toEqual(gateCreate)
      expect(mockVectorStore.addVector.mock.calls[0]).toEqual(gateVector)
      expect(mockMemoriesRepo.updateForCharacter).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // deleteMemoryWithVector Tests
  // ============================================================================
  describe('deleteMemoryWithVector', () => {
    // Vector removal lives in the chokepoint (bug 200); this wrapper only
    // confirms ownership and delegates.
    it('should delete memory through the chokepoint', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({ id: 'memory-1', characterId: 'char-1' })
      mockDeleteMemoryWithUnlink.mockResolvedValue(true)

      const result = await deleteMemoryWithVector('char-1', 'memory-1')

      expect(result).toBe(true)
      expect(mockDeleteMemoryWithUnlink).toHaveBeenCalledWith('memory-1')
    })

    it('should return false when memory not found', async () => {
      mockMemoriesRepo.findById.mockResolvedValue(null)

      const result = await deleteMemoryWithVector('char-1', 'nonexistent')

      expect(result).toBe(false)
      expect(mockDeleteMemoryWithUnlink).not.toHaveBeenCalled()
    })

    it('should return false when memory belongs to a different character', async () => {
      mockMemoriesRepo.findById.mockResolvedValue({ id: 'memory-1', characterId: 'char-2' })

      const result = await deleteMemoryWithVector('char-1', 'memory-1')

      expect(result).toBe(false)
      expect(mockDeleteMemoryWithUnlink).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // deleteMemoriesBySourceMessageWithVectors Tests
  // ============================================================================
  describe('deleteMemoriesBySourceMessageWithVectors', () => {
    it('should delete all memories for a source message via the batch chokepoint', async () => {
      // Memories from two different characters
      const memoriesForMessage = [mockMemories[0], mockMemories[1]]
      mockMemoriesRepo.findBySourceMessageId.mockResolvedValue(memoriesForMessage)
      mockDeleteMemoriesWithUnlinkBatch.mockResolvedValue({ deleted: 2, vectorsRemoved: 2 })

      const result = await deleteMemoriesBySourceMessageWithVectors('msg-1')

      expect(result).toEqual({ deleted: 2, vectorsRemoved: 2 })
      expect(mockDeleteMemoriesWithUnlinkBatch).toHaveBeenCalledWith(['memory-1', 'memory-2'])
      // The chokepoint owns vector removal; the cascade never touches the store.
      expect(mockVectorStore.removeVector).not.toHaveBeenCalled()
    })

    it('should return zeros when no memories exist', async () => {
      mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([])

      const result = await deleteMemoriesBySourceMessageWithVectors('msg-nonexistent')

      expect(result.deleted).toBe(0)
      expect(result.vectorsRemoved).toBe(0)
      expect(mockDeleteMemoriesWithUnlinkBatch).not.toHaveBeenCalled()
    })

    it('should log cascade delete info', async () => {
      mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([mockMemories[0]])
      mockDeleteMemoriesWithUnlinkBatch.mockResolvedValue({ deleted: 1, vectorsRemoved: 1 })

      await deleteMemoriesBySourceMessageWithVectors('msg-1')

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Memory] Cascade deleted memories for source message',
        expect.objectContaining({
          sourceMessageId: 'msg-1',
          deleted: 1,
          vectorsRemoved: 1,
        })
      )
    })
  })

  // ============================================================================
  // deleteMemoriesBySourceMessagesWithVectors Tests
  // ============================================================================
  describe('deleteMemoriesBySourceMessagesWithVectors', () => {
    it('should handle empty array', async () => {
      const result = await deleteMemoriesBySourceMessagesWithVectors([])

      expect(result.deleted).toBe(0)
      expect(result.vectorsRemoved).toBe(0)
      expect(mockMemoriesRepo.findBySourceMessageId).not.toHaveBeenCalled()
    })

    it('should delete memories for multiple source messages', async () => {
      mockMemoriesRepo.findBySourceMessageId
        .mockResolvedValueOnce([mockMemories[0]])
        .mockResolvedValueOnce([mockMemories[2]])
      mockDeleteMemoriesWithUnlinkBatch.mockResolvedValue({ deleted: 2, vectorsRemoved: 2 })

      const result = await deleteMemoriesBySourceMessagesWithVectors(['msg-1', 'msg-2'])

      expect(result).toEqual({ deleted: 2, vectorsRemoved: 2 })
      expect(mockMemoriesRepo.findBySourceMessageId).toHaveBeenCalledTimes(2)
      // The chokepoint is called once with the full union of doomed IDs so
      // the neighbour-scan only fires once for the whole swipe group.
      expect(mockDeleteMemoriesWithUnlinkBatch).toHaveBeenCalledTimes(1)
      expect(mockDeleteMemoriesWithUnlinkBatch).toHaveBeenCalledWith(['memory-1', 'memory-3'])
    })

    it('should log bulk deletion info', async () => {
      mockMemoriesRepo.findBySourceMessageId.mockResolvedValue([mockMemories[0]])
      mockDeleteMemoriesWithUnlinkBatch.mockResolvedValue({ deleted: 1, vectorsRemoved: 1 })

      await deleteMemoriesBySourceMessagesWithVectors(['msg-1', 'msg-2'])

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Memory] Bulk cascade deleted memories for swipe group',
        expect.objectContaining({
          messageCount: 2,
        })
      )
    })
  })

  // ============================================================================
  // updateMemoryWithEmbedding Tests
  // ============================================================================
  describe('updateMemoryWithEmbedding', () => {
    const options = { userId: 'user-123' }

    it('should update memory and regenerate embedding when content changes', async () => {
      mockMemoriesRepo.findByIdForCharacter = jest.fn().mockResolvedValue(mockMemories[0])
      mockMemoriesRepo.updateForCharacter.mockResolvedValue({
        ...mockMemories[0],
        content: 'Updated content',
      })
      mockGenerateEmbedding.mockResolvedValue({
        embedding: [0.7, 0.8, 0.9],
        model: 'test-model',
      })
      mockVectorStore.hasVector.mockReturnValue(true)

      // Re-import to get function with mocked findByIdForCharacter
      jest.isolateModules(() => {
        const serviceModule = require('@/lib/memory/memory-service')
        updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      })

      const result = await updateMemoryWithEmbedding(
        'char-1',
        'memory-1',
        { content: 'Updated content' },
        options
      )

      expect(mockGenerateEmbedding).toHaveBeenCalled()
      expect(mockVectorStore.updateVector).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('embeds before writing: a failed embed throws and leaves the row untouched', async () => {
      mockMemoriesRepo.findByIdForCharacter = jest.fn().mockResolvedValue(mockMemories[0])
      mockGenerateEmbedding.mockRejectedValue(new Error('provider down'))

      jest.isolateModules(() => {
        const serviceModule = require('@/lib/memory/memory-service')
        updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      })

      await expect(
        updateMemoryWithEmbedding('char-1', 'memory-1', { content: 'Updated content' }, options)
      ).rejects.toMatchObject({ name: 'MemoryReembedError', memoryId: 'memory-1' })
      expect(mockMemoriesRepo.updateForCharacter).not.toHaveBeenCalled()
      expect(mockVectorStore.updateVector).not.toHaveBeenCalled()
    })

    it('writes the new text and its embedding in one update, embedded from the edited text', async () => {
      mockMemoriesRepo.findByIdForCharacter = jest.fn().mockResolvedValue(mockMemories[0])
      mockMemoriesRepo.updateForCharacter.mockImplementation(async (_c: any, _id: any, patch: any) => ({
        ...mockMemories[0],
        ...patch,
      }))
      mockGenerateEmbedding.mockResolvedValue({ embedding: [0.7, 0.8, 0.9], model: 'test-model' })
      mockVectorStore.hasVector.mockReturnValue(true)

      jest.isolateModules(() => {
        const serviceModule = require('@/lib/memory/memory-service')
        updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      })

      const result = await updateMemoryWithEmbedding('char-1', 'memory-1', { content: 'Updated content' }, options)

      expect(mockMemoriesRepo.updateForCharacter).toHaveBeenCalledTimes(1)
      expect(mockMemoriesRepo.updateForCharacter).toHaveBeenCalledWith('char-1', 'memory-1', {
        content: 'Updated content',
        embedding: [0.7, 0.8, 0.9],
      })
      expect(String(mockGenerateEmbedding.mock.calls[0][0])).toContain('Updated content')
      expect(mockVectorStore.updateVector).toHaveBeenCalledWith('memory-1', [0.7, 0.8, 0.9])
      expect((result as any).embedding).toEqual([0.7, 0.8, 0.9])
    })

    it('should return null when memory not found', async () => {
      mockMemoriesRepo.findByIdForCharacter = jest.fn().mockResolvedValue(null)

      jest.isolateModules(() => {
        const serviceModule = require('@/lib/memory/memory-service')
        updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      })

      const result = await updateMemoryWithEmbedding(
        'char-1',
        'nonexistent',
        { content: 'Updated content' },
        options
      )

      expect(result).toBeNull()
    })

    it('should skip embedding regeneration when content unchanged', async () => {
      mockMemoriesRepo.findByIdForCharacter = jest.fn().mockResolvedValue(mockMemories[0])
      mockMemoriesRepo.updateForCharacter.mockResolvedValue({
        ...mockMemories[0],
        importance: 0.9, // Only importance changed
      })

      jest.isolateModules(() => {
        const serviceModule = require('@/lib/memory/memory-service')
        updateMemoryWithEmbedding = serviceModule.updateMemoryWithEmbedding
      })

      await updateMemoryWithEmbedding(
        'char-1',
        'memory-1',
        { importance: 0.9 },
        options
      )

      expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    })
  })
})
