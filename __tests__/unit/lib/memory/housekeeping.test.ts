/**
 * Unit tests for lib/memory/housekeeping.ts focusing on:
 * - Default cap is 2000 (was 1000 in earlier versions)
 * - Tightened reinforcement-based immortality: count >= 5 alone no longer protects
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'

// Note: @/lib/repositories/factory and @/lib/embedding/vector-store are already
// mocked in jest.setup.ts (setupFilesAfterEnv runs AFTER test-level jest.mock).
// We reach into those mocks via jest.requireMock below.

import { runHousekeeping } from '@/lib/memory/housekeeping'
import type { Memory } from '@/lib/schemas/types'


function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString() // 12 months ago
  return {
    id: `mem-${Math.random().toString(36).slice(2, 10)}`,
    characterId: 'char-1',
    content: 'Test content',
    summary: 'Test summary',
    keywords: [],
    tags: [],
    importance: 0.2,
    aboutCharacterId: null,
    chatId: null,
    projectId: null,
    embedding: null,
    source: 'AUTO',
    sourceMessageId: null,
    lastAccessedAt: null,
    createdAt: ancient,
    updatedAt: ancient,
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.2,
    ...overrides,
  } as Memory
}

describe('housekeeping', () => {
  let mockMemoriesRepo: {
    findByCharacterId: jest.Mock
    bulkDelete: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Reach into the setup-level mocks (jest.setup.ts) inside beforeEach so the
    // jest.fn()s have been registered by the time we call .mockReturnValue.
    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
      getRepositories: jest.Mock
    }
    const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as {
      getCharacterVectorStore: jest.Mock
    }

    mockMemoriesRepo = {
      findByCharacterId: jest.fn(),
      bulkDelete: jest.fn(),
    }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: mockMemoriesRepo,
    })

    vectorStoreMock.getCharacterVectorStore.mockResolvedValue({
      getAllEntries: jest.fn().mockReturnValue([]),
      search: jest.fn().mockReturnValue([]),
      addVector: jest.fn(),
      updateVector: jest.fn(),
      removeVector: jest.fn(),
      hasVector: jest.fn().mockReturnValue(false),
      save: jest.fn(),
    })

    mockMemoriesRepo.bulkDelete.mockImplementation(((_characterId: string, ids: string[]) =>
      Promise.resolve(ids.length)) as any)
  })

  it('defaults maxMemories to 2000', async () => {
    // 50 memories, all well under 2000 — nothing should be pruned for count reasons
    const memories = Array.from({ length: 50 }, () =>
      makeMemory({ importance: 0.5, reinforcedImportance: 0.5, lastAccessedAt: null })
    )
    mockMemoriesRepo.findByCharacterId.mockResolvedValue(memories)

    const result = await runHousekeeping('char-1')

    expect(result.deleted).toBe(0)
    expect(result.totalBefore).toBe(50)
  })

  describe('tightened reinforcement-based immortality', () => {
    it('protects a heavily reinforced memory when reinforcedImportance >= 0.5', async () => {
      const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
      const memory = makeMemory({
        importance: 0.2,
        reinforcedImportance: 0.5,
        reinforcementCount: 8,
        lastAccessedAt: null,
        createdAt: ancient,
      })
      mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

      const result = await runHousekeeping('char-1')

      expect(result.deleted).toBe(0)
    })

    it('protects a heavily reinforced memory accessed within the last 90 days', async () => {
      const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const memory = makeMemory({
        importance: 0.2,
        reinforcedImportance: 0.3,
        reinforcementCount: 8,
        lastAccessedAt: recent,
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      })
      mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

      const result = await runHousekeeping('char-1')

      expect(result.deleted).toBe(0)
    })

    it('does NOT protect a reinforced-but-unimportant-and-stale memory', async () => {
      // reinforcementCount >= 5 used to grant permanent immunity.
      // Now it requires importance or recency — this memory has neither.
      const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
      const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
      const memory = makeMemory({
        id: 'reinforced-but-stale',
        importance: 0.1,
        reinforcedImportance: 0.2, // below the 0.3 minImportance floor AND below the 0.5 reinforcement-protection threshold
        reinforcementCount: 8,
        lastAccessedAt: longAgo, // 200 days ago — beyond 90 AND 6 months
        createdAt: ancient,
      })
      mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

      const result = await runHousekeeping('char-1')

      expect(result.deleted).toBe(1)
      expect(result.deletedIds).toContain('reinforced-but-stale')
    })
  })

  it('still protects high-importance memories regardless of reinforcement count', async () => {
    const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      reinforcementCount: 1,
      createdAt: ancient,
    })
    mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

    const result = await runHousekeeping('char-1')

    expect(result.deleted).toBe(0)
  })

  it('still protects MANUAL memories regardless of age/importance', async () => {
    const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const memory = makeMemory({
      importance: 0.1,
      reinforcedImportance: 0.1,
      reinforcementCount: 1,
      source: 'MANUAL',
      createdAt: ancient,
    })
    mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

    const result = await runHousekeeping('char-1')

    expect(result.deleted).toBe(0)
  })
})
