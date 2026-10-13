/**
 * Memory recall and housekeeping fixes
 * (docs/developer/features/memory-recall-and-housekeeping-fixes.md)
 *
 * (F1 — near-duplicates count, F3 — the footnote cap and F9 — dedup folds
 * are pinned with the one combine in admission-fold.test.ts and
 * admission-admit.test.ts.)
 *
 * F7 — the dynamic head and archive are sized from the memory budget
 * F8 — retirement never reports NaN; the outcome cache never stores it
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
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
  lexicalEmbeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).lexicalEmbeddingTextFor,
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))

jest.mock('@/lib/logger', () => {
  const make = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import type { Memory } from '@/lib/schemas/types'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock<any> }
const dbMock = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock<any> }
const indexMock = jest.requireMock('@/lib/memory/index-store') as {
  memoryIndex: Record<'upsert' | 'remove' | 'setTier', jest.Mock<any>>
}
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock<any> }

const retire = require('@/lib/memory/retire') as typeof import('@/lib/memory/retire')
const injector = require('@/lib/memory/recall/assemble') as typeof import('@/lib/memory/recall/assemble')

const EMBEDDING = new Float32Array([0.6, 0.8])

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    characterId: 'char-1',
    content: 'Friday keeps the ledger at Lighthouse Point.',
    summary: 'Friday keeps the ledger.',
    keywords: [],
    tags: [],
    importance: 0.6,
    embedding: EMBEDDING,
    source: 'AUTO',
    sourceMessageId: null,
    lastAccessedAt: null,
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

let updateForCharacter: jest.Mock<any>

beforeEach(() => {
  jest.clearAllMocks()
  updateForCharacter = jest.fn(async (characterId: string, id: string, patch: Partial<Memory>) => ({ ...makeMemory({ id, characterId }), ...patch }))
  factoryMock.getRepositories.mockReturnValue({ memories: { updateForCharacter } })
  indexMock.memoryIndex.upsert.mockResolvedValue([])
  indexMock.memoryIndex.remove.mockImplementation(async (_c: string, ids: string[]) => ids.length)
  indexMock.memoryIndex.setTier.mockResolvedValue(0)
  embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: EMBEDDING, model: 'test', dimensions: 2 })
})

// =============================================================================
// F7
// =============================================================================

describe('F7 — sizeMemoryPools', () => {
  it('keeps the historical floors on the minimum budget', () => {
    const s = injector.sizeMemoryPools(2000, false)
    expect(s.headTokenBudget).toBe(300)
    expect(s.headEntries).toBe(8)
    expect(s.archiveSize).toBe(28)
    expect(s.archiveTokenBudget).toBe(1700)
  })

  it('scales up on a 200k-context budget (~8k tokens) within the ceilings', () => {
    const s = injector.sizeMemoryPools(8000, false)
    expect(s.headTokenBudget).toBe(injector.DYNAMIC_HEAD_MAX_TOKEN_BUDGET)
    expect(s.headEntries).toBe(injector.DYNAMIC_HEAD_MAX_SIZE)
    expect(s.archiveSize).toBe(injector.FROZEN_ARCHIVE_MAX_SIZE)
  })

  it('never goes below the floors on a tiny budget', () => {
    const s = injector.sizeMemoryPools(500, false)
    expect(s.headTokenBudget).toBe(injector.DYNAMIC_HEAD_TOKEN_BUDGET)
    expect(s.headEntries).toBe(injector.DYNAMIC_HEAD_DEFAULT_SIZE)
    expect(s.archiveSize).toBe(injector.FROZEN_ARCHIVE_MIN_SIZE)
  })

  it('doubles the head on retrospective turns, bounded by the memory budget', () => {
    const plain = injector.sizeMemoryPools(8000, false)
    const retro = injector.sizeMemoryPools(8000, true)
    expect(retro.headTokenBudget).toBe(plain.headTokenBudget * 2)
    expect(retro.headEntries).toBe(plain.headEntries * 2)
    expect(retro.archiveTokenBudget).toBe(8000 - retro.headTokenBudget)

    const tight = injector.sizeMemoryPools(500, true)
    expect(tight.headTokenBudget).toBeLessThanOrEqual(500)
    expect(tight.headEntries).toBeGreaterThanOrEqual(injector.RETRO_HEAD_SIZE)
  })

  it('keeps the archive size the same on retrospective turns (byte stability)', () => {
    for (const budget of [2000, 5000, 8000, 40000]) {
      expect(injector.sizeMemoryPools(budget, true).archiveSize).toBe(
        injector.sizeMemoryPools(budget, false).archiveSize,
      )
    }
  })
})

// =============================================================================
// F8
// =============================================================================

/** Retirement's digest-scrub reads, finding nothing to scrub. */
function noDigestScrub() {
  return {
    findDigestsContainingMembers: jest.fn(async () => []),
    findIdsSupersededByAny: jest.fn(async () => []),
  }
}

describe('F8 — retireMemories count', () => {
  function setupBatch(bulkDeleteResult: unknown) {
    dbMock.rawQuery.mockImplementation(async () => [
      { id: 'a', characterId: 'char-1' },
      { id: 'b', characterId: 'char-1' },
      { id: 'c', characterId: 'char-2' },
    ])
    const bulkDeleteUnsafe = jest.fn(async () => bulkDeleteResult)
    factoryMock.getRepositories.mockReturnValue({
      memories: { updateForCharacter, bulkDeleteUnsafe, removeRelatedMemoryIdsEverywhere: jest.fn(), ...noDigestScrub() },
    })
    return bulkDeleteUnsafe
  }

  it('counts the resolved ids when the buffered delete returns nothing (job child)', async () => {
    const bulkDeleteUnsafe = setupBatch(undefined)
    const { retired } = await retire.retireMemories(['a', 'b', 'c', 'gone'], { reason: 'message-cascade' })
    expect(bulkDeleteUnsafe).toHaveBeenCalledTimes(2)
    expect(retired).toBe(3)
    expect(Number.isFinite(retired)).toBe(true)
    // The retired rows' vectors leave the index with them.
    expect(indexMock.memoryIndex.remove).toHaveBeenCalledWith('char-1', ['a', 'b'])
    expect(indexMock.memoryIndex.remove).toHaveBeenCalledWith('char-2', ['c'])
  })

  it('scrubs neighbours (a merge survivor included) with a removal delta, never a stale list', async () => {
    dbMock.rawQuery.mockImplementation(async () => [{ id: 'a', characterId: 'char-1' }])
    const bulkDeleteUnsafe = jest.fn(async () => 1)
    const removeRelatedMemoryIdsEverywhere = jest.fn(async () => 2)
    factoryMock.getRepositories.mockReturnValue({
      memories: { updateForCharacter, bulkDeleteUnsafe, removeRelatedMemoryIdsEverywhere, ...noDigestScrub() },
    })

    await retire.retireMemories(['a'], { reason: 'near-duplicate-fold' })

    // Applied after the survivor's own link write, the delta removes only the
    // deleted id from whatever list the row then holds (bug 234).
    expect(removeRelatedMemoryIdsEverywhere).toHaveBeenCalledWith(['a'])
    expect(updateForCharacter).not.toHaveBeenCalled()
  })

  it('trusts the repository count in the parent', async () => {
    setupBatch(1)
    const { retired } = await retire.retireMemories(['a', 'b', 'c'], { reason: 'message-cascade' })
    expect(retired).toBe(2)
  })
})
