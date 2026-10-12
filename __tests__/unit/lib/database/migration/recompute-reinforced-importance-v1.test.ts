/**
 * @jest-environment node
 *
 * recompute-reinforced-importance-v1 (bug 216, locked decision 6) rewrites
 * every memory's reinforcedImportance with min(1, i + log2(n) × 0.05), so a
 * count-1 row equals its importance. Real in-memory SQLite.
 */

import path from 'path'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
type DatabaseInstance = ReturnType<typeof Database>

let testDb: DatabaseInstance = null as unknown as DatabaseInstance

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
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
  }
})

import { recomputeReinforcedImportanceMigration as migration } from '../../../../../migrations/scripts/recompute-reinforced-importance-v1'
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance'
import { reportProgress } from '../../../../../migrations/lib/progress'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      importance REAL,
      reinforcementCount INTEGER,
      reinforcedImportance REAL
    );
  `)
})

afterEach(() => {
  testDb.close()
})

describe('recompute-reinforced-importance-v1', () => {
  it('has a loading-screen label', () => {
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('does not run without the memories table', async () => {
    testDb.exec('DROP TABLE memories')
    expect(await migration.shouldRun()).toBe(false)
  })

  it('rewrites every row to min(1, importance + log2(count) * 0.05)', async () => {
    const insert = testDb.prepare(
      'INSERT INTO memories (id, importance, reinforcementCount, reinforcedImportance) VALUES (?, ?, ?, ?)',
    )
    // fresh row: already right under the new formula
    insert.run('fresh', 0.6, 1, 0.6)
    // count-1 digest stored by the old formula at +0.05
    insert.run('old-digest', 0.6, 1, 0.65)
    // reinforced row stored by the old formula
    insert.run('reinforced', 0.5, 3, 0.5 + Math.log2(4) * 0.05)
    // capped row
    insert.run('capped', 0.95, 64, 1)
    // legacy nulls
    insert.run('nulls', null, null, null)
    // 600 more rows to cross a batch boundary
    for (let i = 0; i < 600; i++) insert.run(`bulk-${i}`, 0.4, 2, 0.4 + Math.log2(3) * 0.05)

    expect(await migration.shouldRun()).toBe(true)
    const result = await migration.run()
    expect(result.success).toBe(true)
    // everything but 'fresh' and 'capped' changed
    expect(result.itemsAffected).toBe(3 + 600)

    const rows = testDb
      .prepare('SELECT id, importance, reinforcementCount, reinforcedImportance FROM memories')
      .all() as Array<{ id: string; importance: number | null; reinforcementCount: number | null; reinforcedImportance: number }>
    for (const row of rows) {
      const expected = calculateReinforcedImportance(row.importance ?? 0.5, row.reinforcementCount ?? 1)
      expect(row.reinforcedImportance).toBeCloseTo(expected, 10)
    }
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.reinforcedImportance]))
    expect(byId['old-digest']).toBeCloseTo(0.6, 10)
    expect(byId['reinforced']).toBeCloseTo(0.5 + Math.log2(3) * 0.05, 10)
    expect(byId['nulls']).toBeCloseTo(0.5, 10)
    expect(reportProgress).toHaveBeenLastCalledWith(605, 605, 'memories')

    // A second pass finds nothing left to rewrite.
    const again = await migration.run()
    expect(again.itemsAffected).toBe(0)
  })
})
