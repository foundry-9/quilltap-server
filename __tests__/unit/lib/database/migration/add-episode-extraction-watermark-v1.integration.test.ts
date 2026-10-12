/**
 * @jest-environment node
 *
 * add-episode-extraction-watermark-v1 — adds chats.episodeExtractionWatermarkMessageId
 * (bug 207) and backfills it from the last summaryAnchorMessageIds entry, so a
 * chat that has already folded does not re-extract its history on the next
 * hard rebuild. Chats with no anchors stay NULL; a second run finds nothing.
 *
 * Uses a real in-memory SQLite DB.
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
jest.mock('../../../../../migrations/lib/progress', () => ({ reportProgress: jest.fn() }))

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

import {
  addEpisodeExtractionWatermarkMigration,
  lastSummaryAnchor,
} from '../../../../../migrations/scripts/add-episode-extraction-watermark-v1'
import { reportProgress } from '../../../../../migrations/lib/progress'

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT, summaryAnchorMessageIds TEXT DEFAULT '[]');
    INSERT INTO chats (id, summaryAnchorMessageIds) VALUES
      ('folded', '["u1","a1","u2","a2"]'),
      ('never', '[]'),
      ('null-anchors', NULL),
      ('garbled', 'not json');
  `)
})

afterEach(() => {
  testDb.close()
})

describe('add-episode-extraction-watermark-v1', () => {
  it('is dated 4.10.0 and follows the memory tiers migration', () => {
    expect(addEpisodeExtractionWatermarkMigration.id).toBe('add-episode-extraction-watermark-v1')
    expect(addEpisodeExtractionWatermarkMigration.introducedInVersion).toBe('4.10.0')
    expect(addEpisodeExtractionWatermarkMigration.dependsOn).toEqual(['add-memory-tiers-v1'])
  })

  it('adds the column and backfills it from the last summary anchor', async () => {
    expect(await addEpisodeExtractionWatermarkMigration.shouldRun()).toBe(true)
    const result = await addEpisodeExtractionWatermarkMigration.run()
    expect(result.success).toBe(true)

    const rows = testDb
      .prepare('SELECT id, episodeExtractionWatermarkMessageId AS w FROM chats ORDER BY id')
      .all()
    expect(rows).toEqual([
      { id: 'folded', w: 'a2' },
      { id: 'garbled', w: null },
      { id: 'never', w: null },
      { id: 'null-anchors', w: null },
    ])
    expect(reportProgress).toHaveBeenCalled()
  })

  it('finds nothing to do on a second run', async () => {
    await addEpisodeExtractionWatermarkMigration.run()
    expect(await addEpisodeExtractionWatermarkMigration.shouldRun()).toBe(false)
  })
})

describe('lastSummaryAnchor', () => {
  it.each([
    ['["a","b"]', 'b'],
    ['[]', null],
    ['', null],
    [null, null],
    ['{"a":1}', null],
    ['[1,2]', null],
  ])('%p → %p', (raw, expected) => {
    expect(lastSummaryAnchor(raw)).toBe(expected)
  })
})
