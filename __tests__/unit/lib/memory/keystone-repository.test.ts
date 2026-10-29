/**
 * The keystone reads on `MemoriesRepository` (inner-circle-recall.md C3), run
 * against a real in-memory SQLite table:
 *
 * - `findKeystones` returns hot keystones only, about the named subjects (or,
 *   for `'self'`, about the holder or no one), in creation order — never by
 *   score — and hydrates the stored 0 / 1 as a boolean.
 * - `countKeystones` counts one subject's hot keystones, less an excluded row.
 * - Every raw read hydrates `keystone` as a boolean, so a row is never dropped
 *   by validation for carrying the integer SQLite stores.
 */

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
}))

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => makeLogger()) })
  return { logger: makeLogger() }
})

import path from 'path'
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'
import { rawQuery } from '@/lib/database/manager'

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const HOLDER = '00000000-0000-4000-8000-000000000001'
const ABIGAIL = '00000000-0000-4000-8000-000000000002'
const GREG = '00000000-0000-4000-8000-000000000003'

let db: any
let n = 0

function seed(rows: Array<Record<string, unknown>>) {
  const insert = db.prepare(`INSERT INTO memories
    (id, characterId, aboutCharacterId, content, summary, keywords, tags, importance, source, tier,
     reinforcedImportance, relatedMemoryIds, entities, consolidatedFrom, keystone, createdAt, updatedAt)
    VALUES (@id, @characterId, @aboutCharacterId, @content, @summary, '[]', '[]', 0.5, 'MANUAL', @tier,
     @reinforcedImportance, '[]', '[]', '[]', @keystone, @createdAt, @createdAt)`)
  for (const r of rows) {
    n++
    insert.run({
      id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
      characterId: HOLDER,
      aboutCharacterId: ABIGAIL,
      content: `content ${n}`,
      summary: `summary ${n}`,
      tier: 'hot',
      reinforcedImportance: 0.5,
      keystone: 0,
      createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
      ...r,
    })
  }
}

beforeEach(() => {
  n = 0
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT, aboutCharacterId TEXT, content TEXT, summary TEXT,
    keywords TEXT, tags TEXT, importance REAL, source TEXT, tier TEXT, reinforcedImportance REAL,
    relatedMemoryIds TEXT, entities TEXT, consolidatedFrom TEXT, keystone INTEGER NOT NULL DEFAULT 0, lastReinforcedAt TEXT,
    createdAt TEXT, updatedAt TEXT)`)
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params))
})

afterEach(() => db.close())

describe('MemoriesRepository keystone reads', () => {
  it('findKeystones: hot keystones about the subjects, in creation order, as booleans', async () => {
    seed([
      { summary: 'late', keystone: 1, reinforcedImportance: 0.99, createdAt: '2026-03-01T00:00:00.000Z' },
      { summary: 'early', keystone: 1, reinforcedImportance: 0.1, createdAt: '2026-02-01T00:00:00.000Z' },
      { summary: 'not a keystone', keystone: 0 },
      { summary: 'cold keystone', keystone: 1, tier: 'cold' },
      { summary: 'about greg', keystone: 1, aboutCharacterId: GREG },
    ])
    const repo = new MemoriesRepository()
    const rows = await repo.findKeystones(HOLDER, [ABIGAIL])
    expect(rows.map(r => r.summary)).toEqual(['early', 'late'])
    expect(rows.every(r => r.keystone === true)).toBe(true)
    expect((await repo.findKeystones(HOLDER, [ABIGAIL, GREG])).map(r => r.summary)).toEqual(['about greg', 'early', 'late'])
    expect(await repo.findKeystones(HOLDER, [])).toEqual([])
  })

  it("findKeystones('self'): about the holder or about no one", async () => {
    seed([
      { summary: 'about me', keystone: 1, aboutCharacterId: HOLDER },
      { summary: 'about no one', keystone: 1, aboutCharacterId: null },
      { summary: 'about abigail', keystone: 1 },
    ])
    const rows = await new MemoriesRepository().findKeystones(HOLDER, 'self')
    expect(rows.map(r => r.summary)).toEqual(['about me', 'about no one'])
  })

  it('countKeystones: one subject, hot only, less the excluded row', async () => {
    seed([{ keystone: 1 }, { keystone: 1 }, { keystone: 1, tier: 'cold' }, { keystone: 0 }, { keystone: 1, aboutCharacterId: null }])
    const repo = new MemoriesRepository()
    expect(await repo.countKeystones(HOLDER, ABIGAIL)).toBe(2)
    expect(await repo.countKeystones(HOLDER, ABIGAIL, '00000000-0000-4000-9000-000000000001')).toBe(1)
    expect(await repo.countKeystones(HOLDER, null)).toBe(1)
    expect(await repo.countKeystones(HOLDER, HOLDER)).toBe(1)
  })

  it('other raw reads hydrate the integer as a boolean instead of dropping the row', async () => {
    seed([{ keystone: 0, reinforcedImportance: 0.9 }, { keystone: 1, reinforcedImportance: 0.8 }])
    const rows = await new MemoriesRepository().findMostImportant(HOLDER, 10)
    expect(rows.map(r => r.keystone)).toEqual([false, true])
  })
})
