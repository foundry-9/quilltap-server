/**
 * add-chat-equipped-inventory-v1 — adds `chats.equippedInventory`,
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

import { addChatEquippedInventoryMigration } from '../../../migrations/scripts/add-chat-equipped-inventory-v1'
import { migrations } from '../../../migrations/scripts'
import { prettify, humanize } from '@/lib/startup/prettify'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  columns.add('id')
  columns.add('equippedOutfit')
})

describe('add-chat-equipped-inventory-v1', () => {
  it('is registered, labelled, dated 4.11.0 and follows the outfit column', () => {
    expect(addChatEquippedInventoryMigration.id).toBe('add-chat-equipped-inventory-v1')
    expect(addChatEquippedInventoryMigration.introducedInVersion).toBe('4.11.0')
    expect(addChatEquippedInventoryMigration.dependsOn).toEqual(['add-equipped-outfit-field-v1'])
    expect(migrations).toContain(addChatEquippedInventoryMigration)
    expect(prettify('add-chat-equipped-inventory-v1')).not.toBe(humanize('add-chat-equipped-inventory-v1'))
  })

  it('adds the nullable JSON column, then has nothing left to do', async () => {
    expect(await addChatEquippedInventoryMigration.shouldRun()).toBe(true)
    const result = await addChatEquippedInventoryMigration.run()
    expect(result).toMatchObject({ success: true, itemsAffected: 1 })
    expect(ddl.get('equippedInventory')).toBe('TEXT DEFAULT NULL')
    expect(await addChatEquippedInventoryMigration.shouldRun()).toBe(false)
  })

  it('is idempotent: a second run adds nothing', async () => {
    await addChatEquippedInventoryMigration.run()
    const again = await addChatEquippedInventoryMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
  })
})
