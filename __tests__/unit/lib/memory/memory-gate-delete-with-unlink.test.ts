/**
 * Unit tests for the memory-deletion chokepoint helpers:
 *   - deleteMemoryWithUnlink (single)
 *   - deleteMemoriesWithUnlinkBatch / deleteMemoriesWithUnlinkBatchReport
 *
 * These verify that the deleted ID is scrubbed from every neighbour's
 * `relatedMemoryIds` *before* the rows are removed — as one removal delta per
 * holder (`removeRelatedMemoryIdsForCharacter`, bug 234), never as a
 * whole-list write built from a read.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

// The digest-link scrub (bug 225) reads through repository methods now, which
// `buildRepo` answers with nothing; the routing below stays as a guard so any
// raw digest query still gets an empty answer and the scripted
// `scriptedRawQuery` sees exactly the doomed-id resolves these tests pin.
jest.mock('@/lib/database/manager', () => {
  const scriptedRawQuery = jest.fn()
  const isDigestScrub = (sql: string) =>
    sql.includes('consolidatedFrom') || sql.includes('supersededById IN')
  return {
    __esModule: true,
    scriptedRawQuery,
    rawQuery: jest.fn((sql: string, params: unknown[]) =>
      isDigestScrub(sql) ? Promise.resolve([]) : scriptedRawQuery(sql, params)),
    registerBlobColumns: jest.fn(),
    getDatabase: jest.fn(),
    getDatabaseAsync: jest.fn(),
    initializeDatabase: jest.fn(),
  }
})

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // The real logger exposes `child`; modules that build a scoped logger at
    // import time (the realtime bus, reached through the activity registry)
    // need it present on the mock too.
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const dbMock = { rawQuery: (jest.requireMock('@/lib/database/manager') as { scriptedRawQuery: jest.Mock }).scriptedRawQuery }

let deleteMemoryWithUnlink: typeof import('@/lib/memory/memory-gate').deleteMemoryWithUnlink
let deleteMemoriesWithUnlinkBatch: typeof import('@/lib/memory/memory-gate').deleteMemoriesWithUnlinkBatch
let deleteMemoriesWithUnlinkBatchReport: typeof import('@/lib/memory/memory-gate').deleteMemoriesWithUnlinkBatchReport

interface FakeMemoryRow {
  id: string
  characterId: string
  relatedMemoryIds: string | null
}

function buildRepo(rows: FakeMemoryRow[]) {
  const updates: Array<{ characterId: string; memoryId: string; relatedMemoryIds: string[] }> = []
  const scrubs: Array<{ characterId: string; ids: string[] }> = []
  const deleted: string[] = []
  const bulkDeleted: Array<{ characterId: string; ids: string[] }> = []

  return {
    updates,
    scrubs,
    deleted,
    bulkDeleted,
    repo: {
      memories: {
        findById: jest.fn(async (id: string) => rows.find(r => r.id === id) ?? null),
        delete: jest.fn(async (id: string) => {
          deleted.push(id)
          return true
        }),
        bulkDelete: jest.fn(async (characterId: string, ids: string[]) => {
          bulkDeleted.push({ characterId, ids })
          return ids.length
        }),
        // The digest scrub (bug 225; covered in memory-delete-digest-chokepoint.test.ts)
        // finds nothing to scrub here.
        findDigestsContainingMembers: jest.fn(async () => []),
        findIdsSupersededByAny: jest.fn(async () => []),
        removeConsolidatedMembers: jest.fn(async () => 0),
        updateTierBulk: jest.fn(async () => 0),
        // The repository's removal delta, simulated over the fake rows: every
        // row of the character naming a removed id loses it.
        removeRelatedMemoryIdsForCharacter: jest.fn(async (characterId: string, ids: string[]) => {
          scrubs.push({ characterId, ids: [...ids] })
          const removing = new Set(ids)
          let changed = 0
          for (const row of rows) {
            if (row.characterId !== characterId) continue
            const links: string[] = row.relatedMemoryIds ? JSON.parse(row.relatedMemoryIds) : []
            const next = links.filter(id => !removing.has(id))
            if (next.length === links.length) continue
            updates.push({ characterId, memoryId: row.id, relatedMemoryIds: next })
            changed++
          }
          return changed
        }),
        updateForCharacter: jest.fn(async (characterId: string, memoryId: string, patch: { relatedMemoryIds?: string[] }) => {
          updates.push({ characterId, memoryId, relatedMemoryIds: patch.relatedMemoryIds ?? [] })
          return null
        }),
      },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.isolateModules(() => {
    const gate = require('@/lib/memory/memory-gate')
    deleteMemoryWithUnlink = gate.deleteMemoryWithUnlink
    deleteMemoriesWithUnlinkBatch = gate.deleteMemoriesWithUnlinkBatch
    deleteMemoriesWithUnlinkBatchReport = gate.deleteMemoriesWithUnlinkBatchReport
  })
})

describe('deleteMemoryWithUnlink', () => {
  it('scrubs the deleted ID from every neighbour before deleting', async () => {
    // Graph A↔B↔C — we delete B.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
    ]

    const { repo, updates, scrubs, deleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)

    const result = await deleteMemoryWithUnlink('B')
    expect(result).toBe(true)
    expect(scrubs).toEqual([{ characterId: 'char-1', ids: ['B'] }])
    expect(repo.memories.updateForCharacter).not.toHaveBeenCalled()
    expect(dbMock.rawQuery).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'A', relatedMemoryIds: [] },
      { characterId: 'char-1', memoryId: 'C', relatedMemoryIds: [] },
    ])
    expect(deleted).toEqual(['B'])
  })

  it('returns false and touches no neighbours when the memory is gone', async () => {
    const { repo, updates, deleted } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    const result = await deleteMemoryWithUnlink('missing')
    expect(result).toBe(false)
    expect(updates).toEqual([])
    expect(deleted).toEqual([])
    expect(repo.memories.removeRelatedMemoryIdsForCharacter).not.toHaveBeenCalled()
  })

  it('scopes the scrub to the deleted row\'s holder', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['Y']) },
      { id: 'T', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['U']) },
      { id: 'U', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['T']) },
    ]
    const { repo, updates, scrubs } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)

    await deleteMemoryWithUnlink('T')

    expect(scrubs).toEqual([{ characterId: 'char-2', ids: ['T'] }])
    expect(updates).toEqual([
      { characterId: 'char-2', memoryId: 'U', relatedMemoryIds: [] },
    ])
  })
})

describe('deleteMemoriesWithUnlinkBatch', () => {
  it('scrubs neighbours with one delta per holder for the whole batch', async () => {
    // Graph A↔B↔C↔D. Delete {B, C} together. A and D should be scrubbed; B
    // and C shouldn't churn against each other.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B', 'D']) },
      { id: 'D', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['C']) },
    ]

    const { repo, updates, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)

    // The only rawQuery: resolve doomed → characterId.
    dbMock.rawQuery.mockResolvedValueOnce([
      { id: 'B', characterId: 'char-1' },
      { id: 'C', characterId: 'char-1' },
    ])

    const deleted = await deleteMemoriesWithUnlinkBatch(['B', 'C'])

    expect(deleted).toBe(2)
    expect(repo.memories.removeRelatedMemoryIdsForCharacter).toHaveBeenCalledTimes(1)
    expect(repo.memories.removeRelatedMemoryIdsForCharacter).toHaveBeenCalledWith('char-1', ['B', 'C'])
    expect(repo.memories.updateForCharacter).not.toHaveBeenCalled()
    // A and D lose their links; the doomed rows go with the delete.
    expect(updates.filter(u => u.memoryId === 'A' || u.memoryId === 'D').map(u => u.memoryId).sort()).toEqual(['A', 'D'])
    const aUpdate = updates.find(u => u.memoryId === 'A')
    const dUpdate = updates.find(u => u.memoryId === 'D')
    expect(aUpdate?.relatedMemoryIds).toEqual([])
    expect(dUpdate?.relatedMemoryIds).toEqual([])
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids: ['B', 'C'] }])
  })

  it('returns 0 immediately for an empty batch', async () => {
    const { repo } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    const deleted = await deleteMemoriesWithUnlinkBatch([])
    expect(deleted).toBe(0)
    expect(dbMock.rawQuery).not.toHaveBeenCalled()
  })

  it('chunks the doomed-ID resolve query under the SQLite variable limit', async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `mem-${i}`)
    const { repo, bulkDeleted } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    // Each resolve chunk echoes its IDs back under a single character.
    dbMock.rawQuery.mockImplementation(async (_sql: string, params: string[]) =>
      params.map(id => ({ id, characterId: 'char-1' }))
    )

    const deleted = await deleteMemoriesWithUnlinkBatch(ids)

    expect(deleted).toBe(2000)
    // 3 resolve chunks (900 + 900 + 200); no whole-table neighbour scan.
    expect(dbMock.rawQuery).toHaveBeenCalledTimes(3)
    const resolveCalls = dbMock.rawQuery.mock.calls
    expect(resolveCalls.map(([, params]) => (params as string[]).length)).toEqual([900, 900, 200])
    for (const [sql, params] of resolveCalls) {
      expect((sql as string).match(/\?/g)?.length).toBe((params as string[]).length)
    }
    // Every doomed ID still reaches bulkDelete after the chunks accumulate.
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids }])
  })

  it('groups doomed IDs by character for bulkDelete', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-A', relatedMemoryIds: JSON.stringify(['Y']) },
      { id: 'Y', characterId: 'char-B', relatedMemoryIds: JSON.stringify(['X']) },
    ]
    const { repo, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    dbMock.rawQuery.mockResolvedValueOnce([
      { id: 'X', characterId: 'char-A' },
      { id: 'Y', characterId: 'char-B' },
    ])

    await deleteMemoriesWithUnlinkBatch(['X', 'Y'])

    expect(bulkDeleted).toHaveLength(2)
    expect(bulkDeleted.sort((a, b) => a.characterId.localeCompare(b.characterId))).toEqual([
      { characterId: 'char-A', ids: ['X'] },
      { characterId: 'char-B', ids: ['Y'] },
    ])
  })
})

// Bug 200: vector removal lives in the chokepoint, so no caller that deletes
// through it can leave an orphan vector behind.
describe('vector removal in the chokepoint (bug 200)', () => {
  const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock }

  function fakeStore() {
    const removed: string[] = []
    return {
      removed,
      store: {
        removeVector: jest.fn(async (id: string) => {
          removed.push(id)
          return true
        }),
        save: jest.fn(async () => undefined),
      },
    }
  }

  it('removes the vector of a single deleted memory', async () => {
    const rows: FakeMemoryRow[] = [{ id: 'B', characterId: 'char-1', relatedMemoryIds: null }]
    const { repo } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    const { store, removed } = fakeStore()
    vectorStoreMock.getCharacterVectorStore.mockResolvedValue(store)

    await deleteMemoryWithUnlink('B')

    expect(vectorStoreMock.getCharacterVectorStore).toHaveBeenCalledWith('char-1')
    expect(removed).toEqual(['B'])
    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('removes every deleted row\'s vector from its own character\'s index', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-A', relatedMemoryIds: null },
      { id: 'Y', characterId: 'char-B', relatedMemoryIds: null },
    ]
    const { repo } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    dbMock.rawQuery.mockResolvedValueOnce([
      { id: 'X', characterId: 'char-A' },
      { id: 'Y', characterId: 'char-B' },
    ])
    const stores = { 'char-A': fakeStore(), 'char-B': fakeStore() } as Record<string, ReturnType<typeof fakeStore>>
    vectorStoreMock.getCharacterVectorStore.mockImplementation(async (cid: string) => stores[cid].store)

    const report = await deleteMemoriesWithUnlinkBatchReport(['X', 'Y'])

    expect(stores['char-A'].removed).toEqual(['X'])
    expect(stores['char-B'].removed).toEqual(['Y'])
    expect(report).toEqual({ deleted: 2, vectorsRemoved: 2 })
  })

  it('still reports the rows deleted when the vector store fails', async () => {
    const rows: FakeMemoryRow[] = [{ id: 'X', characterId: 'char-A', relatedMemoryIds: null }]
    const { repo, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    dbMock.rawQuery.mockResolvedValueOnce([{ id: 'X', characterId: 'char-A' }])
    vectorStoreMock.getCharacterVectorStore.mockRejectedValue(new Error('index unavailable'))

    const deleted = await deleteMemoriesWithUnlinkBatch(['X'])

    expect(deleted).toBe(1)
    expect(bulkDeleted).toEqual([{ characterId: 'char-A', ids: ['X'] }])
  })
})
