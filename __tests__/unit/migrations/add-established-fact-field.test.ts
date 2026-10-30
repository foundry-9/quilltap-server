/**
 * add-established-fact-field-v1 — adds `chat_messages.isEstablishedFact`,
 * idempotently, touching no rows.
 */

const columns = new Set<string>()
const ddl = new Map<string, string>()

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chat_messages',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  addColumnIfMissing: (_table: string, column: string, def: string) => {
    if (columns.has(column)) return false
    columns.add(column)
    ddl.set(column, def)
    return true
  },
}))

import { addEstablishedFactFieldMigration } from '../../../migrations/scripts/add-established-fact-field-v1'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  columns.add('id')
  columns.add('isSilentMessage')
})

describe('add-established-fact-field-v1', () => {
  it('is registered and labelled', () => {
    expect(addEstablishedFactFieldMigration.id).toBe('add-established-fact-field-v1')
    expect(migrations).toContain(addEstablishedFactFieldMigration)
    expect(prettify('add-established-fact-field-v1')).not.toBe(humanize('add-established-fact-field-v1'))
  })

  it('adds the nullable INTEGER column, then has nothing left to do', async () => {
    expect(await addEstablishedFactFieldMigration.shouldRun()).toBe(true)
    const result = await addEstablishedFactFieldMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 1 })
    expect(ddl.get('isEstablishedFact')).toBe('INTEGER DEFAULT NULL')
    expect(await addEstablishedFactFieldMigration.shouldRun()).toBe(false)
  })

  it('is idempotent: a second run adds nothing', async () => {
    await addEstablishedFactFieldMigration.run()
    const again = await addEstablishedFactFieldMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
