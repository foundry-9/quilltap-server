/** @jest-environment node */
/**
 * add-file-generation-moderation-column-v1 — adds `files.generationModeration` against a real in-memory SQLite database.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

import { addFileGenerationModerationColumnMigration as migration } from '../../../migrations/scripts/add-file-generation-moderation-column-v1'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

describe('add-file-generation-moderation-column-v1', () => {
  it('is registered and has a pretty label', () => {
    expect(migration.id).toBe('add-file-generation-moderation-column-v1')
    expect(migration.dependsOn).toEqual(['sqlite-initial-schema-v1'])
    expect(migrations).toContain(migration)
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('does not run when the table is absent', async () => {
    expect(await migration.shouldRun()).toBe(false)
  })

  it('adds a nullable column and leaves existing rows null', async () => {
    db.exec('CREATE TABLE files (id TEXT PRIMARY KEY)')
    db.prepare('INSERT INTO files (id) VALUES (?)').run('f1')
    expect(await migration.shouldRun()).toBe(true)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 1 })

    const col = (db.prepare('PRAGMA table_info(files)').all() as { name: string; type: string; notnull: number }[])
      .find(c => c.name === 'generationModeration')
    expect(col).toMatchObject({ type: 'TEXT', notnull: 0 })
    expect(db.prepare('SELECT generationModeration FROM files WHERE id = ?').get('f1').generationModeration).toBeNull()
  })

  it('is idempotent', async () => {
    db.exec('CREATE TABLE files (id TEXT PRIMARY KEY)')
    await migration.run()
    expect(await migration.shouldRun()).toBe(false)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 0 })
  })

  it('reports failure rather than throwing when the table is missing', async () => {
    expect(await migration.run()).toMatchObject({ success: false, itemsAffected: 0 })
  })
})
