/**
 * @jest-environment node
 *
 * The inventory_* tool handlers over the in-memory Inventory store, through
 * the real pool, equip chokepoints, mutations and transfers: states in a
 * listing, a pick-up from the project store (one instance, equipped, one
 * Pascal line per turn), the cap checked before a pick-up writes, own-only
 * refusals, and give's move and refusals.
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
jest.mock('@/lib/inventory/item-images', () => ({
  cleanupInventoryItemImages: jest.fn(async () => undefined),
  carryInventoryItemImages: jest.fn(async () => ({ fileIdMap: new Map(), pendingMove: [] })),
  commitMovedInventoryImages: jest.fn(async () => undefined),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/inventory/transfers', () => {
  const actual = jest.requireActual('@/lib/inventory/transfers')
  return { ...actual, transferInventoryItem: jest.fn(actual.transferInventoryItem) }
})
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => ({ id: 'm' })) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))

import { postPascalInventoryChange } from '@/lib/services/pascal/writer'
import { addCharacter, getFakeRepos, objectsIn, putOffRoster, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { equipItems, pickUpItems } from '@/lib/inventory/equip'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem, instantiate } from '@/lib/inventory/item-mutations'
import { loadInventoryPool } from '@/lib/inventory/pool'
import { flushPendingInventoryAnnouncements } from '@/lib/inventory/equip-effects'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { INVENTORY_TOOL_TABLE } from '@/lib/tools/handlers/inventory-tool-table'
import { transferInventoryItem } from '@/lib/inventory/transfers'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody
const posted = () => (postPascalInventoryChange as jest.Mock).mock.calls.map(([arg]) => arg.content)

async function loc(scope: 'project' | 'character', id: string): Promise<InventoryLocation> {
  return (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation
}
function addChat(id: string, characterIds: string[]) {
  state.chats.set(id, { id, projectId: 'project-1', participants: characterIds.map((characterId) => ({ id: `p-${characterId}`, characterId, type: 'CHARACTER', status: 'active' })) })
}
const carried = (chatId: string, characterId: string) =>
  ((state.chats.get(chatId)?.equippedInventory ?? {}) as Record<string, string[]>)[characterId] ?? []

const run = (tool: string, input: unknown, extra: Record<string, unknown> = {}) =>
  INVENTORY_TOOL_TABLE[tool](input, { userId: 'user-1', chatId: 'chat-1', characterId: 'c-viv', ...extra })

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
  addCharacter('c-marcus', 'Marcus')
  addChat('chat-1', ['c-viv', 'c-marcus'])
})

describe('inventory_list', () => {
  it('reports equipped, carried, reachable and pick-up-able archetypes, shared rows tagged', async () => {
    const project = await loc('project', 'project-1')
    const viv = await loc('character', 'c-viv')
    await createInventoryItem(repos(), project, body({ name: 'magic bow', isArchetype: true }))
    await createInventoryItem(repos(), project, body({ name: 'lantern' }))
    const ring = await createInventoryItem(repos(), viv, body({ name: 'ring' }))
    await createInventoryItem(repos(), viv, body({ name: 'compass' }))
    await run('inventory_equip', { refs: ['ring'] })

    const r = await run('inventory_list', {})
    expect(r.success).toBe(true)
    const items = (r.result as { items: Array<{ name: string; state: string | null; kind: string; is_own: boolean }> }).items
    const byName = Object.fromEntries(items.map((i) => [i.name, i]))
    expect(byName.ring.state).toBe('equipped')
    expect(byName.compass.state).toBe('carried')
    expect(byName.lantern).toMatchObject({ state: 'reachable', is_own: false })
    expect(byName['magic bow']).toMatchObject({ state: null, kind: 'archetype' })
    expect((r.result as { formattedText: string }).formattedText).toContain('[shared — read-only]')

    const onlyEquipped = await run('inventory_list', { equipped: true })
    expect((onlyEquipped.result as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([ring.id])
  })
})

describe('inventory_pick_up', () => {
  it('makes one equipped instance of a project archetype, and the turn posts one Pascal line', async () => {
    const project = await loc('project', 'project-1')
    await createInventoryItem(repos(), project, body({ name: 'magic bow', isArchetype: true }))
    const containers = newWardrobeTurnContainers()

    const r = await run('inventory_pick_up', { ref: 'magic bow' }, { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements })
    expect(r.success).toBe(true)
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
    expect(carried('chat-1', 'c-viv')).toHaveLength(1)
    expect(postPascalInventoryChange).not.toHaveBeenCalled()

    // A second gesture in the same turn joins the same line.
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'compass' }))
    await run('inventory_equip', { refs: ['compass'] }, { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements })
    await flushPendingInventoryAnnouncements(containers, repos())
    expect(posted()).toEqual(['*Vivienne takes up a compass and picks up a magic bow.*'])
  })

  it('a pick-up set down again in the same turn announces nothing', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'torch', isArchetype: true }))
    const containers = newWardrobeTurnContainers()
    const turn = { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements }
    expect((await run('inventory_pick_up', { ref: 'torch' }, turn)).success).toBe(true)
    expect((await run('inventory_unequip', { refs: ['torch'] }, turn)).success).toBe(true)
    await flushPendingInventoryAnnouncements(containers, repos())
    expect(posted()).toEqual([])
  })

  it('checks the cap before writing: a breach creates nothing', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'bow', isArchetype: true }))
    const viv = await loc('character', 'c-viv')
    const pool = await loadInventoryPool(repos(), { characterId: 'c-viv', projectId: 'project-1' })
    const { record } = await instantiate(repos(), viv, bow.id, { pool })
    await run('inventory_equip', { refs: [record.id] })
    expect(objectsIn('mp-c-viv')).toHaveLength(1)

    const r = await run('inventory_pick_up', { ref: 'bow' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('at most 1')
    expect(objectsIn('mp-c-viv')).toHaveLength(1)

    // Without equipping, the cap does not apply.
    const unequipped = await run('inventory_pick_up', { ref: 'bow', equip: false, title: 'Spare' })
    expect(unequipped.success).toBe(true)
    expect(objectsIn('mp-c-viv')).toHaveLength(2)
    expect(carried('chat-1', 'c-viv')).toHaveLength(1)
  })

  it('refuses a non-archetype in words', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'lantern' }))
    const r = await run('inventory_pick_up', { ref: 'lantern' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('not an archetype')
  })
})

describe('inventory_equip', () => {
  it('renders a cap breach as a failure in its own words, nothing changed', async () => {
    const viv = await loc('character', 'c-viv')
    await createInventoryItem(repos(), viv, body({ name: 'sword', title: 'Excalibur' }))
    await createInventoryItem(repos(), viv, body({ name: 'sword', title: 'Durendal' }))
    await run('inventory_equip', { refs: ['Excalibur'] })
    const r = await run('inventory_equip', { refs: ['Durendal'] })
    expect(r.success).toBe(false)
    expect(r.error).toContain('at most 1')
    expect(carried('chat-1', 'c-viv')).toHaveLength(1)
  })

  it('points an archetype at pick-up', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'magic bow', isArchetype: true }))
    const r = await run('inventory_equip', { refs: ['magic bow'] })
    expect(r.success).toBe(false)
    expect(r.error).toContain('inventory_pick_up')
  })
})

describe('own-only mutations', () => {
  it('update and archive refuse a shared object; succeed on an own one', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'lantern' }))
    expect((await run('inventory_update', { ref: 'lantern', description: 'x' })).error).toContain('shared store')
    expect((await run('inventory_archive', { ref: 'lantern', archived: true })).error).toContain('shared store')

    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'compass', metadata: { charges: 1 } }))
    const u = await run('inventory_update', { ref: 'compass', title: 'The Navigator', metadata: { bearing: 'north' } })
    expect(u.success).toBe(true)
    expect(objectsIn('mp-c-viv')[0]).toMatchObject({ title: 'The Navigator', metadata: { charges: 1, bearing: 'north' } })
    const a = await run('inventory_archive', { ref: 'The Navigator', archived: true })
    expect(a.success).toBe(true)
    expect(objectsIn('mp-c-viv')[0].archivedAt).toBeTruthy()
  })

  it('archive drops a carried object from every chat, so a restore does not re-equip it', async () => {
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'compass' }))
    addChat('chat-2', ['c-viv', 'c-marcus'])
    await run('inventory_equip', { refs: ['compass'] })
    await run('inventory_equip', { refs: ['compass'] }, { chatId: 'chat-2' })
    expect(carried('chat-2', 'c-viv')).toHaveLength(1)

    expect((await run('inventory_archive', { ref: 'compass', archived: true })).success).toBe(true)
    expect(carried('chat-1', 'c-viv')).toEqual([])
    expect(carried('chat-2', 'c-viv')).toEqual([])
    expect(posted()).toContain('*Vivienne sets down the compass.*')

    const restored = await run('inventory_archive', { ref: 'compass', archived: false })
    expect(restored).toMatchObject({ success: true, result: { changed: true } })
    expect(carried('chat-1', 'c-viv')).toEqual([])
    expect(carried('chat-2', 'c-viv')).toEqual([])
  })

  it('create makes a plain own object and can equip it', async () => {
    const r = await run('inventory_create', { name: 'compass', title: 'The Navigator', equip: true, metadata: { damage: '1d4' } })
    expect(r.success).toBe(true)
    expect(objectsIn('mp-c-viv')[0]).toMatchObject({ name: 'compass', isArchetype: false, canCopy: false, kind: 'item' })
    expect(carried('chat-1', 'c-viv')).toHaveLength(1)
  })
})

describe('inventory_give', () => {
  it('moves the object with its id, drops it from every one of the giver\'s chats, leaves the receiver\'s sets alone, posts its own line', async () => {
    const lantern = await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    addChat('chat-2', ['c-viv', 'c-marcus'])
    await run('inventory_equip', { refs: ['lantern'] })
    await INVENTORY_TOOL_TABLE.inventory_equip({ refs: ['lantern'] }, { userId: 'user-1', chatId: 'chat-2', characterId: 'c-viv' })
    ;(postPascalInventoryChange as jest.Mock).mockClear()
    const containers = newWardrobeTurnContainers()

    const r = await run('inventory_give', { ref: 'lantern', to: 'marcus' }, { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements })
    expect(r.success).toBe(true)
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
    expect(objectsIn('mp-c-marcus').map((o) => o.id)).toEqual([lantern.id])
    expect(carried('chat-1', 'c-viv')).toEqual([])
    expect(carried('chat-2', 'c-viv')).toEqual([])
    expect(carried('chat-1', 'c-marcus')).toEqual([])
    expect(posted()).toEqual(['*Vivienne hands the lantern to Marcus.*'])
  })

  it('leaves the giver carrying it everywhere when the move is refused', async () => {
    const lantern = await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    addChat('chat-2', ['c-viv', 'c-marcus'])
    await run('inventory_equip', { refs: ['lantern'] })
    await run('inventory_equip', { refs: ['lantern'] }, { chatId: 'chat-2' })
    ;(postPascalInventoryChange as jest.Mock).mockClear()
    ;(transferInventoryItem as jest.Mock).mockRejectedValueOnce(new Error('A kit names it and the receiver cannot reach it'))
    const r = await run('inventory_give', { ref: 'lantern', to: 'Marcus' })
    expect(r).toMatchObject({ success: false, error: 'A kit names it and the receiver cannot reach it' })
    expect(objectsIn('mp-c-viv').map((o) => o.id)).toEqual([lantern.id])
    expect(carried('chat-1', 'c-viv')).toEqual([lantern.id])
    expect(carried('chat-2', 'c-viv')).toEqual([lantern.id])
    expect(posted()).toEqual([])
  })

  it('names the receiver by participant id as well as by name', async () => {
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    const r = await run('inventory_give', { ref: 'lantern', to: 'C-MARCUS' })
    expect(r).toMatchObject({ success: true, result: { recipient: { id: 'c-marcus', name: 'Marcus' } } })
  })

  it('an object taken up and then given in one turn is announced only as given', async () => {
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    const containers = newWardrobeTurnContainers()
    const turn = { pendingInventoryAnnouncements: containers.pendingInventoryAnnouncements }
    await run('inventory_equip', { refs: ['lantern'] }, turn)
    await run('inventory_give', { ref: 'lantern', to: 'Marcus' }, turn)
    await flushPendingInventoryAnnouncements(containers, repos())
    expect(posted()).toEqual(['*Vivienne hands the lantern to Marcus.*'])
  })

  it('refuses a shared object, an archived receiver, a non-participant and oneself', async () => {
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'brazier' }))
    await createInventoryItem(repos(), await loc('character', 'c-viv'), body({ name: 'lantern' }))
    addCharacter('c-old', 'Oldwyn', { archived: true })
    state.chats.get('chat-1')!.participants!.push({ id: 'p-old', characterId: 'c-old', type: 'CHARACTER', status: 'active' } as never)

    expect((await run('inventory_give', { ref: 'brazier', to: 'Marcus' })).error).toContain('shared store')
    expect((await run('inventory_give', { ref: 'lantern', to: 'Oldwyn' })).error).toContain('archived')
    expect((await run('inventory_give', { ref: 'lantern', to: 'Nobody' })).error).toContain('No one named')
    expect((await run('inventory_give', { ref: 'lantern', to: 'Vivienne' })).error).toContain('yourself')
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
  })
})

describe('the project roster', () => {
  it("names the closed shelf even when the character's own object shares the archetype's name", async () => {
    const { bow } = await shelfWithBowAndLantern()
    // Vivienne already picked up a bow of her own, then was taken off the roster.
    await pickUpItems(repos(), state.chats.get('chat-1') as never, 'c-viv', [bow.id], { userId: 'user-1', provenance: 'operator', announce: false }, { equip: false })
    putOffRoster('project-1', 'c-viv')
    const pick = await run('inventory_pick_up', { ref: 'magic bow' })
    expect(pick.error).toContain("not on this project's character roster")
    expect(pick.error).not.toContain('not an archetype')
  })

  // The roster closes the shelf, not the hand (lib/inventory/roster-gate.ts).
  async function shelfWithBowAndLantern() {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'magic bow', isArchetype: true }))
    const lantern = await createInventoryItem(repos(), project, body({ name: 'lantern' }))
    return { bow, lantern }
  }

  it('hides the project shelf from an off-roster character, except what they carry', async () => {
    const { lantern } = await shelfWithBowAndLantern()
    // The operator hands Vivienne the lantern; then she is taken off the roster.
    await equipItems(repos(), state.chats.get('chat-1') as never, 'c-viv', [lantern.id], { userId: 'user-1', provenance: 'operator', announce: false })
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'rope' }))
    putOffRoster('project-1', 'c-viv')

    const r = await run('inventory_list', {})
    const names = ((r.result as { items: Array<{ name: string; state: string | null }> }).items).map((i) => `${i.name}:${i.state}`)
    expect(names).toContain('lantern:equipped')
    expect(names.some((n) => n.startsWith('rope'))).toBe(false)
    expect(names.some((n) => n.startsWith('magic bow'))).toBe(false)

    // She can still set the lantern down.
    expect((await run('inventory_unequip', { refs: ['lantern'] })).success).toBe(true)
    expect(carried('chat-1', 'c-viv')).toEqual([])
  })

  it('refuses an off-roster pick-up or equip from the shelf, writing nothing', async () => {
    const { bow, lantern } = await shelfWithBowAndLantern()
    putOffRoster('project-1', 'c-viv')

    const pick = await run('inventory_pick_up', { ref: 'magic bow' })
    expect(pick.success).toBe(false)
    expect(pick.error).toContain("not on this project's character roster")
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
    const equip = await run('inventory_equip', { refs: ['lantern'] })
    expect(equip.success).toBe(false)
    expect(equip.error).toContain('roster')
    expect((await run('inventory_read', { ref: 'lantern' })).error).toContain('roster')

    // Even by id, past the reference resolver, the equip planner refuses.
    const chat = state.chats.get('chat-1') as never
    const ctx = { userId: 'user-1', provenance: 'character' as const, announce: true }
    await expect(equipItems(repos(), chat, 'c-viv', [lantern.id], ctx)).rejects.toMatchObject({ code: 'OFF_ROSTER' })
    await expect(pickUpItems(repos(), chat, 'c-viv', [bow.id], ctx)).rejects.toMatchObject({ code: 'OFF_ROSTER' })
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
    expect(carried('chat-1', 'c-viv')).toEqual([])

    // Marcus is still on the roster; the operator is never gated.
    expect((await run('inventory_pick_up', { ref: 'magic bow' }, { characterId: 'c-marcus' })).success).toBe(true)
    await equipItems(repos(), chat, 'c-viv', [lantern.id], { userId: 'user-1', provenance: 'operator', announce: false })
    expect(carried('chat-1', 'c-viv')).toEqual([lantern.id])
  })
})
