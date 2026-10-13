/**
 * Bug 201 — bulk policy paths spare MANUAL rows, digests and cold rows.
 *
 * Covers the predicate, the chat wipe (`retireChatMemories` — `retireMemories`
 * under `keep: 'manual'`, behind `DELETE /memories?chatId=` and
 * `MEMORY_REGENERATE_CHAT`) and the near-duplicate folding tool
 * (`deduplicateCharacterMemories`), both running through the real
 * `retireMemories` against mocked repositories.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))

jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    remove: jest.fn(async (_c: string, ids: string[]) => ids.length),
    setTier: jest.fn(async (_c: string, ids: string[]) => ids.length),
  },
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

jest.mock('@/lib/memory/commonplace-mirror', () => ({
  mirrorCommonplaceForSubjects: jest.fn(async () => 0),
}))

jest.mock('@/lib/memory/admission', () => ({
  foldInto: jest.fn(() => ({ footnotes: [] })),
  applyFold: jest.fn(async (survivor: { characterId: string }) => ({ characterId: survivor.characterId, relatedMemoryIds: [] })),
}))

jest.mock('@/lib/memory/recall/archive', () => ({
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
import { retireChatMemories } from '@/lib/memory/retire'
import { deduplicateCharacterMemories } from '@/lib/tools/memory-dedup'
import { getRepositories } from '@/lib/repositories/factory'
import { rawQuery } from '@/lib/database/manager'
import type { Memory } from '@/lib/schemas/types'

const mockedRepos = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>

/**
 * Install the repository surface `retireMemories` uses, plus `extra`, over
 * `table` (every row that exists). The resolve query answers from `table`.
 * Returns the delete mock.
 */
function installRepos(table: Memory[], extra: Record<string, unknown>) {
  mockedRawQuery.mockImplementation((async (_sql: string, params: unknown[] = []) =>
    table
      .filter(m => (params as string[]).includes(m.id))
      .map(m => ({
        id: m.id,
        characterId: m.characterId,
        source: m.source,
        tier: m.tier,
        aboutCharacterId: m.aboutCharacterId ?? null,
        consolidatedFrom: JSON.stringify(m.consolidatedFrom ?? []),
        supersededById: m.supersededById ?? null,
      }))) as never)
  const bulkDeleteUnsafe = jest.fn(async (_c: string, ids: string[]) => ids.length)
  mockedRepos.mockReturnValue({
    memories: {
      removeRelatedMemoryIdsEverywhere: jest.fn(async () => 0),
      findDigestsContainingMembers: jest.fn(async () => []),
      findIdsSupersededByAny: jest.fn(async () => []),
      removeConsolidatedMembers: jest.fn(async () => 0),
      bulkDeleteUnsafe,
      ...extra,
    },
  } as never)
  return bulkDeleteUnsafe
}

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

describe('retireChatMemories (bug 201)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('wipes hot AUTO rows and spares manual, cold and a digest with a surviving member', async () => {
    const member = row('member', { tier: 'cold', supersededById: 'digest' })
    const memories = [
      row('auto'),
      row('manual', { source: 'MANUAL' }),
      member,
      row('digest', { source: 'CONSOLIDATED', consolidatedFrom: ['member'] }),
    ]
    const bulkDeleteUnsafe = installRepos(memories, {
      findByChatId: jest.fn(async () => memories),
      findByIds: jest.fn(async (ids: string[]) => ids.includes('member') ? [member] : []),
    })

    const result = await retireChatMemories('chat-1')

    expect(bulkDeleteUnsafe).toHaveBeenCalledTimes(1)
    expect(bulkDeleteUnsafe).toHaveBeenCalledWith('char-1', ['auto'])
    expect(result).toMatchObject({ retired: 1, spared: 3, sparedBy: { manual: 1, digest: 1, cold: 1 } })
  })

  it('wipes a digest whose only listed member is being wiped or now belongs elsewhere', async () => {
    // 'hot-member' is hot AUTO in this chat (re-promoted): it dies in this wipe.
    // 'moved' still exists but was re-consolidated into another digest.
    const moved = row('moved', { tier: 'cold', supersededById: 'other-digest', chatId: 'chat-2' })
    const inChat = [
      row('hot-member'),
      row('digest', { source: 'CONSOLIDATED', consolidatedFrom: ['hot-member', 'moved'] }),
    ]
    const bulkDeleteUnsafe = installRepos([...inChat, moved], {
      findByChatId: jest.fn(async () => inChat),
      findByIds: jest.fn(async (ids: string[]) => (ids.includes('moved') ? [moved] : [])),
    })

    const result = await retireChatMemories('chat-1')

    expect(bulkDeleteUnsafe).toHaveBeenCalledWith('char-1', ['hot-member', 'digest'])
    expect(result).toMatchObject({ retired: 2, spared: 0 })
  })

  it('looks up every spared digest\'s members in one query', async () => {
    const findByIds = jest.fn(async () => [])
    const inChat = [
      row('d1', { source: 'CONSOLIDATED', consolidatedFrom: ['a', 'b'] }),
      row('d2', { source: 'CONSOLIDATED', consolidatedFrom: ['b', 'c'] }),
    ]
    installRepos(inChat, { findByChatId: jest.fn(async () => inChat), findByIds })

    await retireChatMemories('chat-1')

    expect(findByIds).toHaveBeenCalledTimes(1)
    expect(findByIds).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('wipes a digest whose members are all gone', async () => {
    const inChat = [row('digest', { source: 'CONSOLIDATED', consolidatedFrom: ['gone'] })]
    const bulkDeleteUnsafe = installRepos(inChat, {
      findByChatId: jest.fn(async () => inChat),
      findByIds: jest.fn(async () => []),
    })

    const result = await retireChatMemories('chat-1')

    expect(bulkDeleteUnsafe).toHaveBeenCalledWith('char-1', ['digest'])
    expect(result).toMatchObject({ retired: 1, spared: 0 })
  })

  it('deletes nothing when every row is protected', async () => {
    const inChat = [row('manual', { source: 'MANUAL' })]
    const bulkDeleteUnsafe = installRepos(inChat, {
      findByChatId: jest.fn(async () => inChat),
      findByIds: jest.fn(async () => []),
    })

    const result = await retireChatMemories('chat-1')

    expect(bulkDeleteUnsafe).not.toHaveBeenCalled()
    expect(result).toMatchObject({ retired: 0, vectorsRemoved: 0, charactersAffected: 0, spared: 1 })
  })
})

describe('deduplicateCharacterMemories (bug 201)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('never folds a MANUAL row, a digest or a cold row, however similar', async () => {
    // Identical embeddings: every row is a duplicate of every other.
    const all = [
      row('auto-1', { importance: 0.9 }),
      row('auto-2'),
      row('manual', { source: 'MANUAL', importance: 1 }),
      row('digest', { source: 'CONSOLIDATED', importance: 1 }),
      row('cold', { tier: 'cold', supersededById: 'digest' }),
    ]
    const bulkDeleteUnsafe = installRepos(all, { findByCharacterId: jest.fn(async () => all) })

    const result = await deduplicateCharacterMemories('char-1', 'Friday', 0.8, false)

    expect(result.originalCount).toBe(5)
    expect(result.clustersFound).toBe(1)
    expect(result.memoriesInClusters).toBe(2)
    expect(bulkDeleteUnsafe).toHaveBeenCalledTimes(1)
    const [, deletedIds] = bulkDeleteUnsafe.mock.calls[0]
    expect(deletedIds).toHaveLength(1)
    expect(['auto-1', 'auto-2']).toContain(deletedIds[0])
    expect(result.finalCount).toBe(4)
  })

  it('finds nothing to fold when fewer than two rows are eligible', async () => {
    const all = [
      row('auto-1'),
      row('manual', { source: 'MANUAL' }),
      row('digest', { source: 'CONSOLIDATED' }),
    ]
    const bulkDeleteUnsafe = installRepos(all, { findByCharacterId: jest.fn(async () => all) })

    const result = await deduplicateCharacterMemories('char-1', 'Friday', 0.8, false)

    expect(result.clustersFound).toBe(0)
    expect(result.finalCount).toBe(3)
    expect(bulkDeleteUnsafe).not.toHaveBeenCalled()
  })
})
