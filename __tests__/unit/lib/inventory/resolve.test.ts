/**
 * Inventory resolution (spec §5.4): sparse overrides over an archetype,
 * metadata merged key by key, the picture falling through, a missing parent.
 */

import { inventoryDisplayName, kitState, resolveItem } from '@/lib/inventory/resolve'
import type { InventoryRecord } from '@/lib/schemas/inventory.types'

const T = '2026-10-18T12:00:00.000Z'
const BOW: InventoryRecord = {
  id: 'a0000000-0000-4000-8000-000000000001',
  kind: 'item',
  name: 'magic bow',
  description: 'A bow that never misses.',
  imageDescription: 'a longbow inlaid with silver',
  equippedByDefault: false,
  maxEquipped: 1,
  canCopy: false,
  isArchetype: true,
  parentId: null,
  itemIds: [],
  imageFileId: 'f0000000-0000-4000-8000-000000000001',
  metadata: { range: 'long', damage: 'd8' },
  folder: 'Weapons',
  createdAt: T,
  updatedAt: T,
}
const lookup = (id: string) => (id === BOW.id ? BOW : undefined)

describe('resolveItem', () => {
  it('a standalone or archetype resolves to itself', () => {
    expect(resolveItem(BOW, lookup)).toMatchObject({ id: BOW.id, isArchetype: true, name: 'magic bow' })
  })

  it('an instance inherits what it does not override, and keeps its own identity and filing', () => {
    const instance: InventoryRecord = {
      id: 'a0000000-0000-4000-8000-000000000002',
      parentId: BOW.id,
      title: 'Heartseeker',
      metadata: { damage: 'd10' },
      folder: '',
      createdAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-19T00:00:00.000Z',
    }
    const item = resolveItem(instance, lookup)
    expect(item).toMatchObject({
      id: instance.id,
      parentId: BOW.id,
      isArchetype: false,
      kind: 'item',
      name: 'magic bow',
      title: 'Heartseeker',
      description: 'A bow that never misses.',
      folder: '',
      createdAt: '2026-10-19T00:00:00.000Z',
      parentMissing: false,
      parentName: 'magic bow',
    })
    expect(item.metadata).toEqual({ range: 'long', damage: 'd10' })
    expect(item.overriddenFields).toEqual(['title', 'metadata'])
  })

  it("the archetype's picture falls through to an instance with none of its own", () => {
    const instance: InventoryRecord = { id: 'a0000000-0000-4000-8000-000000000003', parentId: BOW.id, folder: '', createdAt: T, updatedAt: T }
    expect(resolveItem(instance, lookup).imageFileId).toBe(BOW.imageFileId)
  })

  it('an explicit null overrides the archetype with "none"', () => {
    const instance: InventoryRecord = { id: 'a0000000-0000-4000-8000-000000000004', parentId: BOW.id, description: null, folder: '', createdAt: T, updatedAt: T }
    expect(resolveItem(instance, lookup).description).toBeNull()
  })

  it('a missing parent resolves to the instance own fields with parentMissing', () => {
    const instance: InventoryRecord = { id: 'a0000000-0000-4000-8000-000000000005', parentId: 'a0000000-0000-4000-8000-0000000000ff', title: 'Lost', folder: '', createdAt: T, updatedAt: T, fileStem: 'Lost' }
    const item = resolveItem(instance, lookup)
    expect(item).toMatchObject({ parentMissing: true, title: 'Lost', name: 'Lost', isArchetype: false })
  })
})

describe('inventoryDisplayName / kitState', () => {
  it('shows the title first with the name in parentheses when they differ', () => {
    expect(inventoryDisplayName({ name: 'sword', title: 'Excalibur' })).toBe('Excalibur (sword)')
    expect(inventoryDisplayName({ name: 'Signet ring', title: null })).toBe('Signet ring')
    expect(inventoryDisplayName({ name: 'lantern', title: 'Lantern' })).toBe('Lantern')
  })

  it('reads all / some / none, counting an archetype member through its instances', () => {
    const items = new Map([
      ['s', { isArchetype: false, kind: 'item' as const, archivedAt: null }],
      ['b', { isArchetype: true, kind: 'item' as const, archivedAt: null }],
    ])
    const kit = { itemIds: ['s', 'b', 'gone'] }
    const resolvable = (id: string) => items.get(id)
    expect(kitState(kit, [], resolvable)).toBe('none')
    expect(kitState(kit, [{ id: 's', parentId: null }], resolvable)).toBe('some')
    expect(kitState(kit, [{ id: 's', parentId: null }, { id: 'i', parentId: 'b' }], resolvable)).toBe('all')
  })
})
