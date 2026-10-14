/**
 * slot-ops — the pure math of putting things on and taking them off, plus the
 * persisted `applyDisplacement` wrapper that commits it through the wear
 * ledger. (Formerly dissolve-bundles.test.ts.)
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const {
  addItemToSlot,
  computeDisplacedSlots,
  dissolveCompositeToLeaves,
  dissolveCompositesInSlots,
  layLeavesIntoSlots,
  wearItemIntoSlots,
  wornBundlesFor,
} = require('@/lib/wardrobe/slot-ops')
const { applyDisplacement } = require('@/lib/wardrobe/outfit-displacement')
const { isComposite } = require('@/lib/schemas/wardrobe.types')

import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { ledgerOver } from '@/__tests__/helpers/wardrobe-wear-ledger'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(
  id: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
  extra: Partial<WardrobeItem> = {},
): WardrobeItem {
  return {
    id,
    characterId: 'c1c1c1c1-0000-0000-0000-000000000001',
    title: id,
    types,
    componentItemIds,
    isDefault: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  } as WardrobeItem
}

function buildMap(items: WardrobeItem[]): Map<string, WardrobeItem> {
  return new Map(items.map((i) => [i.id, i]))
}

const empty = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })

// "Man in Black": a four-slot bundle over four single-slot garments.
const shirt = makeItem('shirt', ['top'])
const trousers = makeItem('trousers', ['bottom'])
const boots = makeItem('boots', ['footwear'])
const gloves = makeItem('gloves', ['accessories'])
const manInBlack = makeItem(
  'man-in-black',
  ['top', 'bottom', 'footwear', 'accessories'],
  ['shirt', 'trousers', 'boots', 'gloves'],
)
const WARDROBE = buildMap([shirt, trousers, boots, gloves, manInBlack])

describe('isComposite', () => {
  it('is true only when the item has components', () => {
    expect(isComposite(manInBlack)).toBe(true)
    expect(isComposite(shirt)).toBe(false)
    expect(isComposite({ id: 'x', types: ['top'] })).toBe(false)
  })
})

describe('dissolveCompositeToLeaves', () => {
  it('expands a bundle into its parts with the slots each covers', () => {
    expect(dissolveCompositeToLeaves(manInBlack, WARDROBE)).toEqual([
      { id: 'shirt', slots: ['top'] },
      { id: 'trousers', slots: ['bottom'] },
      { id: 'boots', slots: ['footwear'] },
      { id: 'gloves', slots: ['accessories'] },
    ])
  })

  it('walks all the way to leaves, so a nested bundle dissolves too', () => {
    const jewelry = makeItem('jewelry', ['accessories'], ['locket', 'ring'])
    const locket = makeItem('locket', ['accessories'])
    const ring = makeItem('ring', ['accessories'])
    const gala = makeItem('gala', ['top', 'accessories'], ['gown', 'jewelry'])
    const gown = makeItem('gown', ['top', 'bottom'])
    const map = buildMap([jewelry, locket, ring, gala, gown])

    expect(dissolveCompositeToLeaves(gala, map)).toEqual([
      { id: 'gown', slots: ['top', 'bottom'] },
      { id: 'locket', slots: ['accessories'] },
      { id: 'ring', slots: ['accessories'] },
    ])
  })

  it('returns null for a plain garment', () => {
    expect(dissolveCompositeToLeaves(shirt, WARDROBE)).toBeNull()
  })

  it('returns null when no lookup is supplied', () => {
    expect(dissolveCompositeToLeaves(manInBlack, undefined)).toBeNull()
  })

  it('returns null when not one component resolves, so the bundle is worn whole', () => {
    const orphan = makeItem('orphan', ['top'], ['nowhere-1', 'nowhere-2'])
    expect(dissolveCompositeToLeaves(orphan, buildMap([orphan]))).toBeNull()
  })

  it('drops a component that points back at its own bundle', () => {
    const selfish = makeItem('selfish', ['top'], ['selfish', 'shirt'])
    const map = buildMap([selfish, shirt])
    expect(dissolveCompositeToLeaves(selfish, map)).toEqual([{ id: 'shirt', slots: ['top'] }])
  })

  it('skips parts that cover no recognized slot', () => {
    const junk = makeItem('junk', ['hat' as WardrobeItemType])
    const bundle = makeItem('bundle', ['top'], ['shirt', 'junk'])
    const map = buildMap([shirt, junk, bundle])
    expect(dissolveCompositeToLeaves(bundle, map)).toEqual([{ id: 'shirt', slots: ['top'] }])
  })
})

describe('layLeavesIntoSlots', () => {
  const leaves = [
    { id: 'shirt', slots: ['top'] as WardrobeItemType[] },
    { id: 'boots', slots: ['footwear'] as WardrobeItemType[] },
  ]

  it('layers parts over what is already worn when not replacing', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: ['sandals'], accessories: [], hair: [] }
    expect(
      layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: false }),
    ).toEqual({
      top: ['vest', 'shirt'],
      bottom: [],
      footwear: ['sandals', 'boots'],
      accessories: [],
      hair: [],
    })
  })

  it('clears the slots it lands in when replacing', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: ['skirt'], footwear: ['sandals'], accessories: ['hat'], hair: [] }
    expect(
      layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: true }),
    ).toEqual({ top: ['shirt'], bottom: [], footwear: ['boots'], accessories: [], hair: [] })
  })

  it('replacing also clears slots the bundle itself does not claim', () => {
    // The bundle nominally covers top only, but brings boots along. The boots
    // should swap the sandals rather than layer over them.
    const topOnly = makeItem('top-only', ['top'], ['shirt', 'boots'])
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: ['sandals'], accessories: [], hair: [] }
    expect(
      layLeavesIntoSlots(worn, topOnly, leaves, { clearCoveredSlots: true }),
    ).toEqual({ top: ['shirt'], bottom: [], footwear: ['boots'], accessories: [], hair: [] })
  })

  it('does not duplicate a part already worn', () => {
    const worn: EquippedSlots = { top: ['shirt'], bottom: [], footwear: [], accessories: [], hair: [] }
    const result = layLeavesIntoSlots(worn, manInBlack, leaves, { clearCoveredSlots: false })
    expect(result.top).toEqual(['shirt'])
  })
})

describe('wearItemIntoSlots with a bundle', () => {
  it('stores the parts, never the bundle id', () => {
    const result = wearItemIntoSlots(empty(), manInBlack, WARDROBE)
    expect(result).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
      hair: [],
    })
    expect(JSON.stringify(result)).not.toContain('man-in-black')
  })

  it('layers the parts over what is worn by default', () => {
    const worn: EquippedSlots = { top: ['vest'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(wearItemIntoSlots(worn, manInBlack, WARDROBE).top).toEqual(['vest', 'shirt'])
  })

  it('honours the replace flag — the parts swap what was there', () => {
    const replacing = makeItem(
      'man-in-black',
      ['top', 'bottom', 'footwear', 'accessories'],
      ['shirt', 'trousers', 'boots', 'gloves'],
      { replace: true } as Partial<WardrobeItem>,
    )
    const worn: EquippedSlots = { top: ['vest'], bottom: ['skirt'], footwear: ['sandals'], accessories: ['hat'], hair: [] }
    expect(wearItemIntoSlots(worn, replacing, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
      hair: [],
    })
  })

  it('falls back to storing the bundle whole without a lookup', () => {
    expect(wearItemIntoSlots(empty(), manInBlack)).toEqual({
      top: ['man-in-black'],
      bottom: ['man-in-black'],
      footwear: ['man-in-black'],
      accessories: ['man-in-black'],
      hair: [],
    })
  })

  it('leaves plain garments alone', () => {
    expect(wearItemIntoSlots(empty(), shirt, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })
})

describe("computeDisplacedSlots({ mode: 'replace' }) with a bundle", () => {
  it('clears the slots and stores the parts', () => {
    const worn: EquippedSlots = { top: ['vest', 'coat'], bottom: ['skirt'], footwear: [], accessories: [], hair: [] }
    expect(computeDisplacedSlots(worn, { mode: 'replace', item: manInBlack, itemsById: WARDROBE })).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
      hair: [],
    })
  })
})

describe('addItemToSlot with a bundle', () => {
  it('adds only the parts covering the named slot', () => {
    expect(addItemToSlot(empty(), 'top', manInBlack, WARDROBE)).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    })
  })

  it('falls back to the bundle id when no part covers the slot', () => {
    const topOnly = makeItem('top-only', ['top', 'bottom'], ['shirt'])
    const map = buildMap([shirt, topOnly])
    expect(addItemToSlot(empty(), 'bottom', topOnly, map).bottom).toEqual(['top-only'])
  })
})

describe('applyDisplacement (persisted)', () => {
  const CHAT = 'chat-1'
  const CHAR = 'c1c1c1c1-0000-0000-0000-000000000001'

  function makeRepos(initial: EquippedSlots = empty()) {
    let stored: EquippedSlots = initial
    const chats = {
      getEquippedOutfitForCharacter: jest.fn(async () => stored),
      setEquippedOutfit: jest.fn(async (_c: string, _ch: string, slots: EquippedSlots) => {
        stored = slots
        return slots
      }),
    }
    const wardrobeWear = ledgerOver(chats)
    return { repos: { chats, wardrobeWear }, wardrobeWear, read: () => stored }
  }

  it('dissolves a composite through the pool lookup and credits it as worn', async () => {
    const { repos, wardrobeWear, read } = makeRepos()

    const result = await applyDisplacement(
      repos,
      CHAT,
      CHAR,
      { mode: 'wear', item: manInBlack, itemsById: WARDROBE },
      'tool',
    )

    expect(result).toEqual({
      top: ['shirt'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
      hair: [],
    })
    expect(read()).toEqual(result)
    expect(wardrobeWear.commitEquippedOutfit).toHaveBeenCalledWith({
      chatId: CHAT,
      characterId: CHAR,
      nextSlots: result,
      wornBundles: [{ id: 'man-in-black', leafIds: ['shirt', 'trousers', 'boots', 'gloves'] }],
      source: 'tool',
    })
  })

  it('claims no composite credit for a plain garment', async () => {
    const { repos, wardrobeWear } = makeRepos()
    await applyDisplacement(repos, CHAT, CHAR, { mode: 'wear', item: shirt, itemsById: WARDROBE })
    expect(wardrobeWear.commitEquippedOutfit.mock.calls[0][0]).toMatchObject({ wornBundles: [], source: 'ui' })
  })

  it('stores the composite whole when no lookup is supplied', async () => {
    const { repos } = makeRepos()
    const result = await applyDisplacement(repos, CHAT, CHAR, { mode: 'wear', item: manInBlack })
    expect(result.top).toEqual(['man-in-black'])
  })

  it.each(['remove_from_slot', 'clear_slot'] as const)('commits %s as a take-off whatever source is passed', async (mode) => {
    const { repos, wardrobeWear, read } = makeRepos({ ...empty(), top: ['vest', 'shirt'] })
    await applyDisplacement(repos, CHAT, CHAR, { mode, slot: 'top', itemId: 'shirt' }, 'tool')
    expect(wardrobeWear.commitEquippedOutfit.mock.calls[0][0].source).toBe('take-off')
    expect(read().top).toEqual(mode === 'clear_slot' ? [] : ['vest'])
  })

  it('starts from empty slots when the character has none in the chat', async () => {
    const { repos } = makeRepos()
    repos.chats.getEquippedOutfitForCharacter.mockResolvedValueOnce(null as unknown as EquippedSlots)
    const result = await applyDisplacement(repos, CHAT, CHAR, { mode: 'add_to_slot', item: shirt, slot: 'top' })
    expect(result).toEqual({ ...empty(), top: ['shirt'] })
  })
})

describe('wornBundlesFor', () => {
  it('names the composite and the leaves it dissolved into', () => {
    expect(wornBundlesFor(manInBlack, WARDROBE)).toEqual([
      { id: 'man-in-black', leafIds: ['shirt', 'trousers', 'boots', 'gloves'] },
    ])
  })

  it('narrows to the leaves covering one slot', () => {
    expect(wornBundlesFor(manInBlack, WARDROBE, 'footwear')).toEqual([{ id: 'man-in-black', leafIds: ['boots'] }])
  })

  it('claims nothing for a leaf or an unresolvable composite', () => {
    expect(wornBundlesFor(shirt, WARDROBE)).toEqual([])
    expect(wornBundlesFor(manInBlack, undefined)).toEqual([])
  })
})

describe('computeDisplacedSlots take-off modes', () => {
  const worn: EquippedSlots = { top: ['vest', 'shirt'], bottom: ['skirt'], footwear: [], accessories: [], hair: [] }

  it('remove_from_slot takes one id out of one slot', () => {
    expect(computeDisplacedSlots(worn, { mode: 'remove_from_slot', slot: 'top', itemId: 'vest' }).top).toEqual(['shirt'])
  })

  it('remove_from_slot without an id clears the slot', () => {
    expect(computeDisplacedSlots(worn, { mode: 'remove_from_slot', slot: 'top' }).top).toEqual([])
  })

  it('clear_slot empties one slot and leaves the rest', () => {
    const next = computeDisplacedSlots(worn, { mode: 'clear_slot', slot: 'top' })
    expect(next).toEqual({ ...worn, top: [] })
    expect(worn.top).toEqual(['vest', 'shirt'])
  })
})

describe('dissolveCompositesInSlots', () => {
  it('substitutes a bundle in place, preserving layering order', () => {
    const worn: EquippedSlots = {
      top: ['undershirt', 'man-in-black', 'scarf'],
      bottom: ['man-in-black'],
      footwear: ['man-in-black'],
      accessories: ['man-in-black'],
      hair: [],
    }
    expect(dissolveCompositesInSlots(worn, WARDROBE).slots).toEqual({
      top: ['undershirt', 'shirt', 'scarf'],
      bottom: ['trousers'],
      footwear: ['boots'],
      accessories: ['gloves'],
      hair: [],
    })
  })

  it('routes a part into a slot the bundle never occupied', () => {
    const hat = makeItem('hat', ['accessories'])
    const kit = makeItem('kit', ['top'], ['shirt', 'hat'])
    const map = buildMap([shirt, hat, kit])
    const worn: EquippedSlots = { top: ['kit'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(dissolveCompositesInSlots(worn, map).slots).toEqual({
      top: ['shirt'],
      bottom: [],
      footwear: [],
      accessories: ['hat'],
      hair: [],
    })
  })

  it('returns the snapshot untouched when nothing is a bundle', () => {
    const worn: EquippedSlots = { top: ['shirt'], bottom: ['trousers'], footwear: [], accessories: [], hair: [] }
    const result = dissolveCompositesInSlots(worn, WARDROBE)
    expect(result.slots).toBe(worn)
    expect(result.wornBundles).toEqual([])
  })

  it('leaves an unresolvable bundle in place', () => {
    const orphan = makeItem('orphan', ['top'], ['nowhere'])
    const worn: EquippedSlots = { top: ['orphan'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(dissolveCompositesInSlots(worn, buildMap([orphan])).slots.top).toEqual(['orphan'])
  })

  it('reports each dissolved composite and its leaves for the ledger', () => {
    const worn: EquippedSlots = { top: ['man-in-black'], bottom: [], footwear: [], accessories: [], hair: [] }
    expect(dissolveCompositesInSlots(worn, WARDROBE).wornBundles).toEqual([
      { id: 'man-in-black', leafIds: ['shirt', 'trousers', 'boots', 'gloves'] },
    ])
  })

  it('restricted by `only`, dissolves just the named composite', () => {
    const hat = makeItem('hat', ['accessories'])
    const kit = makeItem('kit', ['accessories'], ['hat'])
    const map = buildMap([shirt, trousers, boots, gloves, manInBlack, hat, kit])
    const worn: EquippedSlots = { top: ['man-in-black'], bottom: [], footwear: [], accessories: ['kit'], hair: [] }
    const result = dissolveCompositesInSlots(worn, map, new Set(['kit']))
    expect(result.slots.top).toEqual(['man-in-black'])
    expect(result.slots.accessories).toEqual(['hat'])
    expect(result.wornBundles).toEqual([{ id: 'kit', leafIds: ['hat'] }])
  })
})
