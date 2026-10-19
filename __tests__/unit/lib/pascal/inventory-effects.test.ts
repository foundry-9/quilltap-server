/**
 * @jest-environment node
 *
 * Inventory effects (inventory-tools-and-pascal §5.6) over the in-memory
 * Inventory store: a pick-up creates and equips an instance; a reference
 * naming nothing lands nothing; a cap breach skips that gesture before any
 * write while the next gesture proceeds; pick_up without equip; one Pascal
 * line per turn; and the three-way partition order in applyCustomToolEffects.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/inventory/item-images', () => ({ cleanupInventoryItemImages: jest.fn(async () => undefined) }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => ({ id: 'm' })) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({
  refreshAvatarForAppearance: jest.fn(async () => undefined),
  notifyWardrobeChanged: jest.fn(async () => undefined),
}))

import { postPascalInventoryChange } from '@/lib/services/pascal/writer'
import { addCharacter, getFakeRepos, objectsIn, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem } from '@/lib/inventory/item-mutations'
import { flushPendingInventoryAnnouncements } from '@/lib/inventory/equip-effects'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { applyInventoryEffects } from '@/lib/pascal/inventory-effects'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody
const loc = async (scope: 'project' | 'character', id: string) =>
  (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation
const carried = (characterId: string) =>
  ((state.chats.get('chat-1')?.equippedInventory ?? {}) as Record<string, string[]>)[characterId] ?? []
const run = (gestures: Array<{ index: number; inventory: { action: 'equip' | 'unequip' | 'pick_up'; items: string[]; equip?: boolean } }>, extra = {}) =>
  applyInventoryEffects({ userId: 'user-1', chatId: 'chat-1', toolName: 'loot', characterId: 'c-viv', gestures, ...extra })

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
  state.chats.set('chat-1', { id: 'chat-1', projectId: 'project-1', participants: [{ id: 'p-viv', characterId: 'c-viv', type: 'CHARACTER', status: 'active' }] })
})

describe('applyInventoryEffects', () => {
  it('picks up and equips an instance of a project archetype, auditing it', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'magic bow', isArchetype: true }))
    const applied = await run([{ index: 0, inventory: { action: 'pick_up', items: ['magic bow'], equip: true } }])
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
    expect(carried('c-viv')).toHaveLength(1)
    expect(applied).toHaveLength(1)
    expect(applied[0].applied).toMatchObject({
      target: 'inventory.pick_up',
      previous: [],
      next: { item: { title: 'magic bow' }, created: true, equipped: carried('c-viv') },
    })
  })

  it('a reference naming nothing lands nothing', async () => {
    expect(await run([{ index: 0, inventory: { action: 'pick_up', items: ['nothing at all'], equip: true } }])).toEqual([])
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
  })

  it('a cap breach skips that gesture with nothing created, and the next gesture still lands', async () => {
    const project = await loc('project', 'project-1')
    await createInventoryItem(repos(), project, body({ name: 'bow', isArchetype: true }))
    const viv = await loc('character', 'c-viv')
    await createInventoryItem(repos(), viv, body({ name: 'bow', title: 'Old Bow' }))
    await createInventoryItem(repos(), viv, body({ name: 'lantern' }))
    await run([{ index: 0, inventory: { action: 'equip', items: ['Old Bow'] } }])

    const applied = await run([
      { index: 1, inventory: { action: 'pick_up', items: ['bow'], equip: true } },
      { index: 2, inventory: { action: 'equip', items: ['lantern'] } },
    ])
    expect(objectsIn('mp-c-viv')).toHaveLength(2)
    expect(applied.map((a) => [a.index, a.applied.target])).toEqual([[2, 'inventory.equip']])
  })

  it('pick_up with equip false makes the instance without carrying it', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'magic bow', isArchetype: true }))
    const applied = await run([{ index: 0, inventory: { action: 'pick_up', items: ['magic bow'], equip: false } }])
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
    expect(carried('c-viv')).toEqual([])
    expect(applied[0].applied.next).toMatchObject({ created: true, equipped: [] })
  })

  it('equips then unequips in file order, the second seeing the first', async () => {
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    const applied = await run([
      { index: 0, inventory: { action: 'equip', items: ['lantern'] } },
      { index: 1, inventory: { action: 'unequip', items: ['lantern'] } },
    ])
    expect(applied.map((a) => a.applied.target)).toEqual(['inventory.equip', 'inventory.unequip'])
    expect(carried('c-viv')).toEqual([])
  })

  it('joins the turn: one Pascal line at the flush, netted', async () => {
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'compass' }))
    const containers = newWardrobeTurnContainers()
    await run(
      [{ index: 0, inventory: { action: 'equip', items: ['lantern', 'compass'] } }, { index: 1, inventory: { action: 'unequip', items: ['compass'] } }],
      { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements },
    )
    expect(postPascalInventoryChange).not.toHaveBeenCalled()
    await flushPendingInventoryAnnouncements(containers, repos())
    expect((postPascalInventoryChange as jest.Mock).mock.calls.map(([a]) => a.content)).toEqual(['*Vivienne takes up a lantern.*'])
  })

  it('a run nobody made carries nothing', async () => {
    const applied = await applyInventoryEffects({
      userId: 'user-1', chatId: 'chat-1', toolName: 'loot', characterId: null,
      gestures: [{ index: 0, inventory: { action: 'equip', items: ['lantern'] } }],
    })
    expect(applied).toEqual([])
  })
})
