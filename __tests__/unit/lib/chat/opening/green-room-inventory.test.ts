/**
 * @jest-environment node
 *
 * The Green Room's inventory pass at arrival, over the in-memory store: what
 * is offered (no archetypes, no archived objects, no closed project shelf),
 * that the choice is equipped silently and wins over a continuation's copy,
 * that an empty-handed choice is kept, and that a failed or timed-out choice
 * falls back to the defaults. The model is mocked.
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
jest.mock('@/lib/inventory/item-images', () => ({ cleanupInventoryItemImages: jest.fn(async () => undefined) }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => ({ id: 'm' })) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))
jest.mock('@/lib/memory/cheap-llm-tasks/inventory-selection', () => ({ chooseLLMInventory: jest.fn() }))
jest.mock('@/lib/chat/opening/green-room/model', () => {
  const actual = jest.requireActual('@/lib/chat/opening/green-room/model')
  return {
    ...actual,
    selectGreenRoomLLM: jest.fn(() => ({ selection: { provider: 'test' }, source: 'cheap' })),
    resolveGreenRoomSubprompts: jest.fn(async () => []),
    withGreenRoomTimeout: jest.fn((work: Promise<unknown>) => work),
  }
})

import { postPascalInventoryChange } from '@/lib/services/pascal/writer'
import { chooseLLMInventory } from '@/lib/memory/cheap-llm-tasks/inventory-selection'
import { GREEN_ROOM_TIMED_OUT, withGreenRoomTimeout } from '@/lib/chat/opening/green-room/model'
import { addCharacter, getFakeRepos, putOffRoster, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem } from '@/lib/inventory/item-mutations'
import { applyInventoryDefaults } from '@/lib/inventory/apply-defaults'
import { greenRoomCandidates } from '@/lib/chat/opening/green-room/inventory'
import type { InventoryCreateBody, ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

const mockChoose = chooseLLMInventory as jest.Mock
const mockTimeout = withGreenRoomTimeout as jest.Mock

const repos = () => getFakeRepos() as never
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

const CHOOSE = { characterIds: ['c-viv'], scenarioText: 'A dinner party at the embassy.' }

/** The ids offered to the model on its last call. */
const offeredIds = () => (mockChoose.mock.calls.at(-1)![0].items as ResolvedInventoryItem[]).map((item) => item.id).sort()

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-viv', 'Vivienne')
  ;(getFakeRepos() as unknown as { connections: unknown }).connections = { findAll: jest.fn(async () => [{ id: 'profile-1' }]) }
  mockTimeout.mockImplementation((work: Promise<unknown>) => work)
})

describe('the Green Room inventory pass', () => {
  it('equips what the character chose, silently, instead of the defaults', async () => {
    const viv = await loc('character', 'c-viv')
    const ring = await createInventoryItem(repos(), viv, body({ name: 'signet ring', equippedByDefault: true }))
    const fan = await createInventoryItem(repos(), viv, body({ name: 'fan' }))
    addChat('chat-1', ['c-viv'])
    mockChoose.mockResolvedValue({ success: true, result: { ids: [fan.id] } })

    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })

    expect(carried('chat-1', 'c-viv')).toEqual([fan.id])
    expect(carried('chat-1', 'c-viv')).not.toContain(ring.id)
    expect(postPascalInventoryChange).not.toHaveBeenCalled()
    expect(mockChoose.mock.calls[0][0].scenarioText).toBe(CHOOSE.scenarioText)
  })

  it('offers no archetypes, no archived objects and nothing from a closed project shelf', async () => {
    const viv = await loc('character', 'c-viv')
    const project = await loc('project', 'project-1')
    const own = await createInventoryItem(repos(), viv, body({ name: 'notebook' }))
    await createInventoryItem(repos(), project, body({ name: 'bow', isArchetype: true }))
    const shelf = await createInventoryItem(repos(), project, body({ name: 'lantern' }))
    addChat('chat-1', ['c-viv'])
    mockChoose.mockResolvedValue({ success: true, result: { ids: [] } })

    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })
    expect(offeredIds()).toEqual([own.id, shelf.id].sort())

    putOffRoster('project-1', 'c-viv')
    addChat('chat-2', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-2', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })
    expect(offeredIds()).toEqual([own.id])
  })

  it('keeps an empty-handed choice', async () => {
    const viv = await loc('character', 'c-viv')
    await createInventoryItem(repos(), viv, body({ name: 'signet ring', equippedByDefault: true }))
    addChat('chat-1', ['c-viv'])
    mockChoose.mockResolvedValue({ success: true, result: { ids: [] } })

    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })
    expect(carried('chat-1', 'c-viv')).toEqual([])
  })

  it('wins over a continuation copy', async () => {
    const viv = await loc('character', 'c-viv')
    const lantern = await createInventoryItem(repos(), viv, body({ name: 'lantern' }))
    const fan = await createInventoryItem(repos(), viv, body({ name: 'fan' }))
    addChat('chat-1', ['c-viv']).equippedInventory = { 'c-viv': [lantern.id] }
    addChat('chat-2', ['c-viv'])
    mockChoose.mockResolvedValue({ success: true, result: { ids: [fan.id] } })

    await applyInventoryDefaults(repos(), 'chat-2', ['c-viv'], { source: 'chat-start', userId: 'user-1', sourceChatId: 'chat-1', choose: CHOOSE })
    expect(carried('chat-2', 'c-viv')).toEqual([fan.id])
  })

  it('falls back to the defaults on a failed choice or a timeout', async () => {
    const viv = await loc('character', 'c-viv')
    const ring = await createInventoryItem(repos(), viv, body({ name: 'signet ring', equippedByDefault: true }))
    addChat('chat-1', ['c-viv'])
    mockChoose.mockResolvedValue({ success: false, error: 'unreadable' })
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })
    expect(carried('chat-1', 'c-viv')).toEqual([ring.id])

    addChat('chat-2', ['c-viv'])
    mockTimeout.mockImplementation(async () => GREEN_ROOM_TIMED_OUT)
    await applyInventoryDefaults(repos(), 'chat-2', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: CHOOSE })
    expect(carried('chat-2', 'c-viv')).toEqual([ring.id])
  })

  it('is not consulted for a character who did not choose, or one who already has an entry', async () => {
    const viv = await loc('character', 'c-viv')
    const ring = await createInventoryItem(repos(), viv, body({ name: 'signet ring', equippedByDefault: true }))
    addChat('chat-1', ['c-viv'])
    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'chat-start', userId: 'user-1', choose: { characterIds: [] } })
    expect(carried('chat-1', 'c-viv')).toEqual([ring.id])

    await applyInventoryDefaults(repos(), 'chat-1', ['c-viv'], { source: 'participant-added', userId: 'user-1', choose: CHOOSE })
    expect(mockChoose).not.toHaveBeenCalled()
  })
})

describe('greenRoomCandidates', () => {
  const item = (fields: Partial<ResolvedInventoryItem>) => ({ id: 'x', name: 'x', kind: 'item', isArchetype: false, archivedAt: null, ...fields }) as ResolvedInventoryItem

  it('keeps kits and plain objects; drops archetypes, archived objects and a closed project shelf', () => {
    const items = [
      item({ id: 'plain' }),
      item({ id: 'kit', kind: 'kit' }),
      item({ id: 'arch', isArchetype: true }),
      item({ id: 'gone', archivedAt: '2026-10-01T00:00:00.000Z' }),
      item({ id: 'shelf', origin: { scope: 'project', id: 'p', name: 'P' } }),
    ]
    expect(greenRoomCandidates(items, true).map((i) => i.id)).toEqual(['plain', 'kit', 'shelf'])
    expect(greenRoomCandidates(items, false).map((i) => i.id)).toEqual(['plain', 'kit'])
  })
})
