/**
 * @jest-environment node
 *
 * The Inventory routes (spec §5.8) over the in-memory store: the factory's
 * action dispatch (an unknown action is a 400), each refusal's 409 code,
 * `?force`, transfers (move keeps the id; copy refuses `canCopy: false`) and
 * the chat actions.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: unknown) => handler,
  createContextHandler: (handler: unknown) => handler,
  withActionDispatch: jest.requireActual('@/lib/api/middleware/actions').withActionDispatch,
}))
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/pascal/tool-gate-keys', () => require('@/__tests__/helpers/inventory-fake-store').toolGateKeysModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: jest.fn(async () => ({ mountPointId: 'mp-project' })),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => null) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))
jest.mock('@/lib/inventory/item-images', () => {
  class ForeignInventoryImageError extends Error {}
  return {
    ForeignInventoryImageError,
    assertInventoryImageChoice: jest.fn(async () => undefined),
    cleanupInventoryItemImages: jest.fn(async () => undefined),
    carryInventoryItemImages: jest.fn(async () => ({ fileIdMap: new Map(), pendingMove: { repoints: [] } })),
    commitMovedInventoryImages: jest.fn(async () => undefined),
  }
})

import { NextRequest } from 'next/server'
import { addCharacter, getFakeRepos, objectsIn, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import {
  createInventoryCollectionHandlers,
  createInventoryItemHandlers,
} from '@/lib/inventory/routes/inventory-route-factory'
import { POST as transfer } from '@/app/api/v1/inventory/transfers/route'
import { handleGetInventory, handleInventoryEquip, handleInventoryResetDefaults } from '@/app/api/v1/chats/[id]/actions/inventory'

type Handler = (req: NextRequest, ctx: unknown, params: unknown) => Promise<Response>
const project = createInventoryCollectionHandlers<{ id: string }>({ scope: 'project', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'projectId' }) as unknown as Record<'GET' | 'POST', Handler>
const projectItem = createInventoryItemHandlers<{ id: string; itemId: string }>({ scope: 'project', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'projectId' }) as unknown as Record<'GET' | 'PUT' | 'DELETE', Handler>
const character = createInventoryCollectionHandlers<{ id: string }>({ scope: 'character', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'characterId' }) as unknown as Record<'GET' | 'POST', Handler>

const ctx = () => ({ user: { id: 'user-1', name: 'Op' }, repos: getFakeRepos() })
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

async function createIn(handlers: Record<'POST', Handler>, id: string, fields: Record<string, unknown>) {
  const res = await json(await handlers.POST(req(`/x?`, 'POST', fields), ctx(), { id }))
  expect(res.status).toBe(201)
  return res.body.item
}

beforeEach(() => {
  resetStore()
  addCharacter('c-viv', 'Vivienne')
  addCharacter('c-bertie', 'Bertie')
})

describe('the route factory', () => {
  it('answers an unknown action with 400 rather than falling through', async () => {
    const res = await project.GET(req('/x?action=nonsense'), ctx(), { id: 'project-1' })
    expect(res.status).toBe(400)
  })

  it('lists, instantiates and reports dependents; a delete in use is ARCHETYPE_IN_USE, ?force bakes', async () => {
    const bow = await createIn(project, 'project-1', { name: 'magic bow', description: 'Never misses.', isArchetype: true })
    const archetypes = await json(await project.GET(req('/x?action=archetypes'), ctx(), { id: 'project-1' }))
    expect(archetypes.body.items.map((i: { id: string }) => i.id)).toEqual([bow.id])

    for (const id of ['c-viv', 'c-bertie']) {
      const res = await json(await character.POST(req('/x?action=instantiate', 'POST', { archetypeId: bow.id, projectId: 'project-1' }), ctx(), { id }))
      expect(res.status).toBe(201)
      expect(res.body.item).toMatchObject({ parentId: bow.id, name: 'magic bow', description: 'Never misses.' })
    }

    const deps = await json(await projectItem.GET(req('/x?action=dependents'), ctx(), { id: 'project-1', itemId: bow.id }))
    expect(deps.body.dependents.map((d: { ownerName: string }) => d.ownerName).sort()).toEqual(['Bertie', 'Vivienne'])

    const refused = await json(await projectItem.DELETE(req('/x', 'DELETE'), ctx(), { id: 'project-1', itemId: bow.id }))
    expect(refused.status).toBe(409)
    expect(refused.body.details).toMatchObject({ code: 'ARCHETYPE_IN_USE', dependents: 2 })
    expect(refused.body.error).toBe('2 objects derive from it')

    const forced = await json(await projectItem.DELETE(req('/x?force=true', 'DELETE'), ctx(), { id: 'project-1', itemId: bow.id }))
    expect(forced).toMatchObject({ status: 200, body: { success: true, detached: 2 } })
  })

  it('answers INVALID_PARENT, KIT_NESTING and INVALID_SHAPE with their codes', async () => {
    const rope = await createIn(project, 'project-1', { name: 'rope' })
    const notArchetype = await json(await character.POST(req('/x?action=instantiate', 'POST', { archetypeId: rope.id, projectId: 'project-1' }), ctx(), { id: 'c-viv' }))
    expect(notArchetype).toMatchObject({ status: 409, body: { details: { code: 'INVALID_PARENT' } } })

    const kit = await createIn(project, 'project-1', { name: 'kit', kind: 'kit', itemIds: [rope.id] })
    const nested = await json(await project.POST(req('/x', 'POST', { name: 'meta', kind: 'kit', itemIds: [kit.id] }), ctx(), { id: 'project-1' }))
    expect(nested).toMatchObject({ status: 409, body: { details: { code: 'KIT_NESTING' } } })

    const missing = await json(await project.POST(req('/x', 'POST', { name: 'odd kit', kind: 'kit', itemIds: ['0b0b5f3e-6a5e-4d3c-9a1b-2c3d4e5f6a7b'] }), ctx(), { id: 'project-1' }))
    expect(missing).toMatchObject({ status: 400, body: { details: { code: 'INVALID_SHAPE' } } })
  })

  it('clear-override makes a field inherit again; detach bakes', async () => {
    const bow = await createIn(project, 'project-1', { name: 'magic bow', description: 'Never misses.', isArchetype: true })
    const viv = createInventoryItemHandlers<{ id: string; itemId: string }>({ scope: 'character', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'characterId' }) as unknown as Record<'PUT', Handler>
    const made = await json(await character.POST(req('/x?action=instantiate', 'POST', { archetypeId: bow.id, projectId: 'project-1', overrides: { description: 'Mine.' } }), ctx(), { id: 'c-viv' }))
    const id = made.body.item.id
    const cleared = await json(await viv.PUT(req('/x?action=clear-override', 'PUT', { fields: ['description'] }), ctx(), { id: 'c-viv', itemId: id }))
    expect(cleared.body.item.description).toBe('Never misses.')
    const detached = await json(await viv.PUT(req('/x?action=detach', 'PUT'), ctx(), { id: 'c-viv', itemId: id }))
    expect(detached.body.item).toMatchObject({ parentId: null, description: 'Never misses.' })
  })
})

describe('transfers', () => {
  it('move keeps the id; copy is NOT_COPYABLE for canCopy false', async () => {
    const ring = await createIn(character, 'c-viv', { name: 'signet ring' })
    const copy = await json(await (transfer as unknown as Handler)(req('/x', 'POST', { action: 'copy', itemId: ring.id, from: { scope: 'character', id: 'c-viv' }, to: { scope: 'character', id: 'c-bertie' } }), ctx(), {}))
    expect(copy).toMatchObject({ status: 409, body: { details: { code: 'NOT_COPYABLE' } } })

    const move = await json(await (transfer as unknown as Handler)(req('/x', 'POST', { action: 'move', itemId: ring.id, from: { scope: 'character', id: 'c-viv' }, to: { scope: 'character', id: 'c-bertie' } }), ctx(), {}))
    expect(move.status).toBe(200)
    expect(move.body.item.id).toBe(ring.id)
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
    expect(objectsIn('mp-c-bertie').map((o) => o.id)).toEqual([ring.id])
  })
})

describe('transfers keep kits whole', () => {
  const move = (itemId: string, from: unknown, to: unknown) =>
    (transfer as unknown as Handler)(req('/x', 'POST', { action: 'move', itemId, from, to }), ctx(), {})

  it("refuses a move that would strand a member from its kit, naming the kit (KIT_STRANDED)", async () => {
    const lockpicks = await createIn(character, 'c-viv', { name: 'lockpicks' })
    await createIn(character, 'c-viv', { name: "Burglar's kit", kind: 'kit', itemIds: [lockpicks.id] })
    const res = await json(await move(lockpicks.id, { scope: 'character', id: 'c-viv' }, { scope: 'character', id: 'c-bertie' }))
    expect(res).toMatchObject({ status: 409, body: { details: { code: 'KIT_STRANDED' } } })
    expect(JSON.stringify(res.body)).toContain("Burglar's kit")
    expect(objectsIn('mp-c-viv').map((o) => o.id)).toContain(lockpicks.id)
  })

  it('lets a member move where its kit can still reach it (Quilltap General)', async () => {
    const lockpicks = await createIn(character, 'c-viv', { name: 'lockpicks' })
    await createIn(character, 'c-viv', { name: "Burglar's kit", kind: 'kit', itemIds: [lockpicks.id] })
    const res = await json(await move(lockpicks.id, { scope: 'character', id: 'c-viv' }, { scope: 'general', id: null }))
    expect(res.status).toBe(200)
  })

  it("refuses sending a kit where its members are out of reach (INVALID_SHAPE)", async () => {
    const lockpicks = await createIn(character, 'c-viv', { name: 'lockpicks' })
    const kit = await createIn(character, 'c-viv', { name: "Burglar's kit", kind: 'kit', itemIds: [lockpicks.id] })
    const res = await json(await move(kit.id, { scope: 'character', id: 'c-viv' }, { scope: 'general', id: null }))
    expect(res).toMatchObject({ status: 400, body: { details: { code: 'INVALID_SHAPE' } } })
    expect(objectsIn('mp-c-viv').map((o) => o.id)).toContain(kit.id)
  })

  it("lets a character's kit naming a project object move to another character", async () => {
    const lantern = await createIn(project, 'project-1', { name: 'lantern' })
    const made = await json(await character.POST(req('/x?projectId=project-1', 'POST', { name: 'night kit', kind: 'kit', itemIds: [lantern.id] }), ctx(), { id: 'c-viv' }))
    expect(made.status).toBe(201)
    const res = await json(await move(made.body.item.id, { scope: 'character', id: 'c-viv' }, { scope: 'character', id: 'c-bertie' }))
    expect(res.status).toBe(200)
  })

  it("re-saving a character's kit with a project member checks it against the project shelf it was made with", async () => {
    const lantern = await createIn(project, 'project-1', { name: 'lantern' })
    const made = await json(await character.POST(req('/x?projectId=project-1', 'POST', { name: 'night kit', kind: 'kit', itemIds: [lantern.id] }), ctx(), { id: 'c-viv' }))
    const vivItem = createInventoryItemHandlers<{ id: string; itemId: string }>({ scope: 'character', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'characterId' }) as unknown as Record<'PUT', Handler>
    const resaved = await json(await vivItem.PUT(req('/x?projectId=project-1', 'PUT', { itemIds: [lantern.id] }), ctx(), { id: 'c-viv', itemId: made.body.item.id }))
    expect(resaved.status).toBe(200)
    const withoutContext = await json(await vivItem.PUT(req('/x', 'PUT', { itemIds: [lantern.id] }), ctx(), { id: 'c-viv', itemId: made.body.item.id }))
    expect(withoutContext).toMatchObject({ status: 400, body: { details: { code: 'INVALID_SHAPE' } } })
  })
})

describe('chat actions', () => {
  it('equips, reads, refuses a cap breach with CAP_EXCEEDED, and resets to defaults', async () => {
    state.chats.set('chat-1', { id: 'chat-1', projectId: null, participants: [{ id: 'p', type: 'CHARACTER', characterId: 'c-viv', status: 'active' }] })
    const a = await createIn(character, 'c-viv', { name: 'dagger', equippedByDefault: true })
    const b = await createIn(character, 'c-viv', { name: 'dagger' })

    const equipped = await json(await handleInventoryEquip(req('/x', 'POST', { characterId: 'c-viv', ids: [b.id] }), 'chat-1', ctx() as never, 'equip'))
    expect(equipped.status).toBe(200)
    const breach = await json(await handleInventoryEquip(req('/x', 'POST', { characterId: 'c-viv', ids: [a.id] }), 'chat-1', ctx() as never, 'equip'))
    expect(breach).toMatchObject({ status: 409, body: { details: { code: 'CAP_EXCEEDED', cap: 1 } } })

    const read = await json(await handleGetInventory('chat-1', ctx() as never))
    expect(read.body.inventory['c-viv'].equipped.map((i: { id: string }) => i.id)).toEqual([b.id])

    const reset = await json(await handleInventoryResetDefaults(req('/x', 'POST', { characterId: 'c-viv' }), 'chat-1', ctx() as never))
    expect(reset.body.equipped).toEqual([a.id])
  })

  it('refuses a character who is not in the chat with NOT_A_PARTICIPANT', async () => {
    state.chats.set('chat-1', { id: 'chat-1', projectId: null, participants: [] })
    const ring = await createIn(character, 'c-viv', { name: 'ring' })
    const res = await json(await handleInventoryEquip(req('/x', 'POST', { characterId: 'c-viv', ids: [ring.id] }), 'chat-1', ctx() as never, 'equip'))
    expect(res).toMatchObject({ status: 400, body: { details: { code: 'NOT_A_PARTICIPANT' } } })
  })
})
