/**
 * Custom tools — the wardrobe-effect applier (`lib/pascal/wardrobe-effects.ts`).
 *
 * The real wear-ops front half and the real pool run over a fake chat: the
 * displacement chokepoint is mocked to apply the real pure slot math against
 * an in-memory outfit, so gestures in one run see each other exactly as they
 * do through the chokepoint. What is under test: no character / no pool →
 * nothing; wear by title, by id, archived and slot-mismatch skips; take-off
 * whole vs restricted; a composite coming off by its leaves; clear_slot;
 * per-item fail-soft; one notification, only when something changed; the
 * audit entry shapes; and the `'tool'` source.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/tools/handlers/wardrobe-handler-shared', () => ({
  loadToolPool: jest.fn(),
}))

jest.mock('@/lib/wardrobe/outfit-displacement', () => ({
  applyDisplacement: jest.fn(),
}))

jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({
  notifyWardrobeChanged: jest.fn(),
}))

const { applyWardrobeEffects } = require('@/lib/pascal/wardrobe-effects') as typeof import('@/lib/pascal/wardrobe-effects')
const { buildWearablePool } = require('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool')
const { computeDisplacedSlots } = require('@/lib/wardrobe/slot-ops') as typeof import('@/lib/wardrobe/slot-ops')
const { getRepositories } = require('@/lib/repositories/factory')
const { loadToolPool } = require('@/lib/tools/handlers/wardrobe-handler-shared')
const { applyDisplacement } = require('@/lib/wardrobe/outfit-displacement')
const { notifyWardrobeChanged } = require('@/lib/wardrobe/outfit-change-effects')
const { logger } = require('@/lib/logger')

import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container'
import type { ResolvedWardrobeGesture } from '@/lib/pascal/custom-tools'

const mockLoadToolPool = loadToolPool as jest.Mock
const mockApplyDisplacement = applyDisplacement as jest.Mock
const mockNotify = notifyWardrobeChanged as jest.Mock

const CHAR_ID = 'char-1'
const CHAT_ID = 'chat-1'
const STAMP = '2026-01-01T00:00:00.000Z'
const OWN: WardrobeOrigin = { scope: 'character', id: CHAR_ID, name: '' }

function item(id: string, title: string, types: WardrobeItemType[], extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  } as WardrobeItem
}

const shirt = item('shirt', 'Linen Shirt', ['top'])
const trousers = item('trousers', 'Grey Trousers', ['bottom'])
const boots = item('boots', 'Riding Boots', ['footwear'])
const coat = item('coat', 'Old Coat', ['top'], { archivedAt: STAMP })
const ribbon = item('ribbon', 'Silk Ribbon', ['hair'])
const cloak = item('cloak', 'Cloak of Night', ['top', 'bottom'], { replace: true })
const regalia = item('regalia', 'Regalia', ['top', 'bottom', 'footwear'], {
  componentItemIds: ['shirt', 'trousers', 'boots'],
})

const pool = buildWearablePool(
  CHAR_ID,
  { groupMountPointIds: [], projectMountPointIds: [] },
  {
    own: [shirt, trousers, boots, coat, ribbon, cloak, regalia].map((i) => ({ ...i, origin: OWN })),
    group: [],
    project: [],
    general: [],
  },
)

const empty = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })

/** The fake chat's outfit — what the chokepoint commits and the next gesture reads. */
let stored: EquippedSlots

beforeEach(() => {
  jest.clearAllMocks()
  stored = empty()
  ;(getRepositories as jest.Mock).mockReturnValue({
    chats: { getEquippedOutfitForCharacter: jest.fn(async () => stored) },
    wardrobeWear: {},
  })
  mockLoadToolPool.mockResolvedValue(pool)
  mockApplyDisplacement.mockImplementation(async (_repos, _chatId, _characterId, options) => {
    stored = computeDisplacedSlots(stored, options)
    return stored
  })
})

function gesture(wardrobe: ResolvedWardrobeGesture, index = 0) {
  return { index, wardrobe }
}

function apply(gestures: Array<{ index: number; wardrobe: ResolvedWardrobeGesture }>, overrides: Record<string, unknown> = {}) {
  return applyWardrobeEffects({
    userId: 'user-1',
    chatId: CHAT_ID,
    toolName: 'regalia',
    characterId: CHAR_ID,
    gestures,
    ...overrides,
  })
}

describe('who gets dressed', () => {
  it('dresses nobody for a run nobody made', async () => {
    const applied = await apply([gesture({ action: 'wear', items: ['Linen Shirt'] })], { characterId: null })
    expect(applied).toEqual([])
    expect(mockLoadToolPool).not.toHaveBeenCalled()
    expect(mockApplyDisplacement).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(
      'Custom tool: no rolling character, wardrobe effects skipped',
      expect.objectContaining({ tool: 'regalia' }),
    )
  })

  it('does nothing when the wardrobe cannot be read', async () => {
    mockLoadToolPool.mockRejectedValue(new Error('vault unavailable'))
    const applied = await apply([gesture({ action: 'wear', items: ['Linen Shirt'] })])
    expect(applied).toEqual([])
    expect(mockApplyDisplacement).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it("reads the rolling character's pool once per run", async () => {
    await apply([
      gesture({ action: 'wear', items: ['Linen Shirt'] }, 0),
      gesture({ action: 'wear', items: ['Riding Boots'] }, 1),
    ])
    expect(mockLoadToolPool).toHaveBeenCalledTimes(1)
    expect(mockLoadToolPool).toHaveBeenCalledWith(expect.anything(), CHAT_ID, CHAR_ID)
  })
})

describe('wear', () => {
  it('wears by title and by id, in order, through the chokepoint with the tool source', async () => {
    const applied = await apply([gesture({ action: 'wear', items: ['linen shirt', 'boots'] })])

    expect(stored.top).toEqual(['shirt'])
    expect(stored.footwear).toEqual(['boots'])
    expect(mockApplyDisplacement).toHaveBeenCalledTimes(2)
    for (const call of mockApplyDisplacement.mock.calls) expect(call[4]).toBe('tool')

    expect(applied).toEqual([
      {
        index: 0,
        applied: {
          target: 'wardrobe.wear',
          previous: empty(),
          next: {
            item: { id: 'shirt', title: 'Linen Shirt' },
            slotsAffected: ['top'],
            effect: 'layered',
            slots: { ...empty(), top: ['shirt'] },
          },
        },
      },
      {
        index: 0,
        applied: {
          target: 'wardrobe.wear',
          previous: { ...empty(), top: ['shirt'] },
          next: {
            item: { id: 'boots', title: 'Riding Boots' },
            slotsAffected: ['footwear'],
            effect: 'layered',
            slots: { ...empty(), top: ['shirt'], footwear: ['boots'] },
          },
        },
      },
    ])
  })

  it('honours replace mode and the item replace flag', async () => {
    stored = { ...empty(), top: ['shirt'] }
    const applied = await apply([gesture({ action: 'wear', items: ['Cloak of Night'] })])
    expect(stored.top).toEqual(['cloak'])
    expect((applied[0].applied.next as { effect: string }).effect).toBe('replaced')
  })

  it('layers into one named slot under add_to_slot', async () => {
    const applied = await apply([gesture({ action: 'wear', items: ['Silk Ribbon'], mode: 'add_to_slot', slot: 'hair' })])
    expect(stored.hair).toEqual(['ribbon'])
    expect(applied[0].applied.next).toEqual(expect.objectContaining({ slot: 'hair', slotsAffected: ['hair'] }))
  })

  it("skips an archived garment with bug 191's words, and still wears the rest", async () => {
    const applied = await apply([gesture({ action: 'wear', items: ['Old Coat', 'Linen Shirt'] })])
    expect(applied.map((a) => (a.applied.next as { item: { id: string } }).item.id)).toEqual(['shirt'])
    expect(logger.debug).toHaveBeenCalledWith(
      'Custom tool wardrobe effect not applied',
      expect.objectContaining({ reason: expect.stringMatching(/archived/i), reference: 'Old Coat' }),
    )
  })

  it('skips an item that is not in the pool, or does not cover the add_to_slot slot', async () => {
    const applied = await apply([
      gesture({ action: 'wear', items: ['Invisible Cloak'] }, 0),
      gesture({ action: 'wear', items: ['Riding Boots'], mode: 'add_to_slot', slot: 'hair' }, 1),
    ])
    expect(applied).toEqual([])
    expect(mockApplyDisplacement).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('wears an outfit (a composite) whole', async () => {
    await apply([gesture({ action: 'wear', items: ['Regalia'] })])
    expect(mockApplyDisplacement.mock.calls[0][3]).toEqual(
      expect.objectContaining({ mode: 'wear', item: expect.objectContaining({ id: 'regalia' }), itemsById: pool.byId }),
    )
    // Dissolved into its leaves on the way on.
    expect(stored).toEqual(expect.objectContaining({ top: ['shirt'], bottom: ['trousers'], footwear: ['boots'] }))
  })
})

describe('take_off', () => {
  it('takes a garment off every slot it covers, other layers staying', async () => {
    stored = { ...empty(), top: ['shirt', 'cloak'], bottom: ['cloak'] }
    const applied = await apply([gesture({ action: 'take_off', items: ['Cloak of Night'] })])
    expect(stored).toEqual({ ...empty(), top: ['shirt'], bottom: [] })
    expect(applied[0].applied).toEqual({
      target: 'wardrobe.take_off',
      previous: { ...empty(), top: ['shirt', 'cloak'], bottom: ['cloak'] },
      next: {
        item: { id: 'cloak', title: 'Cloak of Night' },
        slotsAffected: ['top', 'bottom'],
        effect: 'removed',
        slots: { ...empty(), top: ['shirt'], bottom: [] },
      },
    })
  })

  it('restricts the removal to one named slot', async () => {
    stored = { ...empty(), top: ['cloak'], bottom: ['cloak'] }
    const applied = await apply([gesture({ action: 'take_off', items: ['cloak'], slot: 'top' })])
    expect(stored).toEqual({ ...empty(), top: [], bottom: ['cloak'] })
    expect(applied[0].applied.next).toEqual(expect.objectContaining({ slot: 'top', slotsAffected: ['top'] }))
  })

  it('takes a worn outfit off by its leaves', async () => {
    await apply([gesture({ action: 'wear', items: ['Regalia'] }, 0)])
    stored = { ...stored, hair: ['ribbon'] }
    mockApplyDisplacement.mockClear()

    const applied = await apply([gesture({ action: 'take_off', items: ['Regalia'] }, 1)])
    expect(stored).toEqual({ ...empty(), hair: ['ribbon'] })
    expect(mockApplyDisplacement.mock.calls.map((c) => c[3])).toEqual([
      { mode: 'remove_from_slot', slot: 'top', itemId: 'shirt' },
      { mode: 'remove_from_slot', slot: 'bottom', itemId: 'trousers' },
      { mode: 'remove_from_slot', slot: 'footwear', itemId: 'boots' },
    ])
    expect(applied[0].applied.next).toEqual(
      expect.objectContaining({ slotsAffected: ['top', 'bottom', 'footwear'], effect: 'removed' }),
    )
  })

  it('may take off an archived item — archiving never undresses anyone', async () => {
    stored = { ...empty(), top: ['coat'] }
    const applied = await apply([gesture({ action: 'take_off', items: ['Old Coat'] })])
    expect(stored.top).toEqual([])
    expect(applied).toHaveLength(1)
  })

  it('records nothing, and announces nothing, when the item was not on', async () => {
    const applied = await apply([gesture({ action: 'take_off', items: ['Linen Shirt', 'Regalia'] })])
    expect(applied).toEqual([])
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

describe('clear_slot', () => {
  it('empties one slot through the chokepoint', async () => {
    stored = { ...empty(), hair: ['ribbon'], top: ['shirt'] }
    const applied = await apply([gesture({ action: 'clear_slot', items: [], slot: 'hair' }, 2)])
    expect(mockApplyDisplacement).toHaveBeenCalledWith(expect.anything(), CHAT_ID, CHAR_ID, { mode: 'clear_slot', slot: 'hair' })
    expect(applied).toEqual([
      {
        index: 2,
        applied: {
          target: 'wardrobe.clear_slot',
          previous: { ...empty(), hair: ['ribbon'], top: ['shirt'] },
          next: { slot: 'hair', slotsAffected: ['hair'], effect: 'cleared', slots: { ...empty(), top: ['shirt'] } },
        },
      },
    ])
  })
})

describe('fail-soft and the announcement', () => {
  it('drops a change whose commit throws and carries on with the rest', async () => {
    mockApplyDisplacement.mockImplementationOnce(async () => {
      throw new Error('disk on fire')
    })
    const applied = await apply([gesture({ action: 'wear', items: ['Linen Shirt', 'Riding Boots'] })])
    expect(applied.map((a) => (a.applied.next as { item: { id: string } }).item.id)).toEqual(['boots'])
    expect(logger.warn).toHaveBeenCalledWith(
      'Custom tool wardrobe effect failed; that change was dropped',
      expect.objectContaining({ item: 'Linen Shirt', error: 'disk on fire' }),
    )
  })

  it('notifies once after the loop, joining the turn when there is a turn', async () => {
    const pending = new Set<string>()
    const history = new Map()
    await apply(
      [
        gesture({ action: 'wear', items: ['Linen Shirt', 'Riding Boots'] }, 0),
        gesture({ action: 'clear_slot', items: [], slot: 'footwear' }, 1),
      ],
      { pendingWardrobeAnnouncements: pending, pendingWardrobeHistory: history },
    )
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: 'user-1', chatId: CHAT_ID, characterId: CHAR_ID,
        provenance: { source: 'pascal', actorCharacterId: CHAR_ID, toolName: 'regalia' },
        pendingWardrobeAnnouncements: pending,
        pendingWardrobeHistory: history,
      },
      'pascal.wardrobe-effects',
    )
  })

  it('notifies without a set outside a model turn', async () => {
    await apply([gesture({ action: 'wear', items: ['Linen Shirt'] })])
    expect(mockNotify).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'user-1', chatId: CHAT_ID, characterId: CHAR_ID, provenance: { source: 'pascal', actorCharacterId: CHAR_ID, toolName: 'regalia' } },
      'pascal.wardrobe-effects',
    )
  })
})
