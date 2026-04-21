/**
 * Unit tests for lib/memory/housekeeping.ts focusing on:
 * - Default cap is 2000 (was 1000 in earlier versions)
 * - Protection gate uses a blended score (content + reinforcement + links + recent access),
 *   with MANUAL as the only hard override
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

  describe('blended protection gate', () => {
    it('protects a reinforced memory whose reinforcedImportance lands at 0.5', async () => {
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

    it('protects a reinforced memory still being accessed recently', async () => {
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
      const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
      const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
      const memory = makeMemory({
        id: 'reinforced-but-stale',
        importance: 0.1,
        reinforcedImportance: 0.2,
        reinforcementCount: 8,
        lastAccessedAt: longAgo,
        createdAt: ancient,
      })
      mockMemoriesRepo.findByCharacterId.mockResolvedValue([memory])

      const result = await runHousekeeping('char-1')

      expect(result.deleted).toBe(1)
      expect(result.deletedIds).toContain('reinforced-but-stale')
    })

    it('lets the cap pass delete old high-importance memories without usage evidence', async () => {
      // Under the previous gate, importance >= 0.7 was permanent immunity and
      // the cap pass couldn't touch these rows. Under the blended score, a
      // 400-day-old 0.8-importance memory with reinforcementCount=1 and no
      // access has a protection score below 0.5, so the cap pass can delete
      // it when over the limit.
      const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
      const staleHigh = Array.from({ length: 10 }, (_, i) =>
        makeMemory({
          id: `stale-high-${i}`,
          importance: 0.8,
          reinforcedImportance: 0.8,
          reinforcementCount: 1,
          lastAccessedAt: null,
          createdAt: ancient,
        })
      )
      mockMemoriesRepo.findByCharacterId.mockResolvedValue(staleHigh)

      // Tight cap so the third pass kicks in
      const result = await runHousekeeping('char-1', { maxMemories: 3 })

      expect(result.deleted).toBeGreaterThan(0)
    })
  })

  it('protects a fresh high-importance memory', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const memory = makeMemory({
      importance: 0.8,
      reinforcedImportance: 0.8,
      reinforcementCount: 1,
      createdAt: yesterday,
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
