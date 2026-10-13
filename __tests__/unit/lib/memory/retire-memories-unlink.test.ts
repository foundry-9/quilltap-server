/**
 * `retireMemories` — the neighbour scrub and the vector eviction.
 *
 * These pin that a retired id is scrubbed from every neighbour's
 * `relatedMemoryIds` *before* the rows are removed — as one removal delta
 * across every holder (`removeRelatedMemoryIdsEverywhere`, bug 234), never as a
 * whole-list write built from a read — and that the retired rows' vectors leave
 * the index with them (bug 200), even when the index cache itself fails.
 *
 * (Formerly the tests of `deleteMemoryWithUnlink` /
 * `deleteMemoriesWithUnlinkBatch`, which `retireMemories` replaced.)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

// The only raw query retirement issues here is the doomed-row resolve (the
// digest cascade and scrub read through repository methods, which `buildRepo`
// answers with nothing).
jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))

// The cache behind the real `memoryIndex`: one fake store per character.
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn(),
  isHotVector: jest.fn(() => true),
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(() => { process.stderr.write('PUBLISH CALLED\n') }),
}))

jest.mock('@/lib/memory/frozen-archive-cache', () => ({
  invalidateFrozenArchive: jest.fn(),
}))

jest.mock('@/lib/memory/commonplace-mirror', () => ({
  mirrorCommonplaceForSubjects: jest.fn(async () => 0),
}))

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => ({
    debug: jest.fn((m: string) => process.stderr.write('LOG ' + m + '\n')), info: jest.fn(), warn: jest.fn((m: string) => process.stderr.write('WARN ' + m + '\n')), error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import { retireMemories } from '@/lib/memory/retire'
const { publishRealtime } = jest.requireMock('@/lib/realtime/bus') as { publishRealtime: jest.Mock }
const { invalidateFrozenArchive } = jest.requireMock('@/lib/memory/frozen-archive-cache') as {
  invalidateFrozenArchive: jest.Mock
}

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const dbMock = jest.requireMock('@/lib/database/manager') as { rawQuery: jest.Mock }
const vectorStoreMock = jest.requireMock('@/lib/embedding/vector-store') as { getVectorStoreManager: jest.Mock }

interface FakeMemoryRow {
  id: string
  characterId: string
  relatedMemoryIds: string | null
}

/** The resolve query's row shape for a plain AUTO hot memory. */
function resolved(id: string, characterId: string) {
  return {
    id, characterId, source: 'AUTO', tier: 'hot', aboutCharacterId: null,
    consolidatedFrom: '[]', supersededById: null,
  }
}

/** Answer the resolve query from `rows` (chunk by chunk). */
function resolveFrom(rows: FakeMemoryRow[]) {
  dbMock.rawQuery.mockImplementation(async (_sql: unknown, params: unknown) =>
    rows.filter(r => (params as string[]).includes(r.id)).map(r => resolved(r.id, r.characterId)))
}

function buildRepo(rows: FakeMemoryRow[]) {
  const updates: Array<{ characterId: string; memoryId: string; relatedMemoryIds: string[] }> = []
  const scrubs: Array<{ ids: string[] }> = []
  const bulkDeleted: Array<{ characterId: string; ids: string[] }> = []
  const order: string[] = []

  return {
    updates,
    scrubs,
    bulkDeleted,
    order,
    repo: {
      memories: {
        bulkDeleteUnsafe: jest.fn(async (characterId: string, ids: string[]) => {
          order.push('delete')
          bulkDeleted.push({ characterId, ids: [...ids] })
          return ids.length
        }),
        // The digest scrub (bug 225; covered in memory-delete-digest-chokepoint.test.ts)
        // finds nothing to scrub here.
        findDigestsContainingMembers: jest.fn(async () => []),
        findIdsSupersededByAny: jest.fn(async () => []),
        removeConsolidatedMembers: jest.fn(async () => 0),
        updateTierBulk: jest.fn(async () => 0),
        findByIds: jest.fn(async () => []),
        // The repository's removal delta, simulated over the fake rows: every
        // row, whichever holder, naming a removed id loses it.
        removeRelatedMemoryIdsEverywhere: jest.fn(async (ids: string[]) => {
          order.push('scrub')
          scrubs.push({ ids: [...ids] })
          const removing = new Set(ids)
          let changed = 0
          for (const row of rows) {
            if (removing.has(row.id)) continue
            const links: string[] = row.relatedMemoryIds ? JSON.parse(row.relatedMemoryIds) : []
            const next = links.filter(id => !removing.has(id))
            if (next.length === links.length) continue
            updates.push({ characterId: row.characterId, memoryId: row.id, relatedMemoryIds: next })
            changed++
          }
          return changed
        }),
        updateForCharacter: jest.fn(async () => null),
      },
    },
  }
}

/** A loaded cache store per character, recording what it evicts. */
function installStores(characterIds: string[]) {
  const stores: Record<string, { removed: string[]; store: { removeVector: jest.Mock } }> = {}
  for (const cid of characterIds) {
    const removed: string[] = []
    stores[cid] = {
      removed,
      store: {
        removeVector: jest.fn(async (id: string) => {
          removed.push(id)
          return true
        }),
      },
    }
  }
  const manager = {
    getLoadedStore: jest.fn(async (cid: string) => stores[cid]?.store ?? null),
    unloadStore: jest.fn(() => true),
    getStore: jest.fn(),
    unloadAll: jest.fn(),
  }
  vectorStoreMock.getVectorStoreManager.mockReturnValue(manager)
  return { stores, manager }
}

beforeEach(() => {
  jest.clearAllMocks()
  dbMock.rawQuery.mockReset()
  installStores([])
})

describe('retireMemories — one id', () => {
  it('scrubs the retired ID from every neighbour before deleting', async () => {
    // Graph A↔B↔C — we retire B.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
    ]
    const { repo, updates, scrubs, bulkDeleted, order } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)

    const report = await retireMemories(['B'], { reason: 'item-delete' })

    expect(report.retired).toBe(1)
    expect(report.retiredIds).toEqual(['B'])
    expect(scrubs).toEqual([{ ids: ['B'] }])
    expect(order).toEqual(['scrub', 'delete'])
    expect(repo.memories.updateForCharacter).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'A', relatedMemoryIds: [] },
      { characterId: 'char-1', memoryId: 'C', relatedMemoryIds: [] },
    ])
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids: ['B'] }])
    process.stderr.write('ENV ' + JSON.stringify([process.env.QUILLTAP_JOB_CHILD, report, require('@/lib/realtime/bus').publishRealtime === publishRealtime, String(require('@/lib/realtime/bus').publishRealtime)]) + '\n')
    expect(invalidateFrozenArchive).toHaveBeenCalledWith('char-1')
    expect(publishRealtime).toHaveBeenCalledWith('memories')
  })

  it('retires nothing for a row already gone, but still scrubs its id from neighbours (idempotent)', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'n', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['missing']) },
    ]
    const { repo, updates, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom([])

    const report = await retireMemories(['missing'], { reason: 'item-delete' })

    expect(report.retired).toBe(0)
    expect(bulkDeleted).toEqual([])
    expect(repo.memories.removeRelatedMemoryIdsEverywhere).toHaveBeenCalledWith(['missing'])
    expect(updates).toEqual([{ characterId: 'char-1', memoryId: 'n', relatedMemoryIds: [] }])
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('scrubs the retired id from every holder, including a link that crosses characters', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['Y', 'T']) },
      { id: 'T', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['U']) },
      { id: 'U', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['T']) },
    ]
    const { repo, updates, scrubs } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)

    await retireMemories(['T'], { reason: 'item-delete' })

    expect(scrubs).toEqual([{ ids: ['T'] }])
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'X', relatedMemoryIds: ['Y'] },
      { characterId: 'char-2', memoryId: 'U', relatedMemoryIds: [] },
    ])
  })
})

describe('retireMemories — a batch', () => {
  it('scrubs neighbours with one delta for the whole batch', async () => {
    // Graph A↔B↔C↔D. Retire {B, C} together. A and D are scrubbed; B and C
    // don't churn against each other.
    const rows: FakeMemoryRow[] = [
      { id: 'A', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B']) },
      { id: 'B', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['A', 'C']) },
      { id: 'C', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['B', 'D']) },
      { id: 'D', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['C']) },
    ]
    const { repo, updates, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)

    const report = await retireMemories(['B', 'C'], { reason: 'item-delete' })

    expect(report.retired).toBe(2)
    expect(repo.memories.removeRelatedMemoryIdsEverywhere).toHaveBeenCalledTimes(1)
    expect(repo.memories.removeRelatedMemoryIdsEverywhere).toHaveBeenCalledWith(['B', 'C'])
    expect(repo.memories.updateForCharacter).not.toHaveBeenCalled()
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'A', relatedMemoryIds: [] },
      { characterId: 'char-1', memoryId: 'D', relatedMemoryIds: [] },
    ])
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids: ['B', 'C'] }])
  })

  it('scrubs an id whose row is already gone, and links that cross characters', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'a', characterId: 'char-1', relatedMemoryIds: JSON.stringify([]) },
      { id: 'n1', characterId: 'char-1', relatedMemoryIds: JSON.stringify(['a', 'already-gone']) },
      { id: 'n2', characterId: 'char-2', relatedMemoryIds: JSON.stringify(['a', 'keep']) },
    ]
    const { repo, updates, scrubs } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)

    const report = await retireMemories(['a', 'already-gone'], { reason: 'item-delete' })

    expect(report.retired).toBe(1)
    expect(scrubs).toEqual([{ ids: ['a', 'already-gone'] }])
    expect(updates).toEqual([
      { characterId: 'char-1', memoryId: 'n1', relatedMemoryIds: [] },
      { characterId: 'char-2', memoryId: 'n2', relatedMemoryIds: ['keep'] },
    ])
  })

  it('returns an empty report immediately for an empty batch', async () => {
    const { repo } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    const report = await retireMemories([], { reason: 'item-delete' })

    expect(report.requested).toBe(0)
    expect(report.retired).toBe(0)
    expect(dbMock.rawQuery).not.toHaveBeenCalled()
    expect(repo.memories.removeRelatedMemoryIdsEverywhere).not.toHaveBeenCalled()
  })

  it('chunks the doomed-ID resolve query under the SQLite variable limit', async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `mem-${i}`)
    const { repo, bulkDeleted } = buildRepo([])
    factoryMock.getRepositories.mockReturnValue(repo)

    // Each resolve chunk echoes its IDs back under a single character.
    dbMock.rawQuery.mockImplementation(async (_sql: unknown, params: unknown) =>
      (params as string[]).map(id => resolved(id, 'char-1')))

    const report = await retireMemories(ids, { reason: 'item-delete' })

    expect(report.retired).toBe(2000)
    // 3 resolve chunks (900 + 900 + 200); no whole-table neighbour scan.
    expect(dbMock.rawQuery).toHaveBeenCalledTimes(3)
    const resolveCalls = dbMock.rawQuery.mock.calls
    expect(resolveCalls.map(([, params]) => (params as string[]).length)).toEqual([900, 900, 200])
    for (const [sql, params] of resolveCalls) {
      expect((sql as string).match(/\?/g)?.length).toBe((params as string[]).length)
    }
    // Every doomed ID still reaches the delete after the chunks accumulate.
    expect(bulkDeleted).toEqual([{ characterId: 'char-1', ids }])
  })

  it('groups doomed IDs by character for the delete', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-A', relatedMemoryIds: JSON.stringify(['Y']) },
      { id: 'Y', characterId: 'char-B', relatedMemoryIds: JSON.stringify(['X']) },
    ]
    const { repo, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)

    const report = await retireMemories(['X', 'Y'], { reason: 'item-delete' })

    expect(report.charactersAffected).toBe(2)
    expect(bulkDeleted.sort((a, b) => a.characterId.localeCompare(b.characterId))).toEqual([
      { characterId: 'char-A', ids: ['X'] },
      { characterId: 'char-B', ids: ['Y'] },
    ])
  })
})

// Bug 200: vector removal lives in the chokepoint, so no caller that retires
// through it can leave an orphan vector behind.
describe('vector eviction in the chokepoint (bug 200)', () => {
  it('evicts the vector of a single retired memory', async () => {
    const rows: FakeMemoryRow[] = [{ id: 'B', characterId: 'char-1', relatedMemoryIds: null }]
    const { repo } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)
    const { stores, manager } = installStores(['char-1'])

    const report = await retireMemories(['B'], { reason: 'item-delete' })

    expect(manager.getLoadedStore).toHaveBeenCalledWith('char-1')
    expect(stores['char-1'].removed).toEqual(['B'])
    expect(report.vectorsRemoved).toBe(1)
  })

  it('evicts every retired row\'s vector from its own character\'s index', async () => {
    const rows: FakeMemoryRow[] = [
      { id: 'X', characterId: 'char-A', relatedMemoryIds: null },
      { id: 'Y', characterId: 'char-B', relatedMemoryIds: null },
    ]
    const { repo } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)
    const { stores } = installStores(['char-A', 'char-B'])

    const report = await retireMemories(['X', 'Y'], { reason: 'item-delete' })

    expect(stores['char-A'].removed).toEqual(['X'])
    expect(stores['char-B'].removed).toEqual(['Y'])
    expect(report).toMatchObject({ retired: 2, vectorsRemoved: 2 })
  })

  it('still retires the rows when the index cache fails, and drops that cache', async () => {
    const rows: FakeMemoryRow[] = [{ id: 'X', characterId: 'char-A', relatedMemoryIds: null }]
    const { repo, bulkDeleted } = buildRepo(rows)
    factoryMock.getRepositories.mockReturnValue(repo)
    resolveFrom(rows)
    const { manager } = installStores([])
    manager.getLoadedStore.mockRejectedValue(new Error('index unavailable'))

    const report = await retireMemories(['X'], { reason: 'item-delete' })

    expect(report).toMatchObject({ retired: 1, vectorsRemoved: 0 })
    expect(bulkDeleted).toEqual([{ characterId: 'char-A', ids: ['X'] }])
    // The rows are the truth: a failed eviction drops the cache so the next
    // search reloads it without the retired row.
    expect(manager.unloadStore).toHaveBeenCalledWith('char-A')
  })
})
