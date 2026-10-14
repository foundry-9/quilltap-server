/**
 * @jest-environment node
 *
 * add-memory-tiers-v1 — adds the hot/cold tier and digest bookkeeping columns
 * to memories (plus the (characterId, tier) index) and the fold-grain OTHER
 * watermark to chats. Existing rows must come out hot with an empty
 * `consolidatedFrom`, and a second run must find nothing to do.
 *
 * Uses a real in-memory SQLite DB so the column defaults and the NULL-heal
 * UPDATE are exercised as SQLite actually applies them.
 */

import path from 'path'

function loadDriver() {
  try {
    return require(path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers',
    ))
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers')
    } catch {
      // Root package.json aliases the driver as better-sqlite3; require by
      // absolute path so the suite-wide better-sqlite3 mock doesn't intercept.
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'))
    }
  }
}
const Database = loadDriver()
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

import { addMemoryTiersMigration } from '../../../../../migrations/scripts/add-memory-tiers-v1'

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE memories (id TEXT PRIMARY KEY, characterId TEXT, content TEXT);
    CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO memories (id, characterId, content) VALUES ('m1', 'c1', 'one'), ('m2', 'c1', 'two');
  `)
})

afterEach(() => {
  testDb.close()
})

describe('add-memory-tiers-v1', () => {
  it('is dated 4.10.0 and follows the episodic spine', () => {
    expect(addMemoryTiersMigration.id).toBe('add-memory-tiers-v1')
    expect(addMemoryTiersMigration.introducedInVersion).toBe('4.10.0')
    expect(addMemoryTiersMigration.dependsOn).toEqual(['add-episodic-memory-fields-v1'])
  })

  it('adds the columns and index, stamping existing rows hot', async () => {
    expect(await addMemoryTiersMigration.shouldRun()).toBe(true)
    const result = await addMemoryTiersMigration.run()
    expect(result.success).toBe(true)

    const rows = testDb
      .prepare('SELECT id, tier, supersededById, consolidatedFrom, consolidatedAt FROM memories ORDER BY id')
      .all()
    expect(rows).toEqual([
      { id: 'm1', tier: 'hot', supersededById: null, consolidatedFrom: '[]', consolidatedAt: null },
      { id: 'm2', tier: 'hot', supersededById: null, consolidatedFrom: '[]', consolidatedAt: null },
    ])

    const index = testDb
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memories_character_tier'`)
      .get()
    expect(index).toBeTruthy()

    const chatCols = (testDb.prepare('PRAGMA table_info("chats")').all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(chatCols).toContain('otherExtractionWatermarkMessageId')

    expect(await addMemoryTiersMigration.shouldRun()).toBe(false)
  })

  it('heals NULL tiers on a table whose columns came without defaults', async () => {
    testDb.exec(`
      ALTER TABLE memories ADD COLUMN tier TEXT;
      ALTER TABLE memories ADD COLUMN supersededById TEXT;
      ALTER TABLE memories ADD COLUMN consolidatedFrom TEXT;
      ALTER TABLE memories ADD COLUMN consolidatedAt TEXT;
      ALTER TABLE chats ADD COLUMN otherExtractionWatermarkMessageId TEXT;
      CREATE INDEX idx_memories_character_tier ON memories (characterId, tier);
      UPDATE memories SET tier = 'cold', consolidatedFrom = '[]' WHERE id = 'm2';
    `)
    expect(await addMemoryTiersMigration.shouldRun()).toBe(true)
    const result = await addMemoryTiersMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 1 })

    const rows = testDb.prepare('SELECT id, tier, consolidatedFrom FROM memories ORDER BY id').all()
    expect(rows).toEqual([
      { id: 'm1', tier: 'hot', consolidatedFrom: '[]' },
      { id: 'm2', tier: 'cold', consolidatedFrom: '[]' },
    ])
    expect(await addMemoryTiersMigration.shouldRun()).toBe(false)
  })

  it('is idempotent', async () => {
    await addMemoryTiersMigration.run()
    const again = await addMemoryTiersMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
