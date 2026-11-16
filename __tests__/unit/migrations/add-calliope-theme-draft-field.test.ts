/**
 * add-calliope-theme-draft-field-v1 — adds `chats.themeDraftId`,
 * idempotently, touching no rows.
 */

const columns = new Set<string>()
const ddl = new Map<string, string>()

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chats',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  addColumnIfMissing: (_table: string, column: string, def: string) => {
    if (columns.has(column)) return false
    columns.add(column)
    ddl.set(column, def)
    return true
  },
}))

import { addCalliopeThemeDraftFieldMigration as migration } from '../../../migrations/scripts/add-calliope-theme-draft-field'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  columns.add('id')
  columns.add('consoleMode')
  columns.add('consoleContext')
})

describe('add-calliope-theme-draft-field-v1', () => {
  it('is registered, labelled and follows the Writing Assistant columns', () => {
    expect(migration.id).toBe('add-calliope-theme-draft-field-v1')
    expect(migration.dependsOn).toEqual(['add-console-writing-assistant-fields-v1'])
    expect(migrations).toContain(migration)
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('adds the nullable column, then has nothing left to do', async () => {
    expect(await migration.shouldRun()).toBe(true)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 1 })
    expect(ddl.get('themeDraftId')).toBe('TEXT DEFAULT NULL')
    expect(await migration.shouldRun()).toBe(false)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
