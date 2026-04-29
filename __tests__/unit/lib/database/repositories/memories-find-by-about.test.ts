/**
 * Unit tests for MemoriesRepository.findByCharacterAboutCharacters
 *
 * The method drops to rawQuery so it can use a window-function partition
 * (one round-trip, server-side per-about-character cap). These tests pin the
 * SQL shape and parameter wiring, plus the hand-rolled JSON column hydration
 * that has to live alongside the rawQuery path.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

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
  rawQuery: jest.Mock
}

import type { MemoriesRepository as MemoriesRepositoryType } from '@/lib/database/repositories/memories.repository'

let MemoriesRepository: typeof MemoriesRepositoryType
beforeAll(async () => {
  ;({ MemoriesRepository } = await import('@/lib/database/repositories/memories.repository'))
})

const VALID_UUID_HOLDER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const VALID_UUID_ABOUT_A = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e'
const VALID_UUID_ABOUT_B = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f'
const VALID_UUID_MEMORY = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f50'

describe('MemoriesRepository.findByCharacterAboutCharacters', () => {
  let repo: MemoriesRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repo = new MemoriesRepository()
  })

  it('returns [] without querying when aboutCharacterIds is empty', async () => {
    const result = await repo.findByCharacterAboutCharacters(VALID_UUID_HOLDER, [], 50)
    expect(result).toEqual([])
    expect(mockRawQuery).not.toHaveBeenCalled()
  })

  it('returns [] without querying when limitPerCharacter <= 0', async () => {
    const result = await repo.findByCharacterAboutCharacters(
      VALID_UUID_HOLDER,
      [VALID_UUID_ABOUT_A],
      0,
    )
    expect(result).toEqual([])
    expect(mockRawQuery).not.toHaveBeenCalled()
  })

  it('issues a window-function query partitioned by aboutCharacterId with the agreed sort key', async () => {
    mockRawQuery.mockResolvedValue([])

    await repo.findByCharacterAboutCharacters(
      VALID_UUID_HOLDER,
      [VALID_UUID_ABOUT_A, VALID_UUID_ABOUT_B],
      75,
    )

    expect(mockRawQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockRawQuery.mock.calls[0] as [string, unknown[]]

    // Window function over the partition we want, with the sort key the
    // formatter expects (importance dominant, recent reinforcement breaking
    // ties — falling back to createdAt when never reinforced).
    expect(sql).toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(/)
    expect(sql).toMatch(/PARTITION BY aboutCharacterId/)
    expect(sql).toMatch(/ORDER BY importance DESC,\s*COALESCE\(lastReinforcedAt, createdAt\) DESC/)
    expect(sql).toMatch(/WHERE rn <= \?/)

    // One placeholder per about-id, no IN-list shortcuts that would skip
    // parameter binding (which would defeat the prepared statement cache).
    expect(sql).toMatch(/aboutCharacterId IN \(\?, \?\)/)
    expect(params).toEqual([VALID_UUID_HOLDER, VALID_UUID_ABOUT_A, VALID_UUID_ABOUT_B, 75])
  })

  it('hydrates JSON-encoded array columns and strips the synthetic rn before validation', async () => {
    const now = '2026-04-29T12:00:00.000Z'
    mockRawQuery.mockResolvedValue([
      {
        id: VALID_UUID_MEMORY,
        characterId: VALID_UUID_HOLDER,
        aboutCharacterId: VALID_UUID_ABOUT_A,
        chatId: null,
        projectId: null,
        content: 'Friday recalls Amy laughing at the joke.',
        summary: 'Amy laughed.',
        keywords: '["amy","laugh"]',
        tags: '[]',
        importance: 0.9,
        embedding: null,
        source: 'AUTO',
        sourceMessageId: null,
        lastAccessedAt: null,
        createdAt: now,
        updatedAt: now,
        reinforcementCount: 1,
        lastReinforcedAt: null,
        relatedMemoryIds: '[]',
        reinforcedImportance: 0.9,
        rn: 1,
      },
    ])

    const result = await repo.findByCharacterAboutCharacters(
      VALID_UUID_HOLDER,
      [VALID_UUID_ABOUT_A],
      10,
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(VALID_UUID_MEMORY)
    expect(result[0].keywords).toEqual(['amy', 'laugh'])
    expect(result[0].tags).toEqual([])
    expect(result[0].relatedMemoryIds).toEqual([])
    // rn is a synthetic ranking column from the CTE; it must not survive
    // through validation onto the Memory entity.
    expect((result[0] as Record<string, unknown>).rn).toBeUndefined()
  })
})
