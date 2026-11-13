/**
 * add-console-writing-assistant-fields-v1 — adds `chats.consoleMode` and
 * `chats.consoleContext`, idempotently, touching no rows.
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

import { addConsoleWritingAssistantFieldsMigration as migration } from '../../../migrations/scripts/add-console-writing-assistant-fields'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  columns.add('id')
  columns.add('consoleConnectionProfileId')
})

describe('add-console-writing-assistant-fields-v1', () => {
  it('is registered, labelled and follows the Console profile column', () => {
    expect(migration.id).toBe('add-console-writing-assistant-fields-v1')
    expect(migration.dependsOn).toEqual(['add-console-connection-profile-field-v1'])
    expect(migrations).toContain(migration)
    expect(prettify(migration.id)).not.toBe(humanize(migration.id))
  })

  it('adds both nullable columns, then has nothing left to do', async () => {
    expect(await migration.shouldRun()).toBe(true)
    const result = await migration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 2 })
    expect(ddl.get('consoleMode')).toBe('TEXT DEFAULT NULL')
    expect(ddl.get('consoleContext')).toBe('TEXT DEFAULT NULL')
    expect(await migration.shouldRun()).toBe(false)
  })

  it('finishes a half-applied run and is idempotent', async () => {
    columns.add('consoleMode')
    expect(await migration.shouldRun()).toBe(true)
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 1 })
    expect(await migration.run()).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
