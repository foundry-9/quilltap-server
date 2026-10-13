/**
 * `retireMemories`' digest bookkeeping (review of bugs 208 / 225):
 *
 * - **Composes in the job child.** `scrubDigestLinks` used to read
 *   `consolidatedFrom` with a raw query (blind to the job's own buffered
 *   writes) and write the whole array back. Two deletes from one digest in one
 *   job each wrote a list built from the committed row, and the replay kept
 *   only the second — resurrecting the first deleted member. It now issues a
 *   removal delta (`removeConsolidatedMembers`) the parent applies in SQL.
 * - **Scoped.** The digest scan walked every digest in the instance on every
 *   delete, and the orphaned-member lookup scanned the whole table. Both are
 *   now scoped to the doomed rows' holders, pre-filtered, and indexed.
 * - **Refreshes the Commonplace mirror.** Deleting a digest left
 *   `Commonplace/<Subject>.md` presenting it as canon. The chokepoint now
 *   re-mirrors the bucket after the delete (parent), and the dispatcher does
 *   so after a child's batch commits.
 *
 * Every SQL statement runs against a real in-memory SQLite table; in the job
 * child the real proxy buffers the writes, and the replay applies them in
 * order through the same SQL-backed repository, as the parent does.
 */

import path from 'path'

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () =>
    process.env.QUILLTAP_JOB_CHILD === '1'
      ? require('@/lib/background-jobs/child/child-repositories-proxy').getChildRepositoriesProxy()
      : require('@/lib/database/repositories').getRepositories(),
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

// The real cache: `memoryIndex.remove` only touches a loaded store, and none is
// loaded here.
jest.unmock('@/lib/embedding/vector-store')

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

jest.mock('@/lib/file-storage/commonplace-digest-vault-bridge', () => ({
  writeCommonplaceDigestsToVault: jest.fn(async () => ({ written: 1, unchanged: 0, skipped: 0 })),
}))

jest.mock('@/lib/background-jobs/host/processor-host', () => ({
  sendToChild: jest.fn(() => true),
  notifyChild: jest.fn(),
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
import { getRepositories as realRepositorySource } from '@/lib/database/repositories'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import { retireMemories } from '@/lib/memory/retire'
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'
import {
  digestBucketsDeletedByWrites,
  mirrorCommonplaceForDeletedDigests,
} from '@/lib/memory/commonplace-mirror'
import {
  runWithJobScope,
  flushPendingWrites,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy'
import type { ChildWritePayload } from '@/lib/background-jobs/ipc-types'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAR = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const LAURA = '33333333-3333-4333-8333-333333333333'

let db: InstanceType<typeof Database>

function seed(rows: Array<Record<string, unknown>>) {
  const insert = db.prepare(`INSERT INTO memories
    (id, characterId, aboutCharacterId, tier, source, content, importance, reinforcedImportance,
     supersededById, consolidatedFrom, relatedMemoryIds, updatedAt, createdAt)
    VALUES (@id, @characterId, @aboutCharacterId, @tier, @source, @content, @importance, @reinforcedImportance,
     @supersededById, @consolidatedFrom, @relatedMemoryIds, @updatedAt, @createdAt)`)
  for (const r of rows) {
    insert.run({
      characterId: CHAR, aboutCharacterId: null, tier: 'hot', source: 'AUTO', content: `row ${r.id}`,
      importance: 0.5, reinforcedImportance: 0.5, supersededById: null, consolidatedFrom: '[]',
      relatedMemoryIds: '[]', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
      ...r,
    })
  }
}

function read(id: string) {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

function membersOf(id: string): string[] {
  return JSON.parse(read(id)!.consolidatedFrom as string)
}

function hydrate(row: Record<string, unknown> | undefined) {
  if (!row) return null
  return {
    ...row,
    consolidatedFrom: JSON.parse((row.consolidatedFrom as string) ?? '[]'),
    relatedMemoryIds: JSON.parse((row.relatedMemoryIds as string) ?? '[]'),
  }
}

/**
 * The parent's repositories: every method a SQL statement against the real
 * table. The chokepoint's own scans are the production repository methods.
 * In the job child the proxy passes reads here and buffers writes; the replay
 * calls these same methods in order.
 */
function installRepos() {
  const real = new MemoriesRepository()
  const now = '2026-09-01T00:00:00.000Z'
  const memories = {
    findById: jest.fn(async (id: string) => hydrate(read(id))),
    // The retirement's digest-liveness rule reads members by id.
    findByIds: jest.fn(async (ids: string[]) => ids.map((id) => hydrate(read(id))).filter((r) => !!r)),
    findDigestsContainingMembers: jest.fn((c: string[], m: string[]) => real.findDigestsContainingMembers(c, m)),
    findIdsSupersededByAny: jest.fn((c: string[], d: string[]) => real.findIdsSupersededByAny(c, d)),
    findDigestSubjectsByIds: jest.fn((ids: string[]) => real.findDigestSubjectsByIds(ids)),
    removeConsolidatedMembers: jest.fn((c: string, d: string, m: string[]) => real.removeConsolidatedMembers(c, d, m)),
    removeRelatedMemoryIdsEverywhere: jest.fn((ids: string[]) => real.removeRelatedMemoryIdsEverywhere(ids)),
    findHotDigests: jest.fn(async (holder: string, subject: string) =>
      db.prepare(`SELECT * FROM memories WHERE characterId = ? AND source = 'CONSOLIDATED'
                    AND COALESCE(tier, 'hot') = 'hot' AND aboutCharacterId = ?
                  ORDER BY reinforcedImportance DESC`)
        .all(holder, subject === 'self' ? holder : subject)),
    updateForCharacter: jest.fn(async (_c: string, id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        db.prepare(`UPDATE memories SET "${k}" = ?, updatedAt = ? WHERE id = ?`)
          .run(Array.isArray(v) ? JSON.stringify(v) : v, now, id)
      }
      return hydrate(read(id))
    }),
    updateTierBulk: jest.fn(async (_c: string, ids: string[], tier: string, extra: Record<string, unknown> = {}) => {
      for (const id of ids) {
        db.prepare('UPDATE memories SET tier = ?, supersededById = ?, updatedAt = ? WHERE id = ?')
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
  const characters = {
    findByIdRaw: jest.fn(async (id: string) =>
      id === CHAR ? { id: CHAR, name: 'Friday', archivedAt: null } : id === LAURA ? { id: LAURA, name: 'Laura' } : null),
    findById: jest.fn(async (id: string) => (id === LAURA ? { id: LAURA, name: 'Laura' } : null)),
  }
  ;(realRepositorySource as jest.Mock).mockReturnValue({ memories, characters })
  return memories
}

/** Apply a buffered batch the way the parent does: in order, on the real table. */
async function replay(writes: ChildWritePayload[]) {
  const repos = (realRepositorySource as jest.Mock)() as Record<string, Record<string, (...a: unknown[]) => unknown>>
  for (const w of writes) {
    const [repoKey, method] = w.method.split('.')
    await repos[repoKey][method](...(w.args as unknown[]))
  }
}

async function inJob<T>(fn: () => Promise<T>): Promise<{ result: T; writes: ChildWritePayload[] }> {
  process.env.QUILLTAP_JOB_CHILD = '1'
  try {
    let writes: ChildWritePayload[] = []
    const result = await runWithJobScope('job-1', async () => {
      const r = await fn()
      writes = flushPendingWrites()
      return r
    })
    return { result, writes }
  } finally {
    delete process.env.QUILLTAP_JOB_CHILD
  }
}

const sqlSeen: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  __resetProxyCacheForTesting()
  delete process.env.QUILLTAP_JOB_CHILD
  sqlSeen.length = 0
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT, aboutCharacterId TEXT, tier TEXT, source TEXT, content TEXT,
    importance REAL, reinforcedImportance REAL, supersededById TEXT, supersededAt TEXT,
    consolidatedFrom TEXT, relatedMemoryIds TEXT, updatedAt TEXT, createdAt TEXT)`)
  // The production indexes the chokepoint's queries may lean on.
  db.exec('CREATE INDEX "idx_memories_characterId" ON "memories" ("characterId")')
  db.exec('CREATE INDEX "idx_memories_character_tier" ON "memories" ("characterId", "tier")')
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) => {
    sqlSeen.push(sql)
    return db.prepare(sql).all(...params)
  })
  ;(getRawDatabase as jest.Mock).mockReturnValue(db)
})

afterEach(() => {
  db.close()
  delete process.env.QUILLTAP_JOB_CHILD
})

function seedDigest() {
  seed([
    { id: 'digest', source: 'CONSOLIDATED', aboutCharacterId: LAURA, consolidatedFrom: JSON.stringify(['m-1', 'm-2', 'm-3']) },
    { id: 'm-1', tier: 'cold', supersededById: 'digest' },
    { id: 'm-2', tier: 'cold', supersededById: 'digest' },
    { id: 'm-3', tier: 'cold', supersededById: 'digest' },
  ])
}

describe('#2 — digest member removal composes within one child job', () => {
  it('two single deletes from one digest both stick after replay', async () => {
    seedDigest()
    installRepos()

    const { writes } = await inJob(async () => {
      await retireMemories(['m-1'], { reason: 'item-delete' })
      await retireMemories(['m-3'], { reason: 'item-delete' })
    })
    await replay(writes)

    expect(read('m-1')).toBeUndefined()
    expect(read('m-3')).toBeUndefined()
    expect(membersOf('digest')).toEqual(['m-2'])
  })

  it('two batch deletes from one digest both stick after replay', async () => {
    seedDigest()
    installRepos()

    const { writes } = await inJob(async () => {
      await retireMemories(['m-1'], { reason: 'item-delete' })
      await retireMemories(['m-3'], { reason: 'item-delete' })
    })
    await replay(writes)

    expect(membersOf('digest')).toEqual(['m-2'])
  })

  it('a later read in the same job sees the buffered removal', async () => {
    seedDigest()
    installRepos()

    await inJob(async () => {
      await retireMemories(['m-1'], { reason: 'item-delete' })
      const { getRepositories } = require('@/lib/repositories/factory')
      const [digest] = await getRepositories().memories.findDigestsContainingMembers([CHAR], ['m-2'])
      expect(digest.consolidatedFrom).toEqual(['m-2', 'm-3'])
    })
  })

  it('removeConsolidatedMembers is a delta on the row as it stands', async () => {
    seed([{ id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['a', 'b', 'c', 'd']) }])
    const repo = new MemoriesRepository()
    expect(await repo.removeConsolidatedMembers(CHAR, 'digest', ['b'])).toBe(1)
    expect(await repo.removeConsolidatedMembers(CHAR, 'digest', ['d', 'zz'])).toBe(1)
    expect(membersOf('digest')).toEqual(['a', 'c'])
    // Scoped by holder: another character's id touches nothing.
    expect(await repo.removeConsolidatedMembers(OTHER, 'digest', ['a'])).toBe(0)
    expect(membersOf('digest')).toEqual(['a', 'c'])
  })
})

describe('#12 — the digest scrub is scoped and indexed', () => {
  async function runMigration() {
    jest.doMock('@/migrations/lib/database-utils', () => ({
      isSQLiteBackend: () => true,
      getSQLiteDatabase: () => db,
      sqliteTableExists: () => true,
      sqliteColumnExists: () => true,
    }))
    let migration: { shouldRun(): Promise<boolean>; run(): Promise<{ success: boolean }> } | undefined
    jest.isolateModules(() => {
      migration = require('@/migrations/scripts/add-memories-superseded-by-index-v1').addMemoriesSupersededByIndexMigration
    })
    expect(await migration!.shouldRun()).toBe(true)
    expect((await migration!.run()).success).toBe(true)
    expect(await migration!.shouldRun()).toBe(false)
    jest.dontMock('@/migrations/lib/database-utils')
  }

  it('never scans the whole memories table for digest links', async () => {
    await runMigration()
    seedDigest()
    // Another holder's digest is out of scope and must not be read.
    seed([{ id: 'other-digest', characterId: OTHER, source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['x-1']) }])
    const memories = installRepos()

    await retireMemories(['m-1', 'digest'], { reason: 'item-delete' })

    expect(memories.findDigestsContainingMembers).toHaveBeenCalledWith([CHAR], expect.arrayContaining(['m-1', 'digest']))
    const digestQueries = sqlSeen.filter(sql => /consolidatedFrom|supersededById/.test(sql) && !/^\s*UPDATE/i.test(sql))
    expect(digestQueries.length).toBeGreaterThan(0)
    for (const sql of digestQueries) {
      const params = (sql.match(/\?/g) ?? []).map(() => 'p')
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>
      expect(plan.map(p => p.detail).join(' | ')).not.toMatch(/SCAN memories(?! USING)/)
    }
  })

  it('the supersededById lookup can use the new index', async () => {
    await runMigration()
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM memories WHERE supersededById IN (?, ?)')
      .all('a', 'b') as Array<{ detail: string }>
    expect(plan.map(p => p.detail).join(' ')).toMatch(/idx_memories_supersededById/)
  })
})

describe('#3 — deleting a digest refreshes the Commonplace mirror', () => {
  function seedTwoDigests() {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', aboutCharacterId: LAURA, content: 'Laura hoards maps.', reinforcedImportance: 0.9, consolidatedFrom: JSON.stringify(['m-1', 'm-1b']) },
      { id: 'digest-2', source: 'CONSOLIDATED', aboutCharacterId: LAURA, content: 'Laura keeps the charts.', reinforcedImportance: 0.7, consolidatedFrom: JSON.stringify(['m-2', 'm-2b']) },
      // Two members each, so retiring one member never empties a digest (that
      // cascade is pinned separately below).
      { id: 'm-1', tier: 'cold', supersededById: 'digest', aboutCharacterId: LAURA },
      { id: 'm-1b', tier: 'cold', supersededById: 'digest', aboutCharacterId: LAURA },
      { id: 'm-2', tier: 'cold', supersededById: 'digest-2', aboutCharacterId: LAURA },
      { id: 'm-2b', tier: 'cold', supersededById: 'digest-2', aboutCharacterId: LAURA },
    ])
  }

  function mirroredContents(call = 0): string[] {
    const input = (writeCommonplaceDigestsToVault as jest.Mock).mock.calls[call][0]
    expect(input.holderCharacterId).toBe(CHAR)
    const file = input.files.find((f: { subjectCharacterId: string }) => f.subjectCharacterId === LAURA)
    return file.digests.map((d: { content: string }) => d.content)
  }

  it('single retirement (the DELETE route\'s chokepoint) re-mirrors the bucket without the digest', async () => {
    seedTwoDigests()
    installRepos()

    expect((await retireMemories(['digest'], { reason: 'item-delete' })).retired).toBe(1)

    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledTimes(1)
    expect(mirroredContents()).toEqual(['Laura keeps the charts.'])
  })

  it('batch retirement re-mirrors the bucket too', async () => {
    seedTwoDigests()
    installRepos()

    expect((await retireMemories(['digest'], { reason: 'item-delete' })).retired).toBe(1)

    expect(mirroredContents()).toEqual(['Laura keeps the charts.'])
  })

  it('deleting the last digest hands the bridge an empty bucket', async () => {
    seed([{ id: 'digest', source: 'CONSOLIDATED', aboutCharacterId: LAURA, content: 'Laura hoards maps.' }])
    installRepos()

    await retireMemories(['digest'], { reason: 'item-delete' })

    expect(mirroredContents()).toEqual([])
  })

  it('deleting an ordinary memory writes no mirror', async () => {
    seedTwoDigests()
    installRepos()

    await retireMemories(['m-1'], { reason: 'item-delete' })
    await retireMemories(['m-2'], { reason: 'item-delete' })

    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })

  it('retiring a digest\'s last member retires the digest and re-mirrors the bucket', async () => {
    seedTwoDigests()
    installRepos()

    const report = await retireMemories(['m-1', 'm-1b'], { reason: 'item-delete' })

    expect(report.digestsRetiredWithLastMember).toBe(1)
    expect(read('digest')).toBeUndefined()
    expect(mirroredContents()).toEqual(['Laura keeps the charts.'])
  })

  it('in the job child nothing is mirrored; the commit hook mirrors after replay', async () => {
    seedTwoDigests()
    installRepos()

    const { writes } = await inJob(async () => {
      await retireMemories(['digest'], { reason: 'item-delete' })
    })
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()

    // The dispatcher reads the buckets before commit, then mirrors after.
    const buckets = await digestBucketsDeletedByWrites(writes)
    expect(Array.from(buckets.get(CHAR) ?? [])).toEqual([LAURA])
    await replay(writes)
    expect(read('digest')).toBeUndefined()
    await mirrorCommonplaceForDeletedDigests(buckets)

    expect(mirroredContents()).toEqual(['Laura keeps the charts.'])
  })
})
