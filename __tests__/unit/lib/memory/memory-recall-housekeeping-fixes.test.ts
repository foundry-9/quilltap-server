/**
 * Memory recall and housekeeping fixes
 * (docs/developer/features/memory-recall-and-housekeeping-fixes.md)
 *
 * F1 — a near-duplicate re-observation counts as reinforcement
 * F3 — reinforcement footnotes are capped
 * F7 — the dynamic head and archive are sized from the memory budget
 * F8 — the batch delete never reports NaN; the outcome cache never stores it
 * F9 — housekeeping/dedup merges fold the loser into the survivor
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

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
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
const vectorMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock<any> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock<any> }

const gate = require('@/lib/memory/memory-gate') as typeof import('@/lib/memory/memory-gate')
const merge = require('@/lib/memory/memory-merge') as typeof import('@/lib/memory/memory-merge')
const outcomeCache = require('@/lib/memory/housekeeping-outcome-cache') as typeof import('@/lib/memory/housekeeping-outcome-cache')
const injector = require('@/lib/chat/context/memory-injector') as typeof import('@/lib/chat/context/memory-injector')

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

function makeVectorStore() {
  return {
    hasVector: jest.fn(() => true),
    updateVector: jest.fn(async () => undefined),
    addVector: jest.fn(async () => undefined),
    save: jest.fn(async () => undefined),
  }
}

let updateForCharacter: jest.Mock<any>
let vectorStore: ReturnType<typeof makeVectorStore>

beforeEach(() => {
  jest.clearAllMocks()
  updateForCharacter = jest.fn(async (characterId: string, id: string, patch: Partial<Memory>) => ({ ...makeMemory({ id, characterId }), ...patch }))
  factoryMock.getRepositories.mockReturnValue({ memories: { updateForCharacter } })
  vectorStore = makeVectorStore()
  vectorMock.getCharacterVectorStore.mockResolvedValue(vectorStore)
  embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: EMBEDDING, model: 'test', dimensions: 2 })
})

// =============================================================================
// F1
// =============================================================================

describe('F1 — absorbNearDuplicate', () => {
  it('bumps count and reinforcedImportance, leaves content and embedding alone', async () => {
    const existing = makeMemory({ reinforcementCount: 1, importance: 0.6 })

    const result = await gate.absorbNearDuplicate(existing)

    expect(updateForCharacter).toHaveBeenCalledTimes(1)
    const [charId, memId, patch] = updateForCharacter.mock.calls[0] as [string, string, Partial<Memory>]
    expect(charId).toBe('char-1')
    expect(memId).toBe('mem-1')
    expect(patch.reinforcementCount).toBe(2)
    expect(patch.reinforcedImportance).toBeCloseTo(gate.calculateReinforcedImportance(0.6, 2))
    expect(typeof patch.lastReinforcedAt).toBe('string')
    expect(patch).not.toHaveProperty('content')
    expect(patch).not.toHaveProperty('embedding')
    expect(embedMock.generateEmbeddingForUser).not.toHaveBeenCalled()
    expect(result.reinforcementCount).toBe(2)
    expect(result.content).toBe(existing.content)
  })

  it('returns the locally patched row when the write is buffered (job child returns undefined)', async () => {
    updateForCharacter.mockResolvedValue(undefined)
    const existing = makeMemory({ reinforcementCount: 4 })

    const result = await gate.absorbNearDuplicate(existing)

    expect(result.reinforcementCount).toBe(5)
    expect(result.id).toBe('mem-1')
  })

  it('returns the original row when the memory is gone (repository null)', async () => {
    updateForCharacter.mockResolvedValue(null)
    const existing = makeMemory()

    const result = await gate.absorbNearDuplicate(existing)

    expect(result).toBe(existing)
  })
})

// =============================================================================
// F3
// =============================================================================

describe('F3 — reinforcement footnote cap', () => {
  const footnotes = (n: number) => Array.from({ length: n }, (_, i) => `[+] Detail${i}`).join('\n')

  it('counts only [+] lines', () => {
    expect(gate.countReinforcementFootnotes(`Body text\n${footnotes(3)}\nnot [+] a footnote`)).toBe(3)
  })

  it('appends up to the cap and no further', () => {
    const base = `Body\n${footnotes(gate.MAX_REINFORCEMENT_FOOTNOTES - 2)}`
    const { content, appended } = gate.appendCappedFootnotes(base, ['Alpha', 'Beta', 'Gamma'])
    expect(appended).toEqual(['Alpha', 'Beta'])
    expect(gate.countReinforcementFootnotes(content)).toBe(gate.MAX_REINFORCEMENT_FOOTNOTES)
  })

  it('past the cap: bumps count, unions entities, appends nothing, does not re-embed', async () => {
    const existing = makeMemory({
      content: `Friday keeps the ledger.\n${footnotes(gate.MAX_REINFORCEMENT_FOOTNOTES)}`,
      entities: ['Friday'],
      reinforcementCount: 3,
    })

    const { novelDetails } = await gate.reinforceMemory(
      existing,
      'Friday keeps the ledger with Marguerite in Valparaiso.',
      'Friday keeps the ledger.',
      'user-1',
      undefined,
      { occurredAt: null, narrativeTime: null, entities: ['Marguerite'] },
    )

    expect(novelDetails).toEqual([])
    const patch = updateForCharacter.mock.calls[0][2] as Partial<Memory>
    expect(patch.reinforcementCount).toBe(4)
    expect(patch).not.toHaveProperty('content')
    expect(patch.entities).toEqual(['Friday', 'Marguerite'])
    expect(embedMock.generateEmbeddingForUser).not.toHaveBeenCalled()
  })

  it('below the cap: appends novel details and re-embeds', async () => {
    const existing = makeMemory({ content: 'Friday keeps the ledger.' })

    const { novelDetails } = await gate.reinforceMemory(
      existing,
      'Friday keeps the ledger with Marguerite.',
      'Friday keeps the ledger.',
      'user-1',
    )

    expect(novelDetails).toContain('Marguerite')
    const patch = updateForCharacter.mock.calls[0][2] as Partial<Memory>
    expect(patch.content).toContain('[+] Marguerite')
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
  })
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

describe('F8 — deleteMemoriesWithUnlinkBatch count', () => {
  function setupBatch(bulkDeleteResult: unknown) {
    dbMock.rawQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('relatedMemoryIds IS NOT NULL')) return []
      return [
        { id: 'a', characterId: 'char-1' },
        { id: 'b', characterId: 'char-1' },
        { id: 'c', characterId: 'char-2' },
      ]
    })
    const bulkDelete = jest.fn(async () => bulkDeleteResult)
    factoryMock.getRepositories.mockReturnValue({ memories: { updateForCharacter, bulkDelete } })
    return bulkDelete
  }

  it('counts the resolved ids when the buffered delete returns nothing (job child)', async () => {
    const bulkDelete = setupBatch(undefined)
    const deleted = await gate.deleteMemoriesWithUnlinkBatch(['a', 'b', 'c', 'gone'])
    expect(bulkDelete).toHaveBeenCalledTimes(2)
    expect(deleted).toBe(3)
    expect(Number.isFinite(deleted)).toBe(true)
  })

  it('leaves skipScrubIds neighbours alone (a merge survivor already rewrote its links)', async () => {
    dbMock.rawQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('relatedMemoryIds IS NOT NULL')) {
        return [
          { id: 'survivor', characterId: 'char-1', relatedMemoryIds: '["a","n1"]' },
          { id: 'other', characterId: 'char-1', relatedMemoryIds: '["a"]' },
        ]
      }
      return [{ id: 'a', characterId: 'char-1' }]
    })
    const bulkDelete = jest.fn(async () => 1)
    factoryMock.getRepositories.mockReturnValue({ memories: { updateForCharacter, bulkDelete } })

    await gate.deleteMemoriesWithUnlinkBatch(['a'], { skipScrubIds: new Set(['survivor']) })

    const scrubbed = updateForCharacter.mock.calls.map(c => c[1])
    expect(scrubbed).toEqual(['other'])
  })

  it('trusts the repository count in the parent', async () => {
    setupBatch(1)
    const deleted = await gate.deleteMemoriesWithUnlinkBatch(['a', 'b', 'c'])
    expect(deleted).toBe(2)
  })
})

describe('F8 — housekeeping outcome cache', () => {
  it('a non-finite deleted count still arms the ineffective-sweep backoff', () => {
    outcomeCache.recordHousekeepingOutcome('char-nan', Number.NaN, 5013, 5000)
    expect(outcomeCache.shouldSkipWatermarkSweep('char-nan')).toBe(true)
  })
})

// =============================================================================
// F9
// =============================================================================

describe('F9 — planMemoryMerge / applyMemoryMerge', () => {
  it('folds details, reinforcement, links and the earliest occurredAt into the survivor', () => {
    const survivor = makeMemory({
      id: 'keep',
      content: 'Friday keeps the ledger.',
      importance: 0.6,
      reinforcementCount: 2,
      relatedMemoryIds: ['n1', 'loser'],
      occurredAt: '2026-03-10T00:00:00.000Z',
    })
    const loser = makeMemory({
      id: 'loser',
      content: 'Friday keeps the ledger for Marguerite.',
      reinforcementCount: 3,
      relatedMemoryIds: ['keep', 'n2', 'doomed'],
      occurredAt: '2026-03-08T00:00:00.000Z',
    })

    const plan = merge.planMemoryMerge(survivor, [loser], ['doomed'])

    expect(plan.contentChanged).toBe(true)
    expect(plan.mergedDetails).toEqual(['Marguerite'])
    expect(plan.patch.content).toBe('Friday keeps the ledger.\n[+] Marguerite')
    expect(plan.patch.reinforcementCount).toBe(5)
    expect(plan.patch.reinforcedImportance).toBeCloseTo(gate.calculateReinforcedImportance(0.6, 5))
    expect(new Set(plan.patch.relatedMemoryIds)).toEqual(new Set(['n1', 'n2']))
    expect(plan.patch.occurredAt).toBe('2026-03-08T00:00:00.000Z')
  })

  it('respects the footnote cap when folding', () => {
    const full = Array.from({ length: gate.MAX_REINFORCEMENT_FOOTNOTES }, (_, i) => `[+] D${i}`).join('\n')
    const survivor = makeMemory({ id: 'keep', content: `Body\n${full}` })
    const loser = makeMemory({ id: 'loser', content: 'Body with Marguerite and Valparaiso.' })

    const plan = merge.planMemoryMerge(survivor, [loser])

    expect(plan.contentChanged).toBe(false)
    expect(plan.mergedDetails).toEqual([])
    expect(plan.patch).not.toHaveProperty('content')
    expect(plan.patch.reinforcementCount).toBe(2)
  })

  it('applies the patch and re-embeds when content changed', async () => {
    const survivor = makeMemory({ id: 'keep', content: 'Friday keeps the ledger.' })
    const loser = makeMemory({ id: 'loser', content: 'Friday keeps the ledger for Marguerite.' })
    const plan = merge.planMemoryMerge(survivor, [loser])

    const updated = await merge.applyMemoryMerge(survivor, plan, { userId: 'user-1' })

    expect(updated?.content).toContain('[+] Marguerite')
    expect(updateForCharacter.mock.calls[0][2]).toMatchObject({ reinforcementCount: 2 })
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
    expect(vectorStore.updateVector).toHaveBeenCalledWith('keep', EMBEDDING)
  })

  it('does not re-embed when only counts change', async () => {
    const survivor = makeMemory({ id: 'keep', content: 'Same words.' })
    const loser = makeMemory({ id: 'loser', content: 'Same words.' })
    const plan = merge.planMemoryMerge(survivor, [loser])

    await merge.applyMemoryMerge(survivor, plan, { userId: 'user-1' })

    expect(updateForCharacter).toHaveBeenCalledTimes(1)
    expect(embedMock.generateEmbeddingForUser).not.toHaveBeenCalled()
  })
})
