/**
 * Window-first search — the two read primitives under it.
 *
 * - `MemoriesRepository.findIdsInEventWindow` reads a period's rows by event
 *   time (`COALESCE(occurredAt, createdAt)`) in SQL: event time wins over
 *   write time, a row with no event time falls back to its write time, and
 *   `hotOnly` drops the archive.
 * - `memoryIndex.search`'s `includeIds` scores only the listed rows, and
 *   composes with `exclude` and `hotOnly`.
 *
 * The SQL runs against a real in-memory SQLite table.
 * See docs/developer/features/complete/search-window-first-and-honest-empty.md.
 */

import path from 'path'

jest.unmock('@/lib/embedding/vector-store')

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
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'
import { float32ToBlob } from '@/lib/embedding/float32-conversion'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import { memoryIndex } from '@/lib/memory/index-store'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAR = 'char-1'
let db: InstanceType<typeof Database>

function vec(...xs: number[]): Float32Array {
  const v = Float32Array.from(xs)
  const norm = Math.hypot(...xs) || 1
  return v.map((x) => x / norm)
}

function seed(rows: Array<Record<string, unknown>>) {
  const insert = db.prepare(`INSERT INTO memories (id, characterId, tier, occurredAt, createdAt, embedding)
    VALUES (@id, @characterId, @tier, @occurredAt, @createdAt, @embedding)`)
  for (const r of rows) {
    insert.run({
      characterId: CHAR,
      tier: 'hot',
      occurredAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...r,
      embedding: r.embedding instanceof Float32Array ? float32ToBlob(r.embedding) : null,
    })
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getVectorStoreManager().unloadAll()
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT, tier TEXT, occurredAt TEXT, createdAt TEXT, embedding BLOB)`)
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(...params))
  ;(getRawDatabase as jest.Mock).mockReturnValue(db)
  const real = new MemoriesRepository()
  ;(getRepositories as jest.Mock).mockReturnValue({
    memories: { findIndexRowsByCharacterId: (c: string) => real.findIndexRowsByCharacterId(c) },
  })
})

afterEach(() => {
  db.close()
})

const NOV_3 = { from: '2026-11-03T06:00:00.000Z', to: '2026-11-04T05:59:59.999Z' }

describe('MemoriesRepository.findIdsInEventWindow', () => {
  it('reads by event time: occurredAt wins, createdAt answers when occurredAt is null', async () => {
    seed([
      { id: 'occurred-in', occurredAt: '2026-11-03T22:40:00.000Z', createdAt: '2026-11-04T09:00:00.000Z' },
      { id: 'occurred-out-created-in', occurredAt: '2026-10-01T12:00:00.000Z', createdAt: '2026-11-03T23:00:00.000Z' },
      { id: 'created-in', createdAt: '2026-11-03T23:10:00.000Z' },
      { id: 'created-out', createdAt: '2026-11-05T00:00:00.000Z' },
      { id: 'other-character', characterId: 'char-2', createdAt: '2026-11-03T23:10:00.000Z' },
    ])
    const ids = await new MemoriesRepository().findIdsInEventWindow(CHAR, NOV_3, { hotOnly: false })
    expect(ids.sort()).toEqual(['created-in', 'occurred-in'])
  })

  it('hotOnly drops cold rows; a NULL tier reads as hot', async () => {
    seed([
      { id: 'hot', createdAt: '2026-11-03T12:00:00.000Z' },
      { id: 'null-tier', tier: null, createdAt: '2026-11-03T12:00:00.000Z' },
      { id: 'cold', tier: 'cold', createdAt: '2026-11-03T12:00:00.000Z' },
    ])
    const repo = new MemoriesRepository()
    expect((await repo.findIdsInEventWindow(CHAR, NOV_3, { hotOnly: true })).sort()).toEqual(['hot', 'null-tier'])
    expect((await repo.findIdsInEventWindow(CHAR, NOV_3, { hotOnly: false })).sort()).toEqual(['cold', 'hot', 'null-tier'])
  })

  it('answers empty when the query fails', async () => {
    ;(rawQuery as jest.Mock).mockRejectedValueOnce(new Error('disk on fire'))
    expect(await new MemoriesRepository().findIdsInEventWindow(CHAR, NOV_3, { hotOnly: false })).toEqual([])
  })
})

describe('memoryIndex.search includeIds', () => {
  beforeEach(() => {
    seed([
      { id: 'a', embedding: vec(1, 0, 0) },
      { id: 'b', embedding: vec(0.9, 0.1, 0) },
      { id: 'c', embedding: vec(0.5, 0.5, 0) },
      { id: 'd', tier: 'cold', embedding: vec(0.8, 0.2, 0) },
    ])
  })

  it('scores only the listed ids', async () => {
    const hits = await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: false, includeIds: new Set(['c', 'b']) })
    expect(hits.map(h => h.id)).toEqual(['b', 'c'])
  })

  it('composes with exclude and hotOnly', async () => {
    const includeIds = new Set(['b', 'c', 'd'])
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: true, includeIds })).map(h => h.id))
      .toEqual(['b', 'c'])
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: false, includeIds, exclude: new Set(['b']) })).map(h => h.id))
      .toEqual(['d', 'c'])
  })

  it('without includeIds, searches the whole index as before', async () => {
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 2, hotOnly: false })).map(h => h.id)).toEqual(['a', 'b'])
  })
})
