/**
 * Housekeeping demotes instead of deleting (consolidation-and-tiers spec B4):
 * the cap counts hot rows, passes 1 and 3 move rows to the cold tier, MANUAL
 * and CONSOLIDATED rows are untouched, and the only deletion is the retention
 * sweep of superseded cold AUTO rows.
 */

jest.mock('@/lib/memory/memory-gate', () => ({
  __esModule: true,
  deleteMemoriesWithUnlinkBatch: jest.fn(),
}))
jest.mock('@/lib/instance-settings', () => ({
  __esModule: true,
  getMemoryConsolidationSettings: jest.fn(),
}))

import type { Memory } from '@/lib/schemas/types'

let runHousekeeping: typeof import('@/lib/memory/housekeeping').runHousekeeping

const DAY = 24 * 60 * 60 * 1000
const ancient = () => new Date(Date.now() - 400 * DAY).toISOString()

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 10)}`,
    characterId: 'char-1',
    content: 'c',
    summary: 's',
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
    createdAt: ancient(),
    updatedAt: ancient(),
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.2,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    consolidatedAt: null,
    ...overrides,
  } as Memory
}

describe('housekeeping demotion', () => {
  let memories: Memory[]
  let repo: { findByCharacterIdInBatches: jest.Mock; updateTierBulk: jest.Mock; findExpiredColdIds: jest.Mock; bulkDelete: jest.Mock }
  let setTier: jest.Mock
  let deleteBatch: jest.Mock
  let retention: number | null

  beforeEach(() => {
    jest.clearAllMocks()
    memories = []
    retention = null
    setTier = jest.fn()
    repo = {
      findByCharacterIdInBatches: jest.fn(),
      updateTierBulk: jest.fn(async (_c: string, ids: string[]) => ids.length),
      findExpiredColdIds: jest.fn(async () => []),
      bulkDelete: jest.fn(),
    }
    repo.findByCharacterIdInBatches.mockImplementation((async function* () {
      if (memories.length) yield memories
    }) as any)

    ;(jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }).getRepositories.mockReturnValue({ memories: repo })
    ;(jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock }).getCharacterVectorStore.mockResolvedValue({
      setTier,
      removeVector: jest.fn(),
      save: jest.fn(),
    })
    ;(jest.requireMock('@/lib/instance-settings') as { getMemoryConsolidationSettings: jest.Mock }).getMemoryConsolidationSettings.mockImplementation(
      async () => ({ coldRetentionDays: retention }),
    )
    deleteBatch = (jest.requireMock('@/lib/memory/memory-gate') as { deleteMemoriesWithUnlinkBatch: jest.Mock }).deleteMemoriesWithUnlinkBatch
    deleteBatch.mockImplementation((async (ids: string[]) => ids.length) as any)

    jest.isolateModules(() => {
      runHousekeeping = (require('@/lib/memory/housekeeping') as typeof import('@/lib/memory/housekeeping')).runHousekeeping
    })
  })

  it('pass 1 demotes a low-importance, old, inactive row instead of deleting it', async () => {
    memories = [makeMemory({ id: 'stale', importance: 0.1, reinforcedImportance: 0.1 })]
    const result = await runHousekeeping('char-1')
    expect(result.demoted).toBe(1)
    expect(result.demotedIds).toEqual(['stale'])
    expect(result.deleted).toBe(0)
    expect(repo.updateTierBulk).toHaveBeenCalledWith('char-1', ['stale'], 'cold')
    expect(setTier).toHaveBeenCalledWith(['stale'], 'cold')
    expect(deleteBatch).not.toHaveBeenCalled()
  })

  it('pass 3 demotes the excess over the cap and deletes nothing', async () => {
    memories = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ id: `h${i}`, importance: 0.8, reinforcedImportance: 0.8 }),
    )
    const result = await runHousekeeping('char-1', { maxMemories: 3 })
    expect(result.demoted).toBe(7)
    expect(result.totalBefore).toBe(10)
    expect(result.totalAfter).toBe(3)
    expect(result.deleted).toBe(0)
    expect(deleteBatch).not.toHaveBeenCalled()
  })

  it('counts only hot rows against the cap', async () => {
    memories = [
      ...Array.from({ length: 3 }, (_, i) => makeMemory({ id: `h${i}`, importance: 0.8, reinforcedImportance: 0.8 })),
      ...Array.from({ length: 20 }, (_, i) => makeMemory({ id: `c${i}`, tier: 'cold', supersededById: 'd' })),
    ]
    const result = await runHousekeeping('char-1', { maxMemories: 3 })
    expect(result.totalBefore).toBe(3)
    expect(result.coldCount).toBe(20)
    expect(result.demoted).toBe(0)
    expect(repo.updateTierBulk).not.toHaveBeenCalled()
  })

  it('never demotes MANUAL or CONSOLIDATED rows, even over the cap', async () => {
    memories = [
      makeMemory({ id: 'manual', source: 'MANUAL', importance: 0.1 }),
      makeMemory({ id: 'digest', source: 'CONSOLIDATED', importance: 0.1 }),
    ]
    const result = await runHousekeeping('char-1', { maxMemories: 1 })
    expect(result.demoted).toBe(0)
    expect(repo.updateTierBulk).not.toHaveBeenCalled()
  })

  it('a dry run reports demotions but writes nothing', async () => {
    memories = [makeMemory({ id: 'stale', importance: 0.1, reinforcedImportance: 0.1 })]
    const result = await runHousekeeping('char-1', { dryRun: true })
    expect(result.demoted).toBe(1)
    expect(repo.updateTierBulk).not.toHaveBeenCalled()
    expect(setTier).not.toHaveBeenCalled()
  })

  it('mergeSimilar is accepted and ignored', async () => {
    memories = [makeMemory({ importance: 0.8, reinforcedImportance: 0.8, createdAt: new Date().toISOString() })]
    const result = await runHousekeeping('char-1', { mergeSimilar: true })
    expect(result.merged).toBe(0)
    expect(result.demoted).toBe(0)
  })

  it('never looks for expired cold rows when retention is unset', async () => {
    memories = [makeMemory({ importance: 0.8, reinforcedImportance: 0.8 })]
    await runHousekeeping('char-1')
    expect(repo.findExpiredColdIds).not.toHaveBeenCalled()
    expect(deleteBatch).not.toHaveBeenCalled()
  })

  it('deletes only the expired superseded cold rows the repository returns when retention is set', async () => {
    retention = 90
    repo.findExpiredColdIds.mockResolvedValue(['old-cold'] as never)
    memories = [makeMemory({ importance: 0.8, reinforcedImportance: 0.8 })]
    const result = await runHousekeeping('char-1')
    expect(repo.findExpiredColdIds).toHaveBeenCalledTimes(1)
    const cutoff = Date.parse(repo.findExpiredColdIds.mock.calls[0][1] as string)
    expect(Math.abs(Date.now() - 90 * DAY - cutoff)).toBeLessThan(60_000)
    expect(deleteBatch).toHaveBeenCalledWith(['old-cold'])
    expect(result.deleted).toBe(1)
    expect(result.deletedIds).toEqual(['old-cold'])
  })
})
