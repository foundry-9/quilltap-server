/**
 * drop-chat-concierge-override-v1 — drops the legacy `chats.conciergeOverride`
 * column once `add-chat-concierge-mode-v1` has derived `conciergeMode` from it.
 */

const columns = new Set<string>()
const mockExec = jest.fn((sql: string) => {
  if (/DROP COLUMN "conciergeOverride"/.test(sql)) columns.delete('conciergeOverride')
})

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chats',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  getSQLiteDatabase: () => ({ exec: mockExec }),
}))

import { dropChatConciergeOverrideMigration } from '../../../migrations/scripts/drop-chat-concierge-override'

beforeEach(() => {
  columns.clear()
  for (const c of ['id', 'conciergeOverride', 'conciergeMode']) columns.add(c)
  mockExec.mockClear()
})

describe('drop-chat-concierge-override-v1', () => {
  it('runs after the mode backfill', () => {
    expect(dropChatConciergeOverrideMigration.dependsOn).toEqual(['add-chat-concierge-mode-v1'])
  })

  it('drops the column when present', async () => {
    expect(await dropChatConciergeOverrideMigration.shouldRun()).toBe(true)
    const result = await dropChatConciergeOverrideMigration.run()
    expect(result.success).toBe(true)
    expect(mockExec).toHaveBeenCalledWith('ALTER TABLE "chats" DROP COLUMN "conciergeOverride"')
    expect(columns.has('conciergeOverride')).toBe(false)
  })

  it('has nothing to do once the column is gone', async () => {
    columns.delete('conciergeOverride')
    expect(await dropChatConciergeOverrideMigration.shouldRun()).toBe(false)
  })
})
