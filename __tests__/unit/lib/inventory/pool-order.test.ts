/**
 * @jest-environment node
 *
 * The Inventory pool's within-tier order (Refactor 4.12, tier walk §5.1):
 * inside a tier the earlier mount wins — membership order for groups, the
 * official store first for the project. Before 4.12 the last mount won.
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
jest.mock('@/lib/pascal/tool-gate-keys', () => require('@/__tests__/helpers/inventory-fake-store').toolGateKeysModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))

import { addCharacter, getFakeRepos, objectsIn, putDoc, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem } from '@/lib/inventory/item-mutations'
import { loadInventoryPool } from '@/lib/inventory/pool'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody

/** Write one object into `fromMp`, then the same object (same id) under another name into `toMp`. */
async function twin(from: InventoryLocation, toMp: string, names: [string, string]): Promise<string> {
  const record = await createInventoryItem(repos(), from, body({ name: names[0] }))
  const [doc] = objectsIn(from.mountPointId).filter((o) => o.id === record.id)
  const { __path, ...content } = doc
  putDoc(toMp, __path.replace(names[0], names[1]), { ...content, name: names[1] })
  return record.id
}

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
})

it('the first group in membership order wins a same-id collision (was: the last)', async () => {
  state.groups = [
    { id: 'g-first', name: 'First', officialMountPointId: 'mp-first' },
    { id: 'g-second', name: 'Second', officialMountPointId: 'mp-second' },
  ]
  state.groupMounts.set('c-viv', [
    { group: { id: 'g-first', name: 'First' }, mountPointIds: ['mp-first'] },
    { group: { id: 'g-second', name: 'Second' }, mountPointIds: ['mp-second'] },
  ])
  const first = (await resolveInventoryLocation('group', 'g-first', repos(), 'user-1')) as InventoryLocation
  const id = await twin(first, 'mp-second', ['compass', 'sextant'])

  const pool = await loadInventoryPool(repos(), { characterId: 'c-viv' })

  expect(pool.get(id)?.name).toBe('compass')
  expect(pool.get(id)?.origin).toEqual({ scope: 'group', id: 'g-first', name: 'First' })
})

it("the project's official store wins over a linked store (was: the last linked)", async () => {
  state.projectMounts.set('project-1', ['mp-project', 'mp-linked'])
  const project = (await resolveInventoryLocation('project', 'project-1', repos(), 'user-1')) as InventoryLocation
  const id = await twin(project, 'mp-linked', ['lantern', 'candle'])

  const pool = await loadInventoryPool(repos(), { characterId: 'c-viv', projectId: 'project-1' })

  expect(pool.get(id)?.name).toBe('lantern')
})
