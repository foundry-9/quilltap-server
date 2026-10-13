/**
 * @jest-environment node
 *
 * add-memory-extraction-cursors-v1 — creates memory_extraction_cursors, moves
 * the two fold-pass watermark columns off chats into it (other-fold,
 * episode-fold), then drops the columns. A second run finds nothing to do.
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

import { addMemoryExtractionCursorsMigration } from '../../../../../migrations/scripts/add-memory-extraction-cursors-v1'

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  testDb.exec(`
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      title TEXT,
      otherExtractionWatermarkMessageId TEXT DEFAULT NULL,
      episodeExtractionWatermarkMessageId TEXT DEFAULT NULL
    );
    INSERT INTO chats (id, otherExtractionWatermarkMessageId, episodeExtractionWatermarkMessageId) VALUES
      ('both', 'm-other', 'm-episode'),
      ('other-only', 'm-o2', NULL),
      ('episode-only', NULL, 'm-e3'),
      ('blank', '', NULL),
      ('never', NULL, NULL);
  `)
})

afterEach(() => {
  testDb.close()
})

function cursors(): Array<{ id: string; chatId: string; pass: string; messageId: string }> {
  return testDb
    .prepare('SELECT id, chatId, pass, messageId FROM memory_extraction_cursors ORDER BY id')
    .all() as Array<{ id: string; chatId: string; pass: string; messageId: string }>
}

function chatColumns(): string[] {
  return (testDb.prepare('PRAGMA table_info("chats")').all() as Array<{ name: string }>).map(c => c.name)
}

describe('add-memory-extraction-cursors-v1', () => {
  it('is dated 4.10.0 and follows both watermark migrations', () => {
    expect(addMemoryExtractionCursorsMigration.introducedInVersion).toBe('4.10.0')
    expect(addMemoryExtractionCursorsMigration.dependsOn).toEqual(
      expect.arrayContaining(['add-memory-tiers-v1', 'add-episode-extraction-watermark-v1']),
    )
  })

  it('carries every watermark into a cursor and drops both columns', async () => {
    expect(await addMemoryExtractionCursorsMigration.shouldRun()).toBe(true)
    const result = await addMemoryExtractionCursorsMigration.run()
    expect(result.success).toBe(true)
    expect(result.itemsAffected).toBe(4)
    expect(cursors()).toEqual([
      { id: 'both:episode-fold', chatId: 'both', pass: 'episode-fold', messageId: 'm-episode' },
      { id: 'both:other-fold', chatId: 'both', pass: 'other-fold', messageId: 'm-other' },
      { id: 'episode-only:episode-fold', chatId: 'episode-only', pass: 'episode-fold', messageId: 'm-e3' },
      { id: 'other-only:other-fold', chatId: 'other-only', pass: 'other-fold', messageId: 'm-o2' },
    ])
    expect(chatColumns()).not.toContain('otherExtractionWatermarkMessageId')
    expect(chatColumns()).not.toContain('episodeExtractionWatermarkMessageId')
  })

  it('finds nothing to do the second time', async () => {
    await addMemoryExtractionCursorsMigration.run()
    expect(await addMemoryExtractionCursorsMigration.shouldRun()).toBe(false)
  })

  it('keeps one cursor per chat and pass, and deletes a chat\'s cursors with the chat', async () => {
    await addMemoryExtractionCursorsMigration.run()
    expect(() =>
      testDb
        .prepare(`INSERT INTO memory_extraction_cursors (id, chatId, pass, messageId, createdAt, updatedAt) VALUES ('x', 'both', 'other-fold', 'm9', 'now', 'now')`)
        .run(),
    ).toThrow(/UNIQUE/)
    testDb.prepare(`DELETE FROM chats WHERE id = 'both'`).run()
    expect(cursors().map(c => c.chatId)).not.toContain('both')
  })

  it('creates the table on an instance whose chats never had the columns', async () => {
    testDb.exec('DROP TABLE chats; CREATE TABLE chats (id TEXT PRIMARY KEY);')
    expect(await addMemoryExtractionCursorsMigration.shouldRun()).toBe(true)
    const result = await addMemoryExtractionCursorsMigration.run()
    expect(result.success).toBe(true)
    expect(cursors()).toEqual([])
    expect(await addMemoryExtractionCursorsMigration.shouldRun()).toBe(false)
  })
})
