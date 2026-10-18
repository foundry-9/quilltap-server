/**
 * @jest-environment node
 *
 * Inventory mutations over the in-memory store (spec §5.5): instantiate,
 * edit-the-archetype-reaches-every-instance, detach, forced delete,
 * the archived-dependent refusal, kit-member scrubbing and canCopy.
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

import {
  addCharacter,
  getFakeRepos,
  objectsIn,
  PROJECT_MP,
  putDoc,
  resetStore,
} from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import {
  copyInventoryItemsToFolder,
  createInventoryItem,
  deleteInventoryItem,
  detach,
  duplicateInventoryItem,
  instantiate,
  moveInventoryItemsToFolder,
  updateInventoryItem,
} from '@/lib/inventory/item-mutations'
import { loadInventoryPool } from '@/lib/inventory/pool'
import {
  InventoryArchetypeInUseError,
  InventoryArchivedDependentsError,
  InventoryKitNestingError,
  InventoryNotCopyableError,
} from '@/lib/inventory/errors'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody

async function loc(scope: 'project' | 'character', id: string): Promise<InventoryLocation> {
  return (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation
}

beforeEach(() => {
  resetStore()
  addCharacter('c-vivienne', 'Vivienne')
  addCharacter('c-bertie', 'Bertie')
})

describe('archetypes and instances', () => {
  it('an archetype edit reaches every instance that did not override the field; detach bakes', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'magic bow', description: 'Never misses.', isArchetype: true }))
    const viv = await loc('character', 'c-vivienne')
    const bert = await loc('character', 'c-bertie')
    const a = await instantiate(repos(), viv, bow.id, { pool: await loadInventoryPool(repos(), { characterId: 'c-vivienne', projectId: 'project-1' }) })
    const b = await instantiate(repos(), bert, bow.id, { pool: await loadInventoryPool(repos(), { characterId: 'c-bertie', projectId: 'project-1' }) })
    expect(a.item).toMatchObject({ name: 'magic bow', description: 'Never misses.', parentId: bow.id })

    // The instance file is sparse.
    const [file] = objectsIn('mp-c-vivienne')
    expect(Object.keys(file).sort()).toEqual(['__path', 'createdAt', 'id', 'parentId', 'updatedAt'])
    expect(file.__path).toBe('Inventory/magic bow.json')

    await updateInventoryItem(repos(), viv, a.record, { title: 'Heartseeker' })
    await updateInventoryItem(repos(), project, bow, { description: 'Sings when drawn.' })

    const vivPool = await loadInventoryPool(repos(), { characterId: 'c-vivienne', projectId: 'project-1' })
    const bertPool = await loadInventoryPool(repos(), { characterId: 'c-bertie', projectId: 'project-1' })
    expect(vivPool.resolveId(a.record.id)).toMatchObject({ title: 'Heartseeker', description: 'Sings when drawn.' })
    expect(bertPool.resolveId(b.record.id)).toMatchObject({ description: 'Sings when drawn.' })
    expect(bertPool.resolveId(b.record.id)?.title).not.toBe('Heartseeker')

    // Outside the project the archetype is fetched instance-wide, so it still resolves.
    const outside = await loadInventoryPool(repos(), { characterId: 'c-vivienne' })
    expect(outside.resolveId(a.record.id)).toMatchObject({ name: 'magic bow', parentMissing: false })

    const current = (await viv.findItem(a.record.id))!
    await detach(repos(), viv, current, vivPool)
    const baked = objectsIn('mp-c-vivienne')[0]
    expect(baked).toMatchObject({ parentId: null, name: 'magic bow', title: 'Heartseeker', description: 'Sings when drawn.' })
  })

  it('deleting an archetype in use is refused with the count; forced, every instance is baked first', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'magic bow', description: 'Never misses.', isArchetype: true }))
    await instantiate(repos(), await loc('character', 'c-vivienne'), bow.id, { pool: await loadInventoryPool(repos(), { characterId: 'c-vivienne', projectId: 'project-1' }) })
    await instantiate(repos(), await loc('character', 'c-bertie'), bow.id, { pool: await loadInventoryPool(repos(), { characterId: 'c-bertie', projectId: 'project-1' }) })

    const refused = deleteInventoryItem(getFakeRepos() as never, project, bow)
    await expect(refused).rejects.toBeInstanceOf(InventoryArchetypeInUseError)
    await expect(deleteInventoryItem(getFakeRepos() as never, project, bow)).rejects.toThrow('2 objects derive from it')

    const result = await deleteInventoryItem(getFakeRepos() as never, project, bow, { force: true })
    expect(result).toEqual({ deleted: true, detached: 2 })
    expect(objectsIn(PROJECT_MP)).toHaveLength(0)
    for (const mp of ['mp-c-vivienne', 'mp-c-bertie']) {
      expect(objectsIn(mp)[0]).toMatchObject({ parentId: null, name: 'magic bow', description: 'Never misses.' })
    }
  })

  it('a forced delete is refused, naming the character, while an archived character holds an instance', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'magic bow', isArchetype: true }))
    addCharacter('c-ghost', 'Ghost')
    await instantiate(repos(), await loc('character', 'c-ghost'), bow.id, { pool: await loadInventoryPool(repos(), { characterId: 'c-ghost', projectId: 'project-1' }) })
    getFakeRepos().characters.findByIdRaw.mockClear()
    const { state } = require('@/__tests__/helpers/inventory-fake-store')
    state.characters.get('c-ghost').archivedAt = '2026-10-18T00:00:00.000Z'

    const forced = deleteInventoryItem(getFakeRepos() as never, project, bow, { force: true })
    await expect(forced).rejects.toBeInstanceOf(InventoryArchivedDependentsError)
    await expect(deleteInventoryItem(getFakeRepos() as never, project, bow, { force: true })).rejects.toThrow('Ghost')
    expect(objectsIn(PROJECT_MP)).toHaveLength(1)
  })
})

describe('kits', () => {
  it('refuses a kit naming a kit, and drops a deleted member from the kits of its tier', async () => {
    const project = await loc('project', 'project-1')
    const rope = await createInventoryItem(repos(), project, body({ name: 'rope' }))
    const torch = await createInventoryItem(repos(), project, body({ name: 'torch' }))
    const kit = await createInventoryItem(repos(), project, body({ name: 'explorer kit', kind: 'kit', itemIds: [rope.id, torch.id] }))
    await expect(
      createInventoryItem(repos(), project, body({ name: 'meta kit', kind: 'kit', itemIds: [kit.id] })),
    ).rejects.toBeInstanceOf(InventoryKitNestingError)

    await deleteInventoryItem(getFakeRepos() as never, project, rope)
    const stored = objectsIn(PROJECT_MP).find((o) => o.id === kit.id)
    expect(stored?.itemIds).toEqual([torch.id])
  })
})

describe('canCopy and filing', () => {
  it('canCopy false blocks duplicate and copy-items; move still works', async () => {
    const viv = await loc('character', 'c-vivienne')
    const ring = await createInventoryItem(repos(), viv, body({ name: 'signet ring' }))
    await expect(duplicateInventoryItem(repos(), viv, ring)).rejects.toBeInstanceOf(InventoryNotCopyableError)
    await expect(copyInventoryItemsToFolder(repos(), viv, [ring.id], 'Rings')).rejects.toBeInstanceOf(InventoryNotCopyableError)
    const [moved] = await moveInventoryItemsToFolder(viv, [ring.id], 'Rings')
    expect(moved.folder).toBe('Rings')
    expect(objectsIn('mp-c-vivienne').map((o) => o.__path)).toEqual(['Inventory/Rings/signet ring.json'])
  })

  it('a copyable object duplicates as "(copy)" and keeps its name (kin)', async () => {
    const viv = await loc('character', 'c-vivienne')
    const potion = await createInventoryItem(repos(), viv, body({ name: 'potion', canCopy: true }))
    const copy = await duplicateInventoryItem(repos(), viv, potion)
    expect(copy).toMatchObject({ name: 'potion', title: 'potion (copy)' })
    expect(copy.id).not.toBe(potion.id)
  })

  it('a note dropped beside the objects survives every write', async () => {
    putDoc('mp-c-vivienne', 'Inventory/Weapons/readme.md', '# notes')
    putDoc('mp-c-vivienne', 'Inventory/Weapons/broken.json', '{ nope')
    const viv = await loc('character', 'c-vivienne')
    await createInventoryItem(repos(), viv, body({ name: 'sword', folder: 'Weapons' }))
    const { pathsIn } = require('@/__tests__/helpers/inventory-fake-store')
    expect(pathsIn('mp-c-vivienne')).toEqual([
      'Inventory/Weapons/broken.json',
      'Inventory/Weapons/readme.md',
      'Inventory/Weapons/sword.json',
    ])
  })
})
