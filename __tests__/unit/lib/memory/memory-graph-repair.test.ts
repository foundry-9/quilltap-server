/**
 * @jest-environment node
 *
 * The memory graph repair (memory refactor Phase G, `quilltap memories
 * validate --repair`): `findDanglingLinks` finds links in all three link
 * columns that name a row which no longer exists (real SQL on an in-memory
 * SQLite), and `repairMemoryGraph` scrubs them through the retirement's own
 * deltas only on a live run.
 */

import path from 'path'

jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: jest.fn() }))
jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn(() => ({ getLoadedStore: async () => null, unloadStore: jest.fn() })),
  isHotVector: jest.fn(() => true),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/memory/recall/archive', () => ({ invalidateFrozenArchive: jest.fn() }))
jest.mock('@/lib/memory/index-store/backfill', () => ({
  enqueueMissingEmbeddings: jest.fn(async () => ({ status: 'ok', enqueued: 1, remaining: 1 })),
}))
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import { getRawDatabase } from '@/lib/database/backends/sqlite/client'
import { rawQuery } from '@/lib/database/manager'
import { getRepositories } from '@/lib/repositories/factory'
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'
import { repairMemoryGraph } from '@/lib/memory/repair'
import { publishRealtime } from '@/lib/realtime/bus'
import { enqueueMissingEmbeddings } from '@/lib/memory/index-store/backfill'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const A = 'char-a'
const B = 'char-b'
let db: any
let repo: MemoriesRepository

function seed(row: {
  id: string
  characterId: string
  related?: string[]
  consolidatedFrom?: string[]
  supersededById?: string | null
  tier?: 'hot' | 'cold'
  embedded?: boolean
}) {
  db.prepare(
    `INSERT INTO memories (id, characterId, relatedMemoryIds, consolidatedFrom, supersededById, tier, embedding, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.characterId,
    JSON.stringify(row.related ?? []),
    JSON.stringify(row.consolidatedFrom ?? []),
    row.supersededById ?? null,
    row.tier ?? 'hot',
    row.embedded === false ? null : 'x',
    '2026-01-01T00:00:00.000Z',
  )
}

function col(id: string, name: string): unknown {
  return db.prepare(`SELECT ${name} AS v FROM memories WHERE id = ?`).get(id).v
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT NOT NULL, relatedMemoryIds TEXT DEFAULT '[]',
    consolidatedFrom TEXT DEFAULT '[]', supersededById TEXT, tier TEXT, embedding TEXT, updatedAt TEXT)`)
  ;(getRawDatabase as jest.Mock).mockReturnValue(db)
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params))

  repo = new MemoriesRepository()
  // The repair reads through the real SQL above; the tier write and the
  // missing-embedding count are the only other repository calls it makes.
  const memories = {
    findDanglingLinks: (ids?: string[]) => repo.findDanglingLinks(ids),
    removeRelatedMemoryIdsEverywhere: (ids: string[]) => repo.removeRelatedMemoryIdsEverywhere(ids),
    removeConsolidatedMembers: (c: string, d: string, m: string[]) => repo.removeConsolidatedMembers(c, d, m),
    updateTierBulk: jest.fn(async (characterId: string, ids: string[], tier: string, extra: { supersededById?: null }) => {
      for (const id of ids) {
        db.prepare('UPDATE memories SET tier = ?, supersededById = ? WHERE id = ? AND characterId = ?').run(tier, extra?.supersededById ?? null, id, characterId)
      }
      return ids.length
    }),
    countWithoutEmbedding: jest.fn(async (characterId?: string) =>
      characterId
        ? db.prepare('SELECT count(*) AS n FROM memories WHERE embedding IS NULL AND characterId = ?').get(characterId).n
        : db.prepare('SELECT count(*) AS n FROM memories WHERE embedding IS NULL').get().n,
    ),
  }
  ;(getRepositories as jest.Mock).mockReturnValue({ memories })

  // A: n1 links a live row and a gone one; d1 is a digest naming a live and a gone member;
  // m1 is a cold member of a gone digest; m2 a hot row whose digest is gone.
  seed({ id: 'n1', characterId: A, related: ['live', 'gone-1'] })
  seed({ id: 'live', characterId: A, related: ['n1'] })
  seed({ id: 'd1', characterId: A, consolidatedFrom: ['live', 'gone-2'] })
  seed({ id: 'm1', characterId: A, tier: 'cold', supersededById: 'gone-3' })
  seed({ id: 'm2', characterId: A, tier: 'hot', supersededById: 'gone-4', embedded: false })
  // B links across to A's live row (legitimate) and to a gone row.
  seed({ id: 'o1', characterId: B, related: ['live', 'gone-1'] })
})

afterEach(() => {
  db.close()
  jest.clearAllMocks()
})

describe('MemoriesRepository.findDanglingLinks', () => {
  it('finds every link to a missing row in all three columns, cross-holder links allowed', async () => {
    const found = await repo.findDanglingLinks()
    expect(found.related.map((l) => [l.id, l.target]).sort()).toEqual([['n1', 'gone-1'], ['o1', 'gone-1']])
    expect(found.consolidatedFrom).toEqual([{ id: 'd1', characterId: A, target: 'gone-2' }])
    expect(found.supersededBy.map((l) => [l.id, l.target, l.tier]).sort()).toEqual([
      ['m1', 'gone-3', 'cold'],
      ['m2', 'gone-4', 'hot'],
    ])
  })

  it('scopes to the named holders', async () => {
    const found = await repo.findDanglingLinks([B])
    expect(found.related).toEqual([{ id: 'o1', characterId: B, target: 'gone-1' }])
    expect(found.consolidatedFrom).toEqual([])
    expect(found.supersededBy).toEqual([])
  })
})

describe('repairMemoryGraph', () => {
  it('a dry run reports and writes nothing', async () => {
    const report = await repairMemoryGraph({ userId: 'u', dryRun: true })
    expect(report.found).toEqual({
      related: { links: 2, rows: 2 },
      consolidatedFrom: { links: 1, digests: 1 },
      supersededBy: 2,
      missingEmbeddings: 1,
    })
    expect(report.repaired).toBeUndefined()
    expect(JSON.parse(col('n1', 'relatedMemoryIds') as string)).toEqual(['live', 'gone-1'])
    expect(enqueueMissingEmbeddings).not.toHaveBeenCalled()
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('a live run scrubs every dangling link, keeps tiers, and queues the missing embedding', async () => {
    const report = await repairMemoryGraph({ userId: 'u', dryRun: false })
    expect(JSON.parse(col('n1', 'relatedMemoryIds') as string)).toEqual(['live'])
    expect(JSON.parse(col('o1', 'relatedMemoryIds') as string)).toEqual(['live'])
    expect(JSON.parse(col('live', 'relatedMemoryIds') as string)).toEqual(['n1'])
    expect(JSON.parse(col('d1', 'consolidatedFrom') as string)).toEqual(['live'])
    expect(col('m1', 'supersededById')).toBeNull()
    expect(col('m1', 'tier')).toBe('cold')
    expect(col('m2', 'supersededById')).toBeNull()
    expect(col('m2', 'tier')).toBe('hot')
    expect(report.repaired).toMatchObject({ relatedRowsTouched: 2, digestsTouched: 1, membersCut: 2, embeddingJobsQueued: 1 })
    expect(enqueueMissingEmbeddings).toHaveBeenCalledWith({ userId: 'u', characterId: undefined, limit: 2000 })
    expect(publishRealtime).toHaveBeenCalledWith('memories')

    // Idempotent: a second scan finds nothing.
    const again = await repo.findDanglingLinks()
    expect(again).toEqual({ related: [], consolidatedFrom: [], supersededBy: [] })
  })
})
