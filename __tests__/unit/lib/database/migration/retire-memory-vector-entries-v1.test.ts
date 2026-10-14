/**
 * @jest-environment node
 *
 * retire-memory-vector-entries-v1 (memory refactor Phase B) — `memories.embedding`
 * becomes the only copy of a memory's vector. Before dropping the
 * `vector_entries` / `vector_indices` mirror, the migration copies any vector
 * the mirror held that the row lacked (JSON-text mirror vectors converted to
 * the stored BLOB format), never overwrites a row's own vector, and discards
 * orphan mirror rows. Afterwards neither it nor normalize-vector-storage-v1
 * (which used to create the mirror) wants to run again.
 */

import path from 'path'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
type DatabaseInstance = ReturnType<typeof Database>

let testDb: DatabaseInstance = null as unknown as DatabaseInstance

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../../../migrations/lib/progress', () => ({ reportProgress: jest.fn() }))

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  getSQLiteDatabase: () => testDb,
  sqliteTableExists: (name: string) =>
    !!testDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  getSQLiteTableColumns: (table: string) =>
    testDb.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>,
}))

import { retireMemoryVectorEntriesMigration } from '../../../../../migrations/scripts/retire-memory-vector-entries-v1'
import { normalizeVectorStorageMigration } from '../../../../../migrations/scripts/normalize-vector-storage'
import { reportProgress } from '../../../../../migrations/lib/progress'
import { float32ToBlob, blobToFloat32 } from '@/lib/embedding/float32-conversion'
import { prettify, humanize } from '@/lib/startup/prettify'

const tableExists = (name: string) =>
  !!testDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)

function embeddingOf(id: string): number[] | null {
  const row = testDb.prepare('SELECT embedding FROM memories WHERE id = ?').get(id) as { embedding: Buffer | null }
  return row.embedding === null ? null : Array.from(blobToFloat32(row.embedding))
}

const OWN = [0.6, 0.8, 0]
const MIRROR_FOR_OWN = [0, 0, 1]
const MIRROR_FOR_BARE = [0, 0.6, 0.8]
const MIRROR_TEXT = [0.8, 0, 0.6]

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE memories (id TEXT PRIMARY KEY, characterId TEXT, embedding BLOB, tier TEXT DEFAULT 'hot');
    CREATE TABLE vector_indices (id TEXT PRIMARY KEY, characterId TEXT, version INTEGER, dimensions INTEGER,
      createdAt TEXT, updatedAt TEXT);
    CREATE TABLE vector_entries (id TEXT PRIMARY KEY, characterId TEXT, embedding BLOB, createdAt TEXT);
  `)
  const mem = testDb.prepare('INSERT INTO memories (id, characterId, embedding) VALUES (?, ?, ?)')
  mem.run('mem-own', 'c1', float32ToBlob(OWN)) // has its own vector
  mem.run('mem-bare', 'c1', null) // lacks one; the mirror has it
  mem.run('mem-text', 'c1', null) // lacks one; the mirror has it as JSON text
  mem.run('mem-unmirrored', 'c1', null) // lacks one; no mirror row at all

  const ve = testDb.prepare('INSERT INTO vector_entries (id, characterId, embedding, createdAt) VALUES (?, ?, ?, ?)')
  ve.run('mem-own', 'c1', float32ToBlob(MIRROR_FOR_OWN), '2026-01-01T00:00:00.000Z')
  ve.run('mem-bare', 'c1', float32ToBlob(MIRROR_FOR_BARE), '2026-01-01T00:00:00.000Z')
  ve.run('mem-text', 'c1', JSON.stringify(MIRROR_TEXT), '2026-01-01T00:00:00.000Z')
  ve.run('mem-orphan', 'c1', float32ToBlob([1, 0, 0]), '2026-01-01T00:00:00.000Z') // no memory row
  testDb
    .prepare('INSERT INTO vector_indices (id, characterId, version, dimensions, createdAt, updatedAt) VALUES (?, ?, 1, 3, ?, ?)')
    .run('c1', 'c1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
})

afterEach(() => {
  testDb.close()
})

describe('retire-memory-vector-entries-v1', () => {
  it('runs after the mirror-era migrations and has a loading-screen label', () => {
    expect(retireMemoryVectorEntriesMigration.id).toBe('retire-memory-vector-entries-v1')
    expect(retireMemoryVectorEntriesMigration.dependsOn).toEqual(
      expect.arrayContaining(['normalize-vector-storage-v1', 'quantize-embeddings-v1']),
    )
    expect(prettify('retire-memory-vector-entries-v1')).not.toBe(humanize('retire-memory-vector-entries-v1'))
  })

  it('wants to run while either mirror table exists', async () => {
    expect(await retireMemoryVectorEntriesMigration.shouldRun()).toBe(true)
    testDb.exec('DROP TABLE vector_entries')
    expect(await retireMemoryVectorEntriesMigration.shouldRun()).toBe(true)
  })

  it('copies the vectors only the mirror held, keeps rows their own, and drops both tables', async () => {
    const result = await retireMemoryVectorEntriesMigration.run()

    expect(result.success).toBe(true)

    // The row that lacked a vector took the mirror's.
    const bare = embeddingOf('mem-bare')!
    MIRROR_FOR_BARE.forEach((v, i) => expect(bare[i]).toBeCloseTo(v, 2))
    // A JSON-text mirror vector arrives as a stored BLOB.
    const text = testDb.prepare(`SELECT typeof(embedding) AS t FROM memories WHERE id = 'mem-text'`).get() as { t: string }
    expect(text.t).toBe('blob')
    const textVec = embeddingOf('mem-text')!
    MIRROR_TEXT.forEach((v, i) => expect(textVec[i]).toBeCloseTo(v, 2))
    // The row that already had a vector kept its own, not the mirror's.
    const own = embeddingOf('mem-own')!
    OWN.forEach((v, i) => expect(own[i]).toBeCloseTo(v, 2))
    // Nothing invented for a row with no mirror entry; the orphan created nothing.
    expect(embeddingOf('mem-unmirrored')).toBeNull()
    expect((testDb.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n).toBe(4)

    expect(tableExists('vector_entries')).toBe(false)
    expect(tableExists('vector_indices')).toBe(false)
    expect(result.itemsAffected).toBe(2 + 2) // two copied, two tables dropped
    expect(reportProgress).toHaveBeenCalledWith(4, 4, 'memory vectors')
  })

  it('does not want to run again once the mirror is gone', async () => {
    await retireMemoryVectorEntriesMigration.run()

    expect(await retireMemoryVectorEntriesMigration.shouldRun()).toBe(false)
  })

  it('never lets normalize-vector-storage-v1 recreate the mirror after retirement', async () => {
    await retireMemoryVectorEntriesMigration.run()

    expect(tableExists('vector_entries')).toBe(false)
    expect(tableExists('vector_indices')).toBe(false)
    expect(await normalizeVectorStorageMigration.shouldRun()).toBe(false)
  })
})
