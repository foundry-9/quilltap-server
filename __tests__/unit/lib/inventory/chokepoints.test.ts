/**
 * @jest-environment node
 *
 * The Inventory's shared chokepoints, over the in-memory store: every write
 * through a location publishes the `inventory` topic (reads never do), a
 * write parses the folder once, carried-set writes publish the chat's topic
 * (in every chat a drop touches), and the small builders the routes, tools
 * and Pascal share — the change context, the seated cast, the error wrapper,
 * the tier test.
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
jest.mock('@/lib/inventory/item-images', () => ({
  cleanupInventoryItemImages: jest.fn(async () => undefined),
  ForeignInventoryImageError: class ForeignInventoryImageError extends Error {},
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => ({ id: 'm' })) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))

import { publishRealtime } from '@/lib/realtime/bus'
import { addCharacter, getFakeRepos, PROJECT_MP, putDoc, pathsIn, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem, deleteInventoryItem, updateInventoryItem } from '@/lib/inventory/item-mutations'
import { dropCarriedEverywhere, equipItems, seatedCharacterIds } from '@/lib/inventory/equip'
import { inventoryChangeContext } from '@/lib/inventory/equip-effects'
import { InventoryCapExceededError, InventoryNotAParticipantError } from '@/lib/inventory/errors'
import { withInventoryErrors } from '@/lib/inventory/routes/responses'
import { isInContainer } from '@/lib/inventory/container'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const CTX = inventoryChangeContext('user-1', 'operator')
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody

async function project(): Promise<InventoryLocation> {
  return (await resolveInventoryLocation('project', 'project-1', repos(), 'user-1')) as InventoryLocation
}

function addChat(id: string, characterIds: string[]) {
  state.chats.set(id, {
    id,
    projectId: 'project-1',
    participants: characterIds.map((characterId) => ({ id: `p-${characterId}`, characterId, type: 'CHARACTER', status: 'active' })),
  })
  return state.chats.get(id)!
}

const published = (topic: string, id?: string) =>
  (publishRealtime as jest.Mock).mock.calls.filter(([t, i]) => t === topic && (id === undefined || i === id)).length

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
})

describe('a location write', () => {
  it('publishes the inventory topic on create, update and delete; a read publishes nothing', async () => {
    const loc = await project()
    const lantern = await createInventoryItem(repos(), loc, body({ name: 'lantern' }))
    expect(published('inventory')).toBe(1)

    await updateInventoryItem(repos(), loc, lantern, { description: 'Brass, dented.' })
    expect(published('inventory')).toBe(2)

    await loc.readItems(true)
    await loc.findItem(lantern.id)
    await loc.listFolders()
    expect(published('inventory')).toBe(2)

    await deleteInventoryItem(repos(), loc, lantern)
    expect(published('inventory')).toBe(3)
  })

  it('publishes nothing for a batch that matched nothing', async () => {
    const loc = await project()
    await createInventoryItem(repos(), loc, body({ name: 'lantern' }))
    ;(publishRealtime as jest.Mock).mockClear()
    const stale = '00000000-0000-4000-8000-0000000000ff'
    expect(await loc.update(stale, { description: 'gone' })).toBeNull()
    expect(await loc.delete([stale])).toEqual([])
    expect(published('inventory')).toBe(0)
  })

  it('publishes for a folder operation too', async () => {
    const loc = await project()
    await loc.createFolder('Weapons')
    expect(published('inventory')).toBe(1)
  })

  it('reads the folder once, then lets the projection read it once', async () => {
    const loc = await project()
    const finder = getFakeRepos().docMountDocuments.findManyByMountPointsInFolder as jest.Mock
    finder.mockClear()
    await loc.create({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'rope',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      folder: '',
    })
    expect(finder).toHaveBeenCalledTimes(2)
  })

  it('a folder delete reuses its own read for the write, so the whole folder is scanned once', async () => {
    const loc = await project()
    await createInventoryItem(repos(), loc, body({ name: 'sword', folder: 'Weapons' }))
    const finder = getFakeRepos().docMountDocuments.findManyByMountPointsInFolder as jest.Mock
    finder.mockClear()
    await loc.deleteFolder('Weapons')
    // One scan of `Inventory/` for the read, one listing inside the projection.
    const wholeFolder = finder.mock.calls.filter(([, folder]) => folder === 'Inventory')
    expect(wholeFolder).toHaveLength(2)
    expect(JSON.parse(state.docs.get(`${PROJECT_MP}::Inventory/sword.json`) as string).name).toBe('sword')
  })

  it('still sweeps only what the scan parsed: a note and a duplicate-id copy survive', async () => {
    const loc = await project()
    const rope = await createInventoryItem(repos(), loc, body({ name: 'rope' }))
    putDoc(PROJECT_MP, 'Inventory/notes.json', 'not an object')
    putDoc(PROJECT_MP, 'Inventory/rope copy.json', state.docs.get(`${PROJECT_MP}::Inventory/rope.json`) as string)

    await updateInventoryItem(repos(), loc, rope, { description: 'Fifty feet.' })

    expect(pathsIn(PROJECT_MP)).toEqual(expect.arrayContaining(['Inventory/notes.json', 'Inventory/rope copy.json', 'Inventory/rope.json']))
    const original = JSON.parse(state.docs.get(`${PROJECT_MP}::Inventory/rope.json`) as string)
    expect(original.description).toBe('Fifty feet.')
  })
})

describe('carried-set writes', () => {
  it('publish the chat topic once an equip lands, and nothing when a refusal stops it', async () => {
    const loc = await project()
    const a = await createInventoryItem(repos(), loc, body({ name: 'ring' }))
    const b = await createInventoryItem(repos(), loc, body({ name: 'ring', title: 'Second ring' }))
    const chat = addChat('chat-1', ['c-viv'])

    await equipItems(repos(), chat, 'c-viv', [a.id], CTX)
    expect(published('chats', 'chat-1')).toBe(1)

    await expect(equipItems(repos(), chat, 'c-viv', [b.id], CTX)).rejects.toBeInstanceOf(InventoryCapExceededError)
    expect(published('chats', 'chat-1')).toBe(1)
  })

  it('a drop publishes every chat it changed, not only the one it was asked from', async () => {
    const loc = await project()
    const ring = await createInventoryItem(repos(), loc, body({ name: 'ring' }))
    await equipItems(repos(), addChat('chat-1', ['c-viv']), 'c-viv', [ring.id], CTX)
    await equipItems(repos(), addChat('chat-2', ['c-viv']), 'c-viv', [ring.id], CTX)
    addChat('chat-3', ['c-viv'])
    ;(publishRealtime as jest.Mock).mockClear()

    expect(await dropCarriedEverywhere(repos(), 'c-viv', ring.id, ['chat-3'])).toBe(2)
    expect(published('chats', 'chat-1')).toBe(1)
    expect(published('chats', 'chat-2')).toBe(1)
    expect(published('chats', 'chat-3')).toBe(0)
  })

  it('refuse a character who is not seated', async () => {
    const loc = await project()
    const ring = await createInventoryItem(repos(), loc, body({ name: 'ring' }))
    addCharacter('c-ash', 'Ash')
    const chat = addChat('chat-1', ['c-viv'])
    await expect(equipItems(repos(), chat, 'c-ash', [ring.id], CTX)).rejects.toBeInstanceOf(InventoryNotAParticipantError)
  })
})

describe('seatedCharacterIds', () => {
  it('lists each seated character once, leaving out removed seats and seats with no character', () => {
    expect(
      seatedCharacterIds({
        participants: [
          { characterId: 'a', status: 'active' },
          { characterId: 'b', status: 'removed' },
          { characterId: null, status: 'active' },
          { characterId: 'a', status: 'silent' },
          { characterId: 'c' },
        ],
      }),
    ).toEqual(['a', 'c'])
  })
})

describe('inventoryChangeContext', () => {
  it('announces by default and carries no pending set outside a turn', () => {
    expect(inventoryChangeContext('u', 'pascal')).toEqual({ userId: 'u', provenance: 'pascal', announce: true })
  })

  it('joins the turn when given its containers, and arrival can turn the line off', () => {
    const turn = newWardrobeTurnContainers()
    const ctx = inventoryChangeContext('u', 'character', { ...turn, announce: false })
    expect(ctx.announce).toBe(false)
    expect(ctx.pendingInventoryAnnouncements).toBe(turn.pendingInventoryAnnouncements)
  })
})

describe('withInventoryErrors', () => {
  it('answers a refusal with its status and code', async () => {
    const handler = withInventoryErrors(async () => {
      throw new InventoryNotAParticipantError('c-1')
    })
    const response = await handler()
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(JSON.stringify(json)).toContain('NOT_A_PARTICIPANT')
  })

  it('lets anything else through to the middleware', async () => {
    const boom = new Error('not an Inventory refusal')
    const handler = withInventoryErrors(async () => {
      throw boom
    })
    await expect(handler()).rejects.toBe(boom)
  })
})

describe('isInContainer', () => {
  const at = (scope: 'character' | 'group' | 'project' | 'general', id: string | null) => ({ origin: { scope, id, name: 'x' } })

  it('a character view owns only that character\'s objects', () => {
    const viv = { scope: 'character' as const, id: 'c-viv' }
    expect(isInContainer(at('character', 'c-viv'), viv)).toBe(true)
    expect(isInContainer(at('character', 'c-ash'), viv)).toBe(false)
    expect(isInContainer(at('project', 'project-1'), viv)).toBe(false)
    expect(isInContainer(at('general', null), viv)).toBe(false)
  })

  it('a shared tier owns its own objects, and an untagged object is the tier\'s', () => {
    const tier = { scope: 'project' as const, id: 'project-1' }
    expect(isInContainer(at('project', 'project-1'), tier)).toBe(true)
    expect(isInContainer(at('general', null), tier)).toBe(false)
    expect(isInContainer({}, tier)).toBe(true)
  })
})
