/**
 * Unit tests for MemoriesRepository.findMostImportant — the frozen archive's
 * candidate pool. Pins the ranking key (reinforcedImportance, then
 * COALESCE(lastReinforcedAt, createdAt), then id) so the pool is deterministic
 * when most of a corpus ties on importance.
 */

import { describe, it, expect, jest, beforeEach, beforeAll } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

const { rawQuery: mockRawQuery } = jest.requireMock('@/lib/database/manager') as {
  rawQuery: jest.Mock<(...args: any[]) => any>
}

import type { MemoriesRepository as MemoriesRepositoryType } from '@/lib/database/repositories/memories.repository'

let MemoriesRepository: typeof MemoriesRepositoryType
beforeAll(async () => {
  ;({ MemoriesRepository } = await import('@/lib/database/repositories/memories.repository'))
})

const CHARACTER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const MEMORY = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f50'

describe('MemoriesRepository.findMostImportant', () => {
  let repo: InstanceType<typeof MemoriesRepositoryType>

  beforeEach(() => {
    jest.clearAllMocks()
    repo = new MemoriesRepository()
  })

  it('ranks on reinforcedImportance with a recency and id tiebreak', async () => {
    mockRawQuery.mockResolvedValue([])

    await repo.findMostImportant(CHARACTER, 100)

    expect(mockRawQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockRawQuery.mock.calls[0] as [string, unknown[]]
    const normalized = sql.replace(/\s+/g, ' ')
    expect(normalized).toContain('WHERE characterId = ?')
    expect(normalized).toContain(
      'ORDER BY reinforcedImportance DESC, COALESCE(lastReinforcedAt, createdAt) DESC, id ASC',
    )
    expect(normalized).toContain('LIMIT ?')
    expect(params).toEqual([CHARACTER, 100])
  })

  it('returns [] without querying for a non-positive limit', async () => {
    expect(await repo.findMostImportant(CHARACTER, 0)).toEqual([])
    expect(mockRawQuery).not.toHaveBeenCalled()
  })

  it('hydrates JSON array columns from the raw rows', async () => {
    const now = new Date().toISOString()
    mockRawQuery.mockResolvedValue([
      {
        id: MEMORY,
        characterId: CHARACTER,
        aboutCharacterId: null,
        chatId: null,
        projectId: null,
        content: 'The lighthouse keeper owes Friday a favour.',
        summary: 'Keeper owes a favour.',
        keywords: '["lighthouse"]',
        tags: '[]',
        importance: 0.9,
        embedding: null,
        source: 'AUTO',
        sourceMessageId: null,
        lastAccessedAt: null,
        createdAt: now,
        updatedAt: now,
        reinforcementCount: 3,
        lastReinforcedAt: now,
        relatedMemoryIds: '[]',
        entities: '["Lighthouse Point"]',
        reinforcedImportance: 0.979,
      },
    ])

    const result = await repo.findMostImportant(CHARACTER, 10)

    expect(result).toHaveLength(1)
    expect(result[0].keywords).toEqual(['lighthouse'])
    expect(result[0].relatedMemoryIds).toEqual([])
    expect(result[0].reinforcementCount).toBe(3)
  })
})
