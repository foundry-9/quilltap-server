/**
 * @jest-environment node
 *
 * move-memory-maintenance-settings-v1 (memory refactor Phase A, decision 9):
 * the active user's `chat_settings.autoHousekeepingSettings` moves into
 * `instance_settings.memoryMaintenance` without the retired merge knobs, caps
 * are clamped to the schema's bounds, an existing key is never overwritten,
 * and the dead columns and instance key are dropped. Real in-memory SQLite.
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
  }
})

import {
  moveMemoryMaintenanceSettingsMigration as migration,
  legacyHousekeepingToMaintenance,
} from '../../../../../migrations/scripts/move-memory-maintenance-settings-v1'
import { prettify, humanize } from '@/lib/startup/prettify'
import { MemoryMaintenanceSettingsSchema } from '@/lib/schemas/settings.types'

const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

function columns(): string[] {
  return (testDb.prepare('PRAGMA table_info("chat_settings")').all() as Array<{ name: string }>).map(c => c.name)
}

function instanceValue(key: string): string | undefined {
  return (testDb.prepare('SELECT value FROM instance_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

function seed(userId: string, housekeeping: unknown, updatedAt = '2026-10-01T00:00:00.000Z') {
  testDb
    .prepare('INSERT INTO chat_settings (id, userId, autoHousekeepingSettings, updatedAt) VALUES (?, ?, ?, ?)')
    .run(`row-${userId}`, userId, typeof housekeeping === 'string' ? housekeeping : JSON.stringify(housekeeping), updatedAt)
}

beforeEach(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE instance_settings ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);
    CREATE TABLE chat_settings (
      id TEXT PRIMARY KEY, userId TEXT, timezone TEXT,
      autoHousekeepingSettings TEXT DEFAULT '{}',
      memoryExtractionLimits TEXT DEFAULT '{}',
      memoryExtractionConcurrency INTEGER DEFAULT 1,
      updatedAt TEXT
    );
  `)
})

afterEach(() => {
  testDb.close()
})

describe('move-memory-maintenance-settings-v1', () => {
  it('has a loading-screen label', () => {
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('copies the single user\'s settings without the merge knobs, then drops the dead columns and key', async () => {
    seed(SINGLE_USER_ID, {
      enabled: true,
      perCharacterCap: 10000,
      perCharacterCapOverrides: { 'char-a': 2500 },
      autoMergeSimilarThreshold: 0.9,
      mergeSimilar: true,
    })
    seed('someone-else', { enabled: false, perCharacterCap: 300 }, '2026-10-11T00:00:00.000Z')
    testDb.prepare('INSERT INTO instance_settings (key, value) VALUES (?, ?)').run('memoryExtractionConcurrency', '3')

    expect(await migration.shouldRun()).toBe(true)
    const result = await migration.run()
    expect(result.success).toBe(true)

    const stored = JSON.parse(instanceValue('memoryMaintenance')!)
    expect(stored).toEqual({ enabled: true, perCharacterCap: 10000, perCharacterCapOverrides: { 'char-a': 2500 } })
    // The stored value is one the schema accepts as is.
    expect(MemoryMaintenanceSettingsSchema.parse(stored)).toEqual(stored)
    expect(instanceValue('memoryExtractionConcurrency')).toBeUndefined()
    expect(columns()).toEqual(['id', 'userId', 'timezone', 'updatedAt'])
    expect(await migration.shouldRun()).toBe(false)
  })

  it('never overwrites an existing memoryMaintenance key', async () => {
    seed(SINGLE_USER_ID, { enabled: true, perCharacterCap: 5000 })
    testDb.prepare('INSERT INTO instance_settings (key, value) VALUES (?, ?)').run(
      'memoryMaintenance',
      JSON.stringify({ enabled: false, perCharacterCap: 2000, perCharacterCapOverrides: {} }),
    )
    await migration.run()
    expect(JSON.parse(instanceValue('memoryMaintenance')!).perCharacterCap).toBe(2000)
    expect(columns()).not.toContain('autoHousekeepingSettings')
  })

  it('falls back to the most recently updated row when the single user has none, and tolerates junk', async () => {
    seed('a', { enabled: true, perCharacterCap: 700 }, '2026-01-01T00:00:00.000Z')
    seed('b', 'not json', '2026-09-01T00:00:00.000Z')
    await migration.run()
    // The newest row is junk: nothing to copy, but the columns still go.
    expect(instanceValue('memoryMaintenance')).toBeUndefined()
    expect(columns()).not.toContain('memoryExtractionLimits')
  })

  it('is a no-op once the columns are gone', async () => {
    testDb.exec('DROP TABLE chat_settings; CREATE TABLE chat_settings (id TEXT PRIMARY KEY, userId TEXT)')
    expect(await migration.shouldRun()).toBe(false)
  })
})

describe('legacyHousekeepingToMaintenance', () => {
  it('clamps caps to 100–100,000 and drops unusable overrides', () => {
    expect(
      legacyHousekeepingToMaintenance({
        enabled: 'yes',
        perCharacterCap: 50,
        perCharacterCapOverrides: { a: 500000, b: 'x', c: 1234.7 },
        mergeSimilar: true,
      }),
    ).toEqual({ enabled: false, perCharacterCap: 100, perCharacterCapOverrides: { a: 100000, c: 1234 } })
    expect(legacyHousekeepingToMaintenance('{"enabled":true}')).toEqual({
      enabled: true,
      perCharacterCap: 2000,
      perCharacterCapOverrides: {},
    })
    expect(legacyHousekeepingToMaintenance(null)).toBeNull()
    expect(legacyHousekeepingToMaintenance('[1]')).toBeNull()
  })
})

describe('withMemoryMaintenanceFromLegacy — restoring a pre-Phase-A backup', () => {
  const { withMemoryMaintenanceFromLegacy } = require('@/lib/memory/settings-legacy') as typeof import('@/lib/memory/settings-legacy')

  it('derives memoryMaintenance from the backup\'s chat settings and drops the dead key', () => {
    const rows = withMemoryMaintenanceFromLegacy(
      [{ key: 'memoryRecall', value: '{}' }, { key: 'memoryExtractionConcurrency', value: '2' }],
      [{ userId: SINGLE_USER_ID, autoHousekeepingSettings: { enabled: true, perCharacterCap: 3000, mergeSimilar: true } }],
    )
    expect(rows).toEqual([
      { key: 'memoryRecall', value: '{}' },
      { key: 'memoryMaintenance', value: JSON.stringify({ enabled: true, perCharacterCap: 3000, perCharacterCapOverrides: {} }) },
    ])
  })

  it('keeps a backup\'s own memoryMaintenance key and adds nothing without a legacy value', () => {
    const own = [{ key: 'memoryMaintenance', value: '{"enabled":false}' }]
    expect(withMemoryMaintenanceFromLegacy(own, [{ autoHousekeepingSettings: { enabled: true } }])).toEqual(own)
    expect(withMemoryMaintenanceFromLegacy([], [{ userId: 'x' }])).toEqual([])
  })
})
