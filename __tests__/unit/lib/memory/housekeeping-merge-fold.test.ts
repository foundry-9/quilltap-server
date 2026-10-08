/**
 * Housekeeping pass 2 folds a merged-away memory into its survivor
 * (memory-recall-and-housekeeping-fixes F9), and the sweep invalidates the
 * character's frozen archives (F5).
 *
 * - the survivor is patched BEFORE anything is deleted, and the delete is told
 *   to skip scrubbing it (its links already exclude the doomed ids);
 * - a fold that fails keeps its losers instead of deleting them;
 * - all of a survivor's losers fold in through one merge;
 * - the doomed set is excluded from the survivor's links.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'

const order: string[] = []
const deleteCalls: Array<{ ids: string[]; skip: string[] }> = []

jest.mock('@/lib/memory/memory-gate', () => {
  const actual = jest.requireActual('@/lib/memory/memory-gate') as typeof import('@/lib/memory/memory-gate')
  return {
    __esModule: true,
    occasionsAreDistinct: actual.occasionsAreDistinct,
    deleteMemoriesWithUnlinkBatch: jest.fn(async (ids: string[], options?: { skipScrubIds?: Set<string> }) => {
      order.push('delete')
      deleteCalls.push({ ids, skip: Array.from(options?.skipScrubIds ?? []) })
      return ids.length
    }),
  }
})

const planMemoryMerge = jest.fn((survivor: { id: string }, losers: Array<{ id: string }>, exclude: Iterable<string>) => ({
  survivorId: survivor.id,
  patch: { reinforcementCount: 1 + losers.length },
  mergedDetails: [],
  contentChanged: false,
  _losers: losers.map(l => l.id),
  _exclude: Array.from(exclude),
}))
const applyMemoryMerge = jest.fn(async (survivor: unknown) => {
  order.push('merge')
  return survivor
})
jest.mock('@/lib/memory/memory-merge', () => ({
  planMemoryMerge: (...args: unknown[]) => (planMemoryMerge as any)(...args),
  applyMemoryMerge: (...args: unknown[]) => (applyMemoryMerge as any)(...args),
}))

const invalidateFrozenArchive = jest.fn()
jest.mock('@/lib/memory/frozen-archive-cache', () => ({
  invalidateFrozenArchive: (...args: unknown[]) => invalidateFrozenArchive(...args),
}))

import type { Memory } from '@/lib/schemas/types'

let runHousekeeping: typeof import('@/lib/memory/housekeeping').runHousekeeping

function makeMemory(id: string, importance: number): Memory {
  const now = new Date().toISOString()
  return {
    id,
    characterId: 'char-1',
    content: `content ${id}`,
    summary: `summary ${id}`,
    keywords: [],
    tags: [],
    importance,
    embedding: null,
    source: 'MANUAL',
    sourceMessageId: null,
    lastAccessedAt: null,
    createdAt: now,
    updatedAt: now,
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
  } as unknown as Memory
}

describe('housekeeping — merge fold', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    order.length = 0
    deleteCalls.length = 0

    const memories = [makeMemory('a', 0.9), makeMemory('b', 0.8), makeMemory('c', 0.7)]
    const vector = (id: string) => ({ id, embedding: new Float32Array([1, 0]) })

    const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock<any> }
    repositoriesMock.getRepositories.mockReturnValue({
      memories: {
        findByCharacterIdInBatches: async function* () {
          yield memories
        },
      },
    })

    // a ~ b and a ~ c: both fold into a, in one merge.
    const neighbours: Record<string, Array<{ id: string; score: number }>> = {
      a: [{ id: 'a', score: 1 }, { id: 'b', score: 0.95 }, { id: 'c', score: 0.93 }],
      b: [{ id: 'b', score: 1 }],
      c: [{ id: 'c', score: 1 }],
    }
    const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock<any> }
    // Tag each entry's embedding so the fake search knows who is asking.
    vectorStoreMock.getCharacterVectorStore.mockImplementation(async () => {
      const entries = ['a', 'b', 'c'].map(id => {
        const e = vector(id)
        ;(e.embedding as any)._id = id
        return e
      })
      return {
        getAllEntries: () => entries,
        getDimensions: () => 2,
        search: (embedding: any) => neighbours[embedding._id] ?? [],
        removeVector: jest.fn(),
        save: jest.fn(),
      }
    })

    jest.isolateModules(() => {
      runHousekeeping = (require('@/lib/memory/housekeeping') as typeof import('@/lib/memory/housekeeping')).runHousekeeping
    })
  })

  it('folds every loser into its survivor first, then deletes without re-scrubbing it', async () => {
    const result = await runHousekeeping('char-1', {
      userId: 'user-1',
      mergeSimilar: true,
      mergeThreshold: 0.9,
      maxMemories: 1000,
    })

    expect(result.merged).toBe(2)
    expect(order).toEqual(['merge', 'delete'])
    expect(deleteCalls[0].ids.sort()).toEqual(['b', 'c'])
    expect(deleteCalls[0].skip).toEqual(['a'])
    expect(planMemoryMerge).toHaveBeenCalledTimes(1)
    const [survivor, losers, exclude] = planMemoryMerge.mock.calls[0] as [Memory, Memory[], Iterable<string>]
    expect(survivor.id).toBe('a')
    expect(losers.map(l => l.id).sort()).toEqual(['b', 'c'])
    expect(new Set(exclude)).toEqual(new Set(['b', 'c']))
    expect(applyMemoryMerge).toHaveBeenCalledWith(survivor, expect.anything(), { userId: 'user-1', embeddingProfileId: undefined })
    expect(invalidateFrozenArchive).toHaveBeenCalledWith('char-1')
  })

  it('keeps the losers when the fold into their survivor fails', async () => {
    applyMemoryMerge.mockImplementationOnce(async () => {
      order.push('merge')
      return null
    })

    const result = await runHousekeeping('char-1', {
      userId: 'user-1',
      mergeSimilar: true,
      mergeThreshold: 0.9,
      maxMemories: 1000,
    })

    expect(result.merged).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.deletedIds).toEqual([])
    expect(deleteCalls).toHaveLength(0)
    expect(result.details.filter(d => d.action === 'merged')).toHaveLength(0)
  })

  it('a dry run merges nothing and leaves the archive cache alone', async () => {
    const result = await runHousekeeping('char-1', {
      userId: 'user-1',
      mergeSimilar: true,
      mergeThreshold: 0.9,
      maxMemories: 1000,
      dryRun: true,
    })

    expect(result.merged).toBe(2)
    expect(applyMemoryMerge).not.toHaveBeenCalled()
    expect(invalidateFrozenArchive).not.toHaveBeenCalled()
  })
})
