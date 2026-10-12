/**
 * @jest-environment node
 *
 * rezone-legacy-memory-occurred-at-v1 (review of PR 90, finding 1): before
 * bug 212, a resolved `when` phrase was stamped at UTC midnight of its day.
 * The anchor line and the day windows now read occurredAt on the instance's
 * memory calendar, where such a value is the day before anywhere west of
 * Greenwich. The migration re-stamps each legacy UTC-midnight value at local
 * midnight of the same calendar date. Real in-memory SQLite.
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

import { rezoneLegacyMemoryOccurredAtMigration as migration } from '../../../../../migrations/scripts/rezone-legacy-memory-occurred-at-v1'
import { reportProgress } from '../../../../../migrations/lib/progress'
import { prettify, humanize } from '@/lib/startup/prettify'
import { buildMemoryAnchorLine } from '@/lib/memory/episodic'

const ORIGINAL_ENV_TZ = process.env.QUILLTAP_TIMEZONE

function occurredAtById(): Record<string, string | null> {
  const rows = testDb.prepare('SELECT id, occurredAt FROM memories').all() as Array<{ id: string; occurredAt: string | null }>
  return Object.fromEntries(rows.map((r) => [r.id, r.occurredAt]))
}

beforeEach(() => {
  process.env.QUILLTAP_TIMEZONE = 'UTC'
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE memories (id TEXT PRIMARY KEY, occurredAt TEXT DEFAULT NULL, createdAt TEXT NOT NULL DEFAULT '2026-08-01T12:00:00.000Z');
    CREATE TABLE chat_settings (id TEXT PRIMARY KEY, userId TEXT, timezone TEXT);
  `)
})

afterEach(() => {
  testDb.close()
})

afterAll(() => {
  if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
  else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
})

describe('rezone-legacy-memory-occurred-at-v1', () => {
  it('has a loading-screen label', () => {
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('does not run without the occurredAt column', async () => {
    testDb.exec('DROP TABLE memories; CREATE TABLE memories (id TEXT PRIMARY KEY)')
    expect(await migration.shouldRun()).toBe(false)
  })

  it('re-stamps legacy UTC midnights at local midnight of the same date (America/Chicago)', async () => {
    testDb.prepare('INSERT INTO chat_settings (id, userId, timezone) VALUES (?, ?, ?)').run('cs-1', 'u-1', 'America/Chicago')
    const insert = testDb.prepare('INSERT INTO memories (id, occurredAt) VALUES (?, ?)')
    insert.run('legacy', '2026-07-14T00:00:00.000Z')
    insert.run('legacy-winter', '2026-01-10T00:00:00.000Z')
    insert.run('turn-stamp', '2026-07-14T17:42:11.123Z')
    insert.run('local-midnight', '2026-07-14T05:00:00.000Z')
    insert.run('none', null)
    insert.run('garbage', 'not a date')
    for (let i = 0; i < 600; i++) insert.run(`bulk-${i}`, '2026-03-01T00:00:00.000Z')

    // Before: the legacy row's anchor line reads the day before in Chicago.
    expect(buildMemoryAnchorLine({ occurredAt: '2026-07-14T00:00:00.000Z' }, 'America/Chicago')).toBe('(when: 2026-07-13)')

    expect(await migration.shouldRun()).toBe(true)
    const result = await migration.run()
    expect(result.success).toBe(true)
    expect(result.itemsAffected).toBe(2 + 600)

    const after = occurredAtById()
    expect(after['legacy']).toBe('2026-07-14T05:00:00.000Z') // CDT, UTC−5
    expect(after['legacy-winter']).toBe('2026-01-10T06:00:00.000Z') // CST, UTC−6
    expect(after['bulk-0']).toBe('2026-03-01T06:00:00.000Z')
    expect(after['turn-stamp']).toBe('2026-07-14T17:42:11.123Z')
    expect(after['local-midnight']).toBe('2026-07-14T05:00:00.000Z')
    expect(after['none']).toBeNull()
    expect(after['garbage']).toBe('not a date')

    // After: the anchor line reads the memory's own day.
    expect(buildMemoryAnchorLine({ occurredAt: after['legacy'] }, 'America/Chicago')).toBe('(when: 2026-07-14)')
    expect(reportProgress).toHaveBeenLastCalledWith(602, 602, 'memories')

    // Idempotent: a second pass finds nothing left at UTC midnight.
    const again = await migration.run()
    expect(again.itemsAffected).toBe(0)
  })

  it('re-stamps east of Greenwich too (Asia/Tokyo: the previous UTC day)', async () => {
    testDb.prepare('INSERT INTO chat_settings (id, userId, timezone) VALUES (?, ?, ?)').run('cs-1', 'u-1', 'Asia/Tokyo')
    testDb.prepare('INSERT INTO memories (id, occurredAt) VALUES (?, ?)').run('legacy', '2026-07-14T00:00:00.000Z')
    await migration.run()
    expect(occurredAtById()['legacy']).toBe('2026-07-13T15:00:00.000Z')
    expect(buildMemoryAnchorLine({ occurredAt: '2026-07-13T15:00:00.000Z' }, 'Asia/Tokyo')).toBe('(when: 2026-07-14)')
  })

  it('re-stamps a legacy row however recently old code wrote it (no createdAt cutoff)', async () => {
    testDb.prepare('INSERT INTO chat_settings (id, userId, timezone) VALUES (?, ?, ?)').run('cs-1', 'u-1', 'America/Chicago')
    const insert = testDb.prepare('INSERT INTO memories (id, occurredAt, createdAt) VALUES (?, ?, ?)')
    // An instance still on pre-fix code writes UTC-midnight rows after the fix landed upstream.
    insert.run('late-legacy', '2026-11-20T00:00:00.000Z', '2026-11-21T15:00:00.000Z')
    insert.run('legacy', '2026-07-14T00:00:00.000Z', '2026-07-15T03:00:00.000Z')
    const result = await migration.run()
    expect(result.itemsAffected).toBe(2)
    const after = occurredAtById()
    expect(after['late-legacy']).toBe('2026-11-20T06:00:00.000Z')
    expect(after['legacy']).toBe('2026-07-14T05:00:00.000Z')
  })

  it('falls back to QUILLTAP_TIMEZONE when no instance timezone is set, skipping invalid settings', async () => {
    process.env.QUILLTAP_TIMEZONE = 'America/New_York'
    testDb.prepare('INSERT INTO chat_settings (id, userId, timezone) VALUES (?, ?, ?)').run('cs-1', 'u-1', 'Not/AZone')
    testDb.prepare('INSERT INTO memories (id, occurredAt) VALUES (?, ?)').run('legacy', '2026-07-14T00:00:00.000Z')
    await migration.run()
    expect(occurredAtById()['legacy']).toBe('2026-07-14T04:00:00.000Z') // EDT, UTC−4
  })

  it('is a no-op on a UTC instance', async () => {
    testDb.prepare('INSERT INTO memories (id, occurredAt) VALUES (?, ?)').run('legacy', '2026-07-14T00:00:00.000Z')
    const result = await migration.run()
    expect(result.success).toBe(true)
    expect(result.itemsAffected).toBe(0)
    expect(occurredAtById()['legacy']).toBe('2026-07-14T00:00:00.000Z')
  })

  it('runs without a chat_settings table (env/system zone)', async () => {
    testDb.exec('DROP TABLE chat_settings')
    process.env.QUILLTAP_TIMEZONE = 'America/Chicago'
    testDb.prepare('INSERT INTO memories (id, occurredAt) VALUES (?, ?)').run('legacy', '2026-07-14T00:00:00.000Z')
    await migration.run()
    expect(occurredAtById()['legacy']).toBe('2026-07-14T05:00:00.000Z')
  })
})
