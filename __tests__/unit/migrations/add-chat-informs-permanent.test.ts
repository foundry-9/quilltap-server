/**
 * add-chat-informs-permanent-v1 — adds `permanent` to chat_informs,
 * idempotently, touching no rows, and only once the table exists.
 *
 * `database-utils` is replaced by a column set standing in for `chat_informs`,
 * so the test exercises exactly the helpers the migration imports.
 */

const columns = new Set<string>()
const ddl = new Map<string, string>()
let tablePresent = true

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => tablePresent && name === 'chat_informs',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  addColumnIfMissing: (_table: string, column: string, def: string) => {
    if (columns.has(column)) return false
    columns.add(column)
    ddl.set(column, def)
    return true
  },
}))

import { addChatInformsPermanentMigration } from '../../../migrations/scripts/add-chat-informs-permanent'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  tablePresent = true
  columns.add('id')
  columns.add('consumedAt')
})

describe('add-chat-informs-permanent-v1', () => {
  it('depends on the chat_informs table and is dated 4.10.0', () => {
    expect(addChatInformsPermanentMigration.id).toBe('add-chat-informs-permanent-v1')
    expect(addChatInformsPermanentMigration.introducedInVersion).toBe('4.10.0')
    expect(addChatInformsPermanentMigration.dependsOn).toEqual(['add-chat-informs-table-v1'])
  })

  it('adds the column defaulting every existing row to a one-shot inform', async () => {
    expect(await addChatInformsPermanentMigration.shouldRun()).toBe(true)
    const result = await addChatInformsPermanentMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 1 })
    expect(ddl.get('permanent')).toBe('INTEGER NOT NULL DEFAULT 0')
    expect(await addChatInformsPermanentMigration.shouldRun()).toBe(false)
  })

  it('does not run before the table exists', async () => {
    tablePresent = false
    expect(await addChatInformsPermanentMigration.shouldRun()).toBe(false)
  })

  it('is idempotent: a second run adds nothing', async () => {
    await addChatInformsPermanentMigration.run()
    const again = await addChatInformsPermanentMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
