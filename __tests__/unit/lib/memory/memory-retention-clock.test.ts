/**
 * Bug 225 — cold retention ages by `supersededAt`, and deletes scrub digest links.
 *
 * - Retention used `updatedAt < cutoff`, and every link rewrite resets
 *   `updatedAt`, so a superseded member that kept being re-linked never aged
 *   out. It now ages by `supersededAt` (falling back to `updatedAt` only for a
 *   row with no stamp), which `updateTierBulk` sets and clears with
 *   `supersededById` — in maintenance's retire planner (`planRetention`).
 * - The delete chokepoint (now `retireMemories`) scrubbed `relatedMemoryIds` only, leaving surviving
 *   digests' `consolidatedFrom` naming deleted members and surviving members
 *   of a deleted digest pointing `supersededById` at nothing.
 *
 * The SQL runs against a real in-memory SQLite table; the repository writes
 * `retireMemories` issues are applied to the same table.
 */

import path from 'path'

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

// The real cache: `memoryIndex` only touches a loaded store, and none is
// loaded here.
jest.unmock('@/lib/embedding/vector-store')

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import { rawQuery } from '@/lib/database/manager'
import { getRawDatabase } from '@/lib/database/backends/sqlite/client'
import { getRepositories } from '@/lib/repositories/factory'
import { retireMemories } from '@/lib/memory/retire'
import { planRetention } from '@/lib/memory/maintenance/demote'
import type { Memory } from '@/lib/schemas/types'
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAR = 'char-1'
let db: InstanceType<typeof Database>

function seed(rows: Array<Record<string, unknown>>) {
  const insert = db.prepare(`INSERT INTO memories
    (id, characterId, tier, source, supersededById, supersededAt, consolidatedFrom, relatedMemoryIds, updatedAt)
    VALUES (@id, @characterId, @tier, @source, @supersededById, @supersededAt, @consolidatedFrom, @relatedMemoryIds, @updatedAt)`)
  for (const r of rows) {
    insert.run({
      characterId: CHAR, tier: 'hot', source: 'AUTO', supersededById: null, supersededAt: null,
      consolidatedFrom: '[]', relatedMemoryIds: '[]', updatedAt: '2026-01-01T00:00:00.000Z',
      ...r,
    })
  }
}

function read(id: string) {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

/** Repository writes `retireMemories` issues, applied to the real table. */
function installRepos() {
  const now = '2026-09-01T00:00:00.000Z'
  const real = new MemoriesRepository()
  const memories = {
    findById: jest.fn(async (id: string) => read(id) ?? null),
    // The retirement's digest-liveness rule reads members by id.
    findByIds: jest.fn(async (ids: string[]) => ids.map(read).filter((r): r is Record<string, unknown> => !!r)),
    // The digest scrub's reads and its removal delta are the production SQL.
    findDigestsContainingMembers: jest.fn((c: string[], m: string[]) => real.findDigestsContainingMembers(c, m)),
    findIdsSupersededByAny: jest.fn((c: string[], d: string[]) => real.findIdsSupersededByAny(c, d)),
    removeConsolidatedMembers: jest.fn((c: string, d: string, m: string[]) => real.removeConsolidatedMembers(c, d, m)),
    removeRelatedMemoryIdsEverywhere: jest.fn((ids: string[]) => real.removeRelatedMemoryIdsEverywhere(ids)),
    updateForCharacter: jest.fn(async (_c: string, id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        db.prepare(`UPDATE memories SET "${k}" = ?, updatedAt = ? WHERE id = ?`)
          .run(Array.isArray(v) ? JSON.stringify(v) : v, now, id)
      }
      return read(id)
    }),
    updateTierBulk: jest.fn(async (_c: string, ids: string[], tier: string, extra: Record<string, unknown>) => {
      for (const id of ids) {
        db.prepare(`UPDATE memories SET tier = ?, supersededById = ?, supersededAt = NULL, updatedAt = ? WHERE id = ?`)
          .run(tier, extra.supersededById ?? null, now, id)
      }
      return ids.length
    }),
    bulkDeleteUnsafe: jest.fn(async (_c: string, ids: string[]) => {
      let n = 0
      for (const id of ids) n += db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes
      return n
    }),
  }
  ;(getRepositories as jest.Mock).mockReturnValue({ memories })
  return memories
}

beforeEach(() => {
  jest.clearAllMocks()
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT, aboutCharacterId TEXT, tier TEXT, source TEXT,
    supersededById TEXT, supersededAt TEXT, consolidatedFrom TEXT, relatedMemoryIds TEXT, updatedAt TEXT)`)
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(...params))
  ;(getRawDatabase as jest.Mock).mockReturnValue(db)
})

afterEach(() => {
  db.close()
})

describe('bug 225 — retention ages by supersededAt', () => {
  it('expires a superseded member whose links were rewritten after it went cold', () => {
    const rows = [
      // Superseded in February; a link rewrite in September reset updatedAt.
      { id: 'relinked', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      // Superseded recently: not yet expired.
      { id: 'fresh', tier: 'cold', supersededById: 'digest', supersededAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' },
      // Never stamped (missed the backfill): falls back to updatedAt.
      { id: 'legacy', tier: 'cold', supersededById: 'digest', supersededAt: null, updatedAt: '2026-01-15T00:00:00.000Z' },
      // Cap-demoted, MANUAL, and hot rows are never retention's to delete.
      { id: 'demoted', tier: 'cold', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'manual', tier: 'cold', source: 'MANUAL', supersededById: 'digest', supersededAt: '2026-01-01T00:00:00.000Z' },
      // A superseded digest is not AUTO either.
      { id: 'old-digest', tier: 'cold', source: 'CONSOLIDATED', supersededById: 'digest', supersededAt: '2026-01-01T00:00:00.000Z' },
      { id: 'hot', tier: 'hot', supersededById: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    ].map((r) => ({ source: 'AUTO', supersededAt: null, updatedAt: '2026-01-01T00:00:00.000Z', ...r })) as unknown as Memory[]

    // A 120-day window ending 2026-10-01 has its cutoff at 2026-06-03.
    const ids = planRetention(rows, 120, Date.parse('2026-10-01T00:00:00.000Z'))

    expect(ids.sort()).toEqual(['legacy', 'relinked'])
  })

  it('updateTierBulk stamps supersededAt with supersededById and clears it with the link', async () => {
    const repo = new MemoriesRepository()
    const updateMany = jest
      .spyOn(repo as unknown as { updateMany: (...a: unknown[]) => Promise<number> }, 'updateMany')
      .mockResolvedValue(1)

    await repo.updateTierBulk(CHAR, ['m-1'], 'cold', { supersededById: '7e0c6f2e-0000-4000-8000-000000000001' })
    const supersede = updateMany.mock.calls[0][1] as Record<string, unknown>
    expect(typeof supersede.supersededAt).toBe('string')
    expect(supersede.supersededAt).toBe(supersede.updatedAt)

    await repo.updateTierBulk(CHAR, ['m-1'], 'hot', { supersededById: null })
    expect((updateMany.mock.calls[1][1] as Record<string, unknown>).supersededAt).toBeNull()

    // A tier move that says nothing about the digest leaves the clock alone.
    await repo.updateTierBulk(CHAR, ['m-1'], 'cold')
    expect(updateMany.mock.calls[2][1]).not.toHaveProperty('supersededAt')
  })
})

describe('bug 225 — retireMemories scrubs digest links', () => {
  it('batch delete drops deleted members from a surviving digest\'s consolidatedFrom', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1', 'm-2', 'm-3']) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z' },
      { id: 'm-2', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z', relatedMemoryIds: JSON.stringify(['m-1']) },
      { id: 'm-3', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z' },
    ])
    installRepos()

    const report = await retireMemories(['m-1', 'm-3'], { reason: 'item-delete' })

    expect(report.retired).toBe(2)
    expect(JSON.parse(read('digest')!.consolidatedFrom as string)).toEqual(['m-2'])
    expect(JSON.parse(read('m-2')!.relatedMemoryIds as string)).toEqual([])
    // The surviving member still belongs to the surviving digest.
    expect(read('m-2')!.supersededById).toBe('digest')
  })

  it('deleting a digest cuts supersededById on its surviving members', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1', 'm-2']) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z' },
      { id: 'm-2', tier: 'cold', supersededById: 'digest', supersededAt: '2026-02-01T00:00:00.000Z' },
    ])
    const memories = installRepos()

    expect((await retireMemories(['digest'], { reason: 'item-delete' })).retired).toBe(1)

    expect(read('digest')).toBeUndefined()
    for (const id of ['m-1', 'm-2']) {
      const member = read(id)!
      expect(member.tier).toBe('cold')
      expect(member.supersededById).toBeNull()
      expect(member.supersededAt).toBeNull()
    }
    expect(memories.updateTierBulk).toHaveBeenCalledWith(CHAR, ['m-1', 'm-2'], 'cold', { supersededById: null })
  })

  it('single delete of a member drops it from its digest', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1', 'm-2']) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest' },
      { id: 'm-2', tier: 'cold', supersededById: 'digest' },
    ])
    installRepos()

    expect((await retireMemories(['m-1'], { reason: 'item-delete' })).retired).toBe(1)

    expect(JSON.parse(read('digest')!.consolidatedFrom as string)).toEqual(['m-2'])
  })
})
