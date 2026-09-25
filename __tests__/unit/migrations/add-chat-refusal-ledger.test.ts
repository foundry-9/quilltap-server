/**
 * add-chat-refusal-ledger-v1 — adds `moderationRefusalCount` and
 * `lastModerationRefusalAt` to chats, idempotently, touching no rows.
 *
 * `database-utils` is replaced by a column set standing in for `chats`, so the
 * test exercises exactly the helpers the migration imports.
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

import { addChatRefusalLedgerMigration } from '../../../migrations/scripts/add-chat-refusal-ledger'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  columns.add('id')
  columns.add('conciergeOverride')
})

describe('add-chat-refusal-ledger-v1', () => {
  it('depends on the Concierge override column and is dated 4.10.0', () => {
    expect(addChatRefusalLedgerMigration.id).toBe('add-chat-refusal-ledger-v1')
    expect(addChatRefusalLedgerMigration.introducedInVersion).toBe('4.10.0')
    expect(addChatRefusalLedgerMigration.dependsOn).toEqual(['add-chat-concierge-override-v1'])
  })

  it('adds both columns with their defaults', async () => {
    expect(await addChatRefusalLedgerMigration.shouldRun()).toBe(true)
    const result = await addChatRefusalLedgerMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 2 })
    expect(ddl.get('moderationRefusalCount')).toBe('INTEGER NOT NULL DEFAULT 0')
    expect(ddl.get('lastModerationRefusalAt')).toBe('TEXT DEFAULT NULL')
    expect(await addChatRefusalLedgerMigration.shouldRun()).toBe(false)
  })

  it('runs when only one column is present, and adds only the other', async () => {
    columns.add('moderationRefusalCount')
    expect(await addChatRefusalLedgerMigration.shouldRun()).toBe(true)
    const result = await addChatRefusalLedgerMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 1 })
    expect([...ddl.keys()]).toEqual(['lastModerationRefusalAt'])
  })

  it('is idempotent: a second run adds nothing', async () => {
    await addChatRefusalLedgerMigration.run()
    const again = await addChatRefusalLedgerMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
