/** @jest-environment node */
/**
 * add-dynamic-backgrounds-settings-field-v1 — adds `chat_settings.dynamicBackgrounds` against a real in-memory SQLite database.
 */

 
const Database = require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))

 
let db: any

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
  sqliteColumnExists: (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column),
  addColumnIfMissing: (table: string, column: string, def: string) => {
    const exists = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column)
    if (exists) return false
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
    return true
  },
}))

import { addDynamicBackgroundsSettingsFieldMigration as migration } from '../../../migrations/scripts/add-dynamic-backgrounds-settings-field-v1'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

describe('add-dynamic-backgrounds-settings-field-v1', () => {
  it('is registered and has a pretty label', () => {
    expect(migration.id).toBe('add-dynamic-backgrounds-settings-field-v1')
    expect(migration.dependsOn).toEqual(['sqlite-initial-schema-v1'])
    expect(migrations).toContain(migration)
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('does not run when the table is absent', async () => {
    expect(await migration.shouldRun()).toBe(false)
  })

  it('adds the column with the JSON default, preserving existing rows', async () => {
    db.exec("CREATE TABLE chat_settings (id TEXT PRIMARY KEY)")
    db.prepare('INSERT INTO chat_settings (id) VALUES (?)').run('a')
    expect(await migration.shouldRun()).toBe(true)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 1 })

    const row = db.prepare('SELECT dynamicBackgrounds FROM chat_settings WHERE id = ?').get('a')
    expect(JSON.parse(row.dynamicBackgrounds)).toEqual({
      enabled: false,
      allowUncensored: false,
      refreshMinutes: 3,
    })
    db.prepare('INSERT INTO chat_settings (id) VALUES (?)').run('b')
    const fresh = db.prepare('SELECT dynamicBackgrounds FROM chat_settings WHERE id = ?').get('b')
    expect(JSON.parse(fresh.dynamicBackgrounds).refreshMinutes).toBe(3)
  })

  it('is idempotent', async () => {
    db.exec('CREATE TABLE chat_settings (id TEXT PRIMARY KEY)')
    await migration.run()
    expect(await migration.shouldRun()).toBe(false)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 0 })
  })

  it('does not run when the column already exists', async () => {
    db.exec('CREATE TABLE chat_settings (id TEXT PRIMARY KEY, dynamicBackgrounds TEXT)')
    expect(await migration.shouldRun()).toBe(false)
  })
})
