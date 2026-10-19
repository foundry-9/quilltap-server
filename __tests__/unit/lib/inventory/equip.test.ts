/**
 * @jest-environment node
 *
 * Equip, unequip and arrival (spec §5.6) over the in-memory store: the kin
 * cap per (chat, character), kit atomicity and archetype-member
 * instantiation, kit unequip, arrival defaults for each source, the
 * continuation copy, Reset to defaults, and Pascal's one line per gesture.
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
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))

import { logger } from '@/lib/logger'
import { postPascalInventoryChange } from '@/lib/services/pascal/writer'
import { refreshAvatarForAppearance } from '@/lib/wardrobe/outfit-change-effects'
import { addCharacter, getFakeRepos, objectsIn, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem, instantiate } from '@/lib/inventory/item-mutations'
import { equipItems, unequipItems } from '@/lib/inventory/equip'
import { applyInventoryDefaults, resetInventoryToDefaults } from '@/lib/inventory/apply-defaults'
import { describeInventoryChange, flushPendingInventoryAnnouncements, recordPendingInventoryChange } from '@/lib/inventory/equip-effects'
import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { kitState } from '@/lib/inventory/resolve'
import { loadInventoryPool } from '@/lib/inventory/pool'
import { readEquippedSet } from '@/lib/inventory/equipped-set'
import { InventoryCapExceededError, InventoryNotEquippableError } from '@/lib/inventory/errors'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const CTX = { userId: 'user-1', provenance: 'operator' as const, announce: true }
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody

async function loc(scope: 'project' | 'character', id: string): Promise<InventoryLocation> {
  return (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation
}

function addChat(id: string, characterIds: string[], projectId: string | null = 'project-1') {
  state.chats.set(id, { id, projectId, participants: characterIds.map((characterId) => ({ id: `p-${characterId}`, characterId, type: 'CHARACTER', status: 'active' })) })
  return state.chats.get(id)!
}
const carried = (chatId: string, characterId: string) =>
  ((state.chats.get(chatId)?.equippedInventory ?? {}) as Record<string, string[]>)[characterId]

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
})

describe('the kin cap', () => {
  it('is per chat: two of three ring instances in one chat, two again in another', async () => {
    const project = await loc('project', 'project-1')
    const ring = await createInventoryItem(repos(), project, body({ name: 'ring', isArchetype: true, maxEquipped: 2 }))
    const viv = await loc('character', 'c-viv')
    const pool = await loadInventoryPool(repos(), { characterId: 'c-viv', projectId: 'project-1' })
    const rings = []
    for (let i = 0; i < 3; i++) rings.push((await instantiate(repos(), viv, ring.id, { pool })).record.id)

    const chat1 = addChat('chat-1', ['c-viv'])
    await equipItems(repos(), chat1, 'c-viv', [rings[0], rings[1]], CTX)
    await expect(equipItems(repos(), chat1, 'c-viv', [rings[2]], CTX)).rejects.toBeInstanceOf(InventoryCapExceededError)
    await expect(equipItems(repos(), chat1, 'c-viv', [rings[2]], CTX)).rejects.toThrow('at most 2')
    expect(carried('chat-1', 'c-viv')).toHaveLength(2)

    const chat2 = addChat('chat-2', ['c-viv'])
    await equipItems(repos(), chat2, 'c-viv', [rings[2], rings[0]], CTX)
    expect(carried('chat-2', 'c-viv')).toHaveLength(2)
  })

  it('refuses an archetype named directly', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'bow', isArchetype: true }))
    await expect(equipItems(repos(), addChat('chat-1', ['c-viv']), 'c-viv', [bow.id], CTX)).rejects.toBeInstanceOf(InventoryNotEquippableError)
  })
})

describe('kits', () => {
  it("a project kit naming an archetype and two objects: one instance minted, three carried, one line; unequip leaves them, kit reads none", async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'magic bow', isArchetype: true }))
    const cloak = await createInventoryItem(repos(), project, body({ name: 'cloak' }))
    const rope = await createInventoryItem(repos(), project, body({ name: 'rope' }))
    const kit = await createInventoryItem(repos(), project, body({ name: "ranger's loadout", kind: 'kit', itemIds: [bow.id, cloak.id, rope.id] }))
    const chat = addChat('chat-1', ['c-viv'])

    const result = await equipItems(repos(), chat, 'c-viv', [kit.id], CTX)
    expect(result.created).toHaveLength(1)
    expect(result.equipped).toHaveLength(3)
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
    expect(postPascalInventoryChange).toHaveBeenCalledTimes(1)
    expect(refreshAvatarForAppearance).toHaveBeenCalledTimes(1)

    const pool = await loadInventoryPool(repos(), { characterId: 'c-viv', projectId: 'project-1' })
    const equipped = readEquippedSet(state.chats.get('chat-1')!, 'c-viv', pool)
    expect(kitState(pool.resolveId(kit.id)!, equipped, (id) => pool.resolveId(id))).toBe('all')

    await unequipItems(repos(), chat, 'c-viv', [kit.id], CTX)
    expect(carried('chat-1', 'c-viv')).toEqual([])
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
    expect(kitState(pool.resolveId(kit.id)!, [], (id) => pool.resolveId(id))).toBe('none')

    // Re-equipping reuses the instance rather than minting another.
    await equipItems(repos(), chat, 'c-viv', [kit.id], CTX)
    expect(objectsIn('mp-c-viv')).toHaveLength(1)
  })

  it('is atomic: a cap breach anywhere in the kit writes nothing, instances included', async () => {
    const project = await loc('project', 'project-1')
    const bow = await createInventoryItem(repos(), project, body({ name: 'bow', isArchetype: true }))
    const sword1 = await createInventoryItem(repos(), project, body({ name: 'sword' }))
    const sword2 = await createInventoryItem(repos(), project, body({ name: 'Sword' }))
    const kit = await createInventoryItem(repos(), project, body({ name: 'kit', kind: 'kit', itemIds: [bow.id, sword1.id, sword2.id] }))
    const chat = addChat('chat-1', ['c-viv'])
    await expect(equipItems(repos(), chat, 'c-viv', [kit.id], CTX)).rejects.toBeInstanceOf(InventoryCapExceededError)
    expect(objectsIn('mp-c-viv')).toHaveLength(0)
    expect(carried('chat-1', 'c-viv')).toBeUndefined()
    expect(postPascalInventoryChange).not.toHaveBeenCalled()
  })
})

describe('arrival', () => {
  async function signetRing() {
    const viv = await loc('character', 'c-viv')
    return createInventoryItem(repos(), viv, body({ name: 'signet ring', equippedByDefault: true }))
  }

  it('a new chat starts carrying the default, with no announcement', async () => {
    const ring = await signetRing()
    addChat('chat-1', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1' })
    expect(carried('chat-1', 'c-viv')).toEqual([ring.id])
    expect(postPascalInventoryChange).not.toHaveBeenCalled()
  })

  it('a continuation copies the source chat set instead of the defaults', async () => {
    const ring = await signetRing()
    const viv = await loc('character', 'c-viv')
    const lantern = await createInventoryItem(repos(), viv, body({ name: 'lantern' }))
    addChat('chat-1', ['c-viv']).equippedInventory = { 'c-viv': [lantern.id] }
    addChat('chat-2', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-2', ['c-viv'], { source: 'chat-start', userId: 'user-1', sourceChatId: 'chat-1' })
    expect(carried('chat-2', 'c-viv')).toEqual([lantern.id])
    expect(carried('chat-2', 'c-viv')).not.toContain(ring.id)
  })

  it('a returning seat with an entry is not revisited; Reset to defaults restores the default', async () => {
    const ring = await signetRing()
    const chat = addChat('chat-1', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1' })
    await unequipItems(repos(), chat, 'c-viv', [ring.id], CTX)
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'participant-added', userId: 'user-1' })
    expect(carried('chat-1', 'c-viv')).toEqual([])
    await resetInventoryToDefaults(repos(), chat, 'c-viv', 'user-1')
    expect(carried('chat-1', 'c-viv')).toEqual([ring.id])
  })

  it('Reset to defaults holds the chat lock: an equip sent at the same moment is never rewound', async () => {
    const viv = await loc('character', 'c-viv')
    const lantern = await createInventoryItem(repos(), viv, body({ name: 'lantern' }))
    const chat = addChat('chat-1', ['c-viv'])
    // No defaults, so the reset ends with its own empty write — the one that
    // used to land after a concurrent equip and wipe it. The equip is sent the
    // moment the reset clears the entry, and given time to finish if nothing
    // holds it back.
    const setEquipped = (getFakeRepos() as unknown as { chats: { setEquippedInventory: jest.Mock } }).chats.setEquippedInventory
    const original = setEquipped.getMockImplementation() as (...args: unknown[]) => Promise<boolean>
    let equipping: Promise<unknown> | null = null
    setEquipped.mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args)
      if (args[2] === null && !equipping) {
        equipping = equipItems(repos(), chat, 'c-viv', [lantern.id], CTX)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return result
    })
    try {
      await resetInventoryToDefaults(repos(), chat, 'c-viv', 'user-1')
      await equipping
    } finally {
      setEquipped.mockImplementation(original)
    }
    expect(carried('chat-1', 'c-viv')).toEqual([lantern.id])
  })

  it('a cap breach at arrival drops the object with a warn and never fails the arrival', async () => {
    const viv = await loc('character', 'c-viv')
    await createInventoryItem(repos(), viv, body({ name: 'dagger', equippedByDefault: true }))
    await createInventoryItem(repos(), viv, body({ name: 'Dagger', equippedByDefault: true }))
    addChat('chat-1', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'merge', userId: 'user-1' })
    expect(carried('chat-1', 'c-viv')).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('over its cap'), expect.anything())
  })
})

describe("Pascal's line", () => {
  it('names titled objects and gives untitled ones an article', () => {
    const item = (name: string, title?: string) => ({ name, title: title ?? null }) as never
    expect(describeInventoryChange('Vivienne', { equipped: [item('sword', 'Excalibur'), item('signet ring')], unequipped: [] }))
      .toBe('*Vivienne takes up Excalibur and a signet ring.*')
    expect(describeInventoryChange('Vivienne', { equipped: [], unequipped: [item('lantern')] }))
      .toBe('*Vivienne sets down the lantern.*')
    expect(describeInventoryChange('Vivienne', { equipped: [], unequipped: [] })).toBeNull()
  })
})

describe("the turn's pending changes", () => {
  const item = (id: string, name: string) => ({ id, name, title: null }) as never
  const who = { userId: 'user-1', chatId: 'chat-1', characterId: 'c-viv' }

  it('keeps every provenance folded into an entry, and the flush reports them', async () => {
    addCharacter('c-viv', 'Vivienne')
    const { pendingInventoryAnnouncements: pending } = newWardrobeTurnContainers()
    recordPendingInventoryChange(pending, who, { equipped: [item('a', 'rope')], unequipped: [] }, 'pascal')
    recordPendingInventoryChange(pending, who, { equipped: [item('b', 'torch')], unequipped: [] }, 'character')
    recordPendingInventoryChange(pending, who, { equipped: [item('c', 'map')], unequipped: [] }, 'pascal')
    expect(pending.get('chat-1:c-viv')?.provenances).toEqual(['pascal', 'character'])

    await flushPendingInventoryAnnouncements({ pendingInventoryAnnouncements: pending }, getFakeRepos() as never)
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Inventory change effects fired'),
      expect.objectContaining({ provenance: 'pascal' }),
    )
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Drained'),
      expect.objectContaining({ provenances: [{ characterId: 'c-viv', provenances: ['pascal', 'character'] }] }),
    )
  })

  it('nets a pick-up that is set down again out of the pick-ups too', () => {
    const { pendingInventoryAnnouncements: pending } = newWardrobeTurnContainers()
    recordPendingInventoryChange(pending, who, { equipped: [item('t', 'torch')], unequipped: [], pickedUp: [item('t', 'torch')] }, 'character')
    recordPendingInventoryChange(pending, who, { equipped: [], unequipped: [item('t', 'torch')] }, 'character')
    expect(pending.get('chat-1:c-viv')).toMatchObject({ equipped: [], unequipped: [], pickedUp: [] })
  })
})
