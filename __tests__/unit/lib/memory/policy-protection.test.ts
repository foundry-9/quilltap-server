/**
 * Bug 201 — bulk policy paths spare MANUAL rows, digests and cold rows.
 *
 * Covers the predicate, the chat wipe (`deleteMemoriesByChatIdWithVectors`,
 * behind `DELETE /memories?chatId=` and `MEMORY_REGENERATE_CHAT`) and the
 * near-duplicate folding tool (`deduplicateCharacterMemories`).
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
  getVectorStoreManager: jest.fn(),
  isHotVector: jest.fn(() => true),
}))

jest.mock('@/lib/memory/memory-gate', () => ({
  deleteMemoriesWithUnlinkBatch: jest.fn(async (ids: string[]) => ids.length),
  deleteMemoryWithUnlink: jest.fn(),
}))

jest.mock('@/lib/memory/memory-merge', () => ({
  planMemoryMerge: jest.fn(() => ({ mergedDetails: [] })),
  applyMemoryMerge: jest.fn(async (survivor: { characterId: string }) => ({ characterId: survivor.characterId, relatedMemoryIds: [] })),
}))

jest.mock('@/lib/memory/frozen-archive-cache', () => ({
  invalidateFrozenArchive: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}))

import { policyProtectionOf, partitionByPolicyProtection } from '@/lib/memory/policy-protection'
import { deleteMemoriesByChatIdWithVectors } from '@/lib/memory/memory-service'
import { deduplicateCharacterMemories } from '@/lib/tools/memory-dedup'
import { getRepositories } from '@/lib/repositories/factory'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { deleteMemoriesWithUnlinkBatch } from '@/lib/memory/memory-gate'
import type { Memory } from '@/lib/schemas/types'

const mockedRepos = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedStore = getCharacterVectorStore as jest.MockedFunction<typeof getCharacterVectorStore>
const mockedDeleteBatch = deleteMemoriesWithUnlinkBatch as jest.MockedFunction<typeof deleteMemoriesWithUnlinkBatch>

function row(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    characterId: 'char-1',
    chatId: 'chat-1',
    content: `Memory ${id}`,
    summary: `Summary ${id}`,
    keywords: [],
    tags: [],
    importance: 0.5,
    reinforcedImportance: 0.5,
    reinforcementCount: 1,
    source: 'AUTO',
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    relatedMemoryIds: [],
    embedding: new Float32Array([1, 0, 0]),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

describe('policyProtectionOf', () => {
  it('names why a row is spared, or null when a policy may act', () => {
    expect(policyProtectionOf({ source: 'MANUAL', tier: 'hot' })).toBe('manual')
    expect(policyProtectionOf({ source: 'CONSOLIDATED', tier: 'hot' })).toBe('digest')
    expect(policyProtectionOf({ source: 'AUTO', tier: 'cold' })).toBe('cold')
    expect(policyProtectionOf({ source: 'AUTO', tier: 'hot' })).toBeNull()
  })

  it('partitions and counts', () => {
    const { actionable, spared, sparedBy } = partitionByPolicyProtection([
      row('a'),
      row('m', { source: 'MANUAL' }),
      row('d', { source: 'CONSOLIDATED' }),
      row('c', { tier: 'cold' }),
    ])
    expect(actionable.map(m => m.id)).toEqual(['a'])
    expect(spared.map(m => m.id)).toEqual(['m', 'd', 'c'])
    expect(sparedBy).toEqual({ manual: 1, digest: 1, cold: 1 })
  })
})

describe('deleteMemoriesByChatIdWithVectors (bug 201)', () => {
  let removeVector: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    removeVector = jest.fn()
    mockedStore.mockResolvedValue({
      hasVector: jest.fn(() => true),
      removeVector,
      save: jest.fn(),
    } as never)
  })

  it('wipes hot AUTO rows and spares manual, cold and a digest with a surviving member', async () => {
    const member = row('member', { tier: 'cold', supersededById: 'digest' })
    const memories = [
      row('auto'),
      row('manual', { source: 'MANUAL' }),
      member,
      row('digest', { source: 'CONSOLIDATED', consolidatedFrom: ['member'] }),
    ]
    mockedRepos.mockReturnValue({
      memories: {
        findByChatId: jest.fn(async () => memories),
        findByIds: jest.fn(async (ids: string[]) => ids.includes('member') ? [member] : []),
      },
    } as never)

    const result = await deleteMemoriesByChatIdWithVectors('chat-1')

    expect(mockedDeleteBatch).toHaveBeenCalledWith(['auto'])
    expect(removeVector).toHaveBeenCalledTimes(1)
    expect(removeVector).toHaveBeenCalledWith('auto')
    expect(result).toMatchObject({ deleted: 1, spared: 3 })
  })

  it('wipes a digest whose members are all gone', async () => {
    mockedRepos.mockReturnValue({
      memories: {
        findByChatId: jest.fn(async () => [row('digest', { source: 'CONSOLIDATED', consolidatedFrom: ['gone'] })]),
        findByIds: jest.fn(async () => []),
      },
    } as never)

    const result = await deleteMemoriesByChatIdWithVectors('chat-1')

    expect(mockedDeleteBatch).toHaveBeenCalledWith(['digest'])
    expect(result).toMatchObject({ deleted: 1, spared: 0 })
  })

  it('deletes nothing when every row is protected', async () => {
    mockedRepos.mockReturnValue({
      memories: {
        findByChatId: jest.fn(async () => [row('manual', { source: 'MANUAL' })]),
        findByIds: jest.fn(async () => []),
      },
    } as never)

    const result = await deleteMemoriesByChatIdWithVectors('chat-1')

    expect(mockedDeleteBatch).not.toHaveBeenCalled()
    expect(result).toEqual({ deleted: 0, vectorsRemoved: 0, characterCount: 0, spared: 1 })
  })
})

describe('deduplicateCharacterMemories (bug 201)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedStore.mockResolvedValue({ removeVector: jest.fn(), save: jest.fn() } as never)
  })

  it('never folds a MANUAL row, a digest or a cold row, however similar', async () => {
    // Identical embeddings: every row is a duplicate of every other.
    mockedRepos.mockReturnValue({
      memories: {
        findByCharacterId: jest.fn(async () => [
          row('auto-1', { importance: 0.9 }),
          row('auto-2'),
          row('manual', { source: 'MANUAL', importance: 1 }),
          row('digest', { source: 'CONSOLIDATED', importance: 1 }),
          row('cold', { tier: 'cold', supersededById: 'digest' }),
        ]),
      },
    } as never)

    const result = await deduplicateCharacterMemories('char-1', 'Friday', 0.8, false)

    expect(result.originalCount).toBe(5)
    expect(result.clustersFound).toBe(1)
    expect(result.memoriesInClusters).toBe(2)
    expect(mockedDeleteBatch).toHaveBeenCalledTimes(1)
    const [deletedIds] = mockedDeleteBatch.mock.calls[0]
    expect(deletedIds).toHaveLength(1)
    expect(['auto-1', 'auto-2']).toContain(deletedIds[0])
    expect(result.finalCount).toBe(4)
  })

  it('finds nothing to fold when fewer than two rows are eligible', async () => {
    mockedRepos.mockReturnValue({
      memories: {
        findByCharacterId: jest.fn(async () => [
          row('auto-1'),
          row('manual', { source: 'MANUAL' }),
          row('digest', { source: 'CONSOLIDATED' }),
        ]),
      },
    } as never)

    const result = await deduplicateCharacterMemories('char-1', 'Friday', 0.8, false)

    expect(result.clustersFound).toBe(0)
    expect(result.finalCount).toBe(3)
    expect(mockedDeleteBatch).not.toHaveBeenCalled()
  })
})
