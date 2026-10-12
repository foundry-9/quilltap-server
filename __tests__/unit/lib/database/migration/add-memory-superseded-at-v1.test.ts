/**
 * @jest-environment node
 *
 * add-memory-superseded-at-v1 (bug 225) — adds `memories.supersededAt`, the
 * cold-retention clock, and backfills it from `updatedAt` for rows that
 * already carry a `supersededById`. Rows that are not superseded stay null,
 * and a second run finds nothing to do.
 */

import path from 'path'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
type DatabaseInstance = ReturnType<typeof Database>

let testDb: DatabaseInstance = null as unknown as DatabaseInstance

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../../../migrations/lib/database-utils', () => {
  const columnExists = (table: string, column: string) =>
    (testDb.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(
      (c) => c.name === column,
    )
  return {
    isSQLiteBackend: () => true,
    getSQLiteDatabase: () => testDb,
    sqliteTableExists: (name: string) =>
      !!testDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
    sqliteColumnExists: columnExists,
    addColumnIfMissing: (table: string, column: string, def: string) => {
      if (columnExists(table, column)) return false
      testDb.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${def}`)
      return true
    },
  }
})

import { addMemorySupersededAtMigration } from '../../../../../migrations/scripts/add-memory-superseded-at-v1'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, characterId TEXT, tier TEXT DEFAULT 'hot',
      supersededById TEXT DEFAULT NULL, updatedAt TEXT
    );
    INSERT INTO memories (id, characterId, tier, supersededById, updatedAt) VALUES
      ('member', 'c1', 'cold', 'digest', '2026-02-01T00:00:00.000Z'),
      ('demoted', 'c1', 'cold', NULL, '2026-02-02T00:00:00.000Z'),
      ('digest', 'c1', 'hot', NULL, '2026-02-03T00:00:00.000Z');
  `)
})

afterEach(() => {
  testDb.close()
})

describe('add-memory-superseded-at-v1', () => {
  it('follows the tiers migration and has a loading-screen label', () => {
    expect(addMemorySupersededAtMigration.id).toBe('add-memory-superseded-at-v1')
    expect(addMemorySupersededAtMigration.dependsOn).toEqual(['add-memory-tiers-v1'])
    expect(prettify('add-memory-superseded-at-v1')).not.toBe(humanize('add-memory-superseded-at-v1'))
  })

  it('adds the column and backfills superseded rows from updatedAt', async () => {
    expect(await addMemorySupersededAtMigration.shouldRun()).toBe(true)
    const result = await addMemorySupersededAtMigration.run()
    expect(result.success).toBe(true)

    const rows = testDb.prepare('SELECT id, supersededAt FROM memories ORDER BY id').all()
    expect(rows).toEqual([
      { id: 'demoted', supersededAt: null },
      { id: 'digest', supersededAt: null },
      { id: 'member', supersededAt: '2026-02-01T00:00:00.000Z' },
    ])
  })

  it('is idempotent', async () => {
    await addMemorySupersededAtMigration.run()
    expect(await addMemorySupersededAtMigration.shouldRun()).toBe(false)
  })

  it('heals a superseded row that slipped in without a stamp', async () => {
    await addMemorySupersededAtMigration.run()
    testDb.exec(`INSERT INTO memories (id, characterId, tier, supersededById, updatedAt)
      VALUES ('late', 'c1', 'cold', 'digest', '2026-03-01T00:00:00.000Z')`)
    expect(await addMemorySupersededAtMigration.shouldRun()).toBe(true)
    await addMemorySupersededAtMigration.run()
    expect(testDb.prepare(`SELECT supersededAt FROM memories WHERE id = 'late'`).get())
      .toEqual({ supersededAt: '2026-03-01T00:00:00.000Z' })
  })
})
