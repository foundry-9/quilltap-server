/**
 * @jest-environment node
 *
 * "Measure Twice" — the first inventory-gated custom tool, end to end over the
 * in-memory Inventory store. The definition is parsed by the real schema, the
 * invoker's bag is loaded by the real `loadInventoryContext`, and the gate is
 * the real `evaluateToolGate`:
 *
 *   (a) a gate keyed on an instance's TITLE opens for the character carrying it;
 *   (b) it stays closed for a character carrying a different instance of the
 *       same archetype (the title rule wins over the name rule);
 *   (c) with no context, `availableWhen` stays closed — `eq: "equipped"` and
 *       `inventoryCount` `lt: 1` alike.
 *
 * Plus the run itself: the title (apostrophe and all) and a metadata value
 * render into the outcome message through `{{inventory.<ref>.<field>}}`.
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

import { addCharacter, getFakeRepos, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem, instantiate } from '@/lib/inventory/item-mutations'
import { loadInventoryPool } from '@/lib/inventory/pool'
import { equipItems } from '@/lib/inventory/equip'
import { loadInventoryContext } from '@/lib/inventory/context'
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'
import { evaluateToolGate } from '@/lib/pascal/tool-gate'
import { executeCustomTool } from '@/lib/pascal/custom-tools'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const TITLE = "Friday's Yellow Tape Measure"

const MEASURE_TWICE = QtapCustomToolSchema.parse({
  name: 'measure_twice',
  description:
    'Take the tape measure off the belt and check a measurement. Small household tool; primary purpose is live-testing inventory-gated custom tools end to end.',
  availableWhen: { inventory: { [TITLE]: { eq: 'equipped' } } },
  roll: '1d20',
  outcomes: [
    {
      when: true,
      state: 'info',
      message: `{{character}} unclips {{inventory.${TITLE}.title}} — {{inventory.${TITLE}.metadata.length_feet}} feet of yellow steel. The tape agrees with itself: {{roll}}. Measured twice.`,
    },
  ],
})

const repos = () => getFakeRepos() as never
const CTX = { userId: 'user-1', provenance: 'operator' as const, announce: false }
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody
const loc = async (scope: 'project' | 'character', id: string) =>
  (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation

/** Each character gets an instance of the project's `tape measure` archetype, and carries it. */
async function seed(): Promise<void> {
  const archetype = await createInventoryItem(
    repos(),
    await loc('project', 'project-1'),
    body({ name: 'tape measure', isArchetype: true, metadata: { length_feet: 16 } }),
  )
  const chat = state.chats.get('chat-1')!
  for (const [characterId, overrides] of [
    ['c-friday', { title: TITLE, metadata: { length_feet: 25 } }],
    ['c-other', {}],
  ] as const) {
    const pool = await loadInventoryPool(repos(), { characterId, projectId: 'project-1' })
    const { record } = await instantiate(repos(), await loc('character', characterId), archetype.id, { pool, overrides })
    await equipItems(repos(), state.chats.get('chat-1') ?? chat, characterId, [record.id], CTX)
  }
}

beforeEach(async () => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-friday', 'Friday')
  addCharacter('c-other', 'Ottoline')
  state.chats.set('chat-1', {
    id: 'chat-1',
    projectId: 'project-1',
    participants: [
      { id: 'p-friday', characterId: 'c-friday', type: 'CHARACTER', status: 'active' },
      { id: 'p-other', characterId: 'c-other', type: 'CHARACTER', status: 'active' },
    ],
  })
  await seed()
})

describe('measure_twice — a title-keyed equipped gate', () => {
  it('(a) opens for the character carrying the titled instance', async () => {
    const bag = await loadInventoryContext(repos(), 'c-friday', 'chat-1')
    expect(bag.state(TITLE)).toBe('equipped')
    expect(evaluateToolGate(MEASURE_TWICE, {}, undefined, bag)).toEqual({ available: true })
  })

  it('(b) stays closed for a character carrying a different instance of the same archetype', async () => {
    const bag = await loadInventoryContext(repos(), 'c-other', 'chat-1')
    // The kind name still resolves for them — the title does not.
    expect(bag.state('tape measure')).toBe('equipped')
    expect(bag.state(TITLE)).toBe('absent')
    expect(evaluateToolGate(MEASURE_TWICE, {}, undefined, bag)).toEqual({ available: false, withheldBy: 'availableWhen' })
  })

  it('(c) with no context, availableWhen stays closed — eq: "equipped" and lt: 1 alike', () => {
    expect(evaluateToolGate(MEASURE_TWICE, {}, undefined, null)).toEqual({ available: false, withheldBy: 'availableWhen' })
    const countGate = QtapCustomToolSchema.parse({
      ...MEASURE_TWICE,
      availableWhen: { inventoryCount: { [TITLE]: { lt: 1 } } },
    })
    expect(evaluateToolGate(countGate, {}, undefined, null)).toEqual({ available: false, withheldBy: 'availableWhen' })
  })

  it('renders the apostrophed title and a metadata value into the outcome message', async () => {
    const bag = await loadInventoryContext(repos(), 'c-friday', 'chat-1')
    const result = await executeCustomTool(MEASURE_TWICE, null, { character: 'Friday', inventory: bag })
    expect(result.message).toMatch(
      /^Friday unclips Friday's Yellow Tape Measure — 25 feet of yellow steel\. The tape agrees with itself: (\d+)\. Measured twice\.$/,
    )
    const rolled = Number(result.message.match(/itself: (\d+)\./)![1])
    expect(rolled).toBeGreaterThanOrEqual(1)
    expect(rolled).toBeLessThanOrEqual(20)
  })
})

/**
 * Kind-name matching (ansible migration prep) — `resolveInventoryRef` tries
 * id, then title, then name, each round over the WHOLE pool; a round that
 * matches nothing (not just nothing for this item) falls through to the
 * next. So a gate keyed on a kind's plain `name` opens for an untitled
 * instance of it, and — since the titled instance's own title is not the
 * string the gate is testing — the title round comes up empty pool-wide and
 * the name round catches it too, title or no title.
 */
const probe = (availableWhen: unknown) =>
  QtapCustomToolSchema.parse({
    name: 'probe',
    description: 'A minimal tool definition for exercising one gate shape.',
    availableWhen,
    outcomes: [{ when: true, message: 'ok', state: 'success' }],
  })

describe('inventory gate — kind-name matching', () => {
  it('(a) an untitled instance matches a gate keyed on its kind name', async () => {
    const archetype = await createInventoryItem(
      repos(),
      await loc('project', 'project-1'),
      body({ name: 'ansible resonator', isArchetype: true }),
    )
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record } = await instantiate(repos(), await loc('character', 'c-friday'), archetype.id, { pool })
    await equipItems(repos(), state.chats.get('chat-1')!, 'c-friday', [record.id], CTX)

    const bag = await loadInventoryContext(repos(), 'c-friday', 'chat-1')
    const tool = probe({ inventory: { 'ansible resonator': { eq: 'equipped' } } })
    expect(evaluateToolGate(tool, {}, undefined, bag)).toEqual({ available: true })
  })

  it('(b) a TITLED instance of the same kind still matches the kind-name gate via the name fallback', async () => {
    const archetype = await createInventoryItem(
      repos(),
      await loc('project', 'project-1'),
      body({ name: 'ansible resonator', isArchetype: true }),
    )
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record } = await instantiate(repos(), await loc('character', 'c-friday'), archetype.id, {
      pool,
      overrides: { title: "Charlie's Resonator" },
    })
    await equipItems(repos(), state.chats.get('chat-1')!, 'c-friday', [record.id], CTX)

    const bag = await loadInventoryContext(repos(), 'c-friday', 'chat-1')
    // The title-keyed gate still works...
    const titleTool = probe({ inventory: { "Charlie's Resonator": { eq: 'equipped' } } })
    expect(evaluateToolGate(titleTool, {}, undefined, bag)).toEqual({ available: true })
    // ...and so does the kind-name gate, even though this instance has a title.
    const kindTool = probe({ inventory: { 'ansible resonator': { eq: 'equipped' } } })
    expect(evaluateToolGate(kindTool, {}, undefined, bag)).toEqual({ available: true })
  })

  it('(c) two devices, two surfaces: a character sees exactly the kind-gated tools they carry', async () => {
    const resonatorArchetype = await createInventoryItem(
      repos(),
      await loc('project', 'project-1'),
      body({ name: 'ansible resonator', isArchetype: true }),
    )
    const walkieArchetype = await createInventoryItem(
      repos(),
      await loc('project', 'project-1'),
      body({ name: 'ansible walkie-talkie', isArchetype: true }),
    )
    const resonatorPool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record: resonator } = await instantiate(repos(), await loc('character', 'c-friday'), resonatorArchetype.id, {
      pool: resonatorPool,
    })
    const walkiePool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record: walkie } = await instantiate(repos(), await loc('character', 'c-friday'), walkieArchetype.id, {
      pool: walkiePool,
    })
    await equipItems(repos(), state.chats.get('chat-1')!, 'c-friday', [resonator.id, walkie.id], CTX)

    const bag = await loadInventoryContext(repos(), 'c-friday', 'chat-1')
    const resonatorGated = probe({ inventory: { 'ansible resonator': { eq: 'equipped' } } })
    const walkieGated = probe({ inventory: { 'ansible walkie-talkie': { eq: 'equipped' } } })
    const spyglassGated = probe({ inventory: { 'ansible spyglass': { eq: 'equipped' } } })

    expect(evaluateToolGate(resonatorGated, {}, undefined, bag)).toEqual({ available: true })
    expect(evaluateToolGate(walkieGated, {}, undefined, bag)).toEqual({ available: true })
    expect(evaluateToolGate(spyglassGated, {}, undefined, bag)).toEqual({ available: false, withheldBy: 'availableWhen' })
  })
})
