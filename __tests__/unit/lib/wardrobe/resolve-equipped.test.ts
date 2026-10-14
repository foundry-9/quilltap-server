/**
 * resolveEquippedOutfitForCharacter — a pure walk over the character's
 * wearable pool. The pool already holds every tier (character, group, project,
 * General, archived included), so resolution does no I/O of its own.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const { resolveEquippedOutfitForCharacter } =
  require('@/lib/wardrobe/resolve-equipped') as typeof import('@/lib/wardrobe/resolve-equipped')
const { buildWearablePool } = require('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool')

import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemWithOrigin, WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container'

const NOW = '2026-01-01T00:00:00.000Z'
const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

const OWN: WardrobeOrigin = { scope: 'character', id: CHAR_ID, name: '' }
const GROUP: WardrobeOrigin = { scope: 'group', id: 'g1', name: 'The Guild' }
const PROJECT: WardrobeOrigin = { scope: 'project', id: 'p1', name: 'The Manor' }
const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' }

function makeItem(
  id: string,
  title: string,
  types: WardrobeItemType[],
  componentItemIds: string[] = [],
): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title,
    types,
    componentItemIds,
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const tag = (items: WardrobeItem[], origin: WardrobeOrigin, characterId: string | null = null): WardrobeItemWithOrigin[] =>
  items.map((i) => ({ ...i, characterId, origin }))

/** A pool where every item is the character's own. */
function ownPool(items: WardrobeItem[]) {
  return buildWearablePool(
    CHAR_ID,
    { groupMountPointIds: [], projectMountPointIds: [] },
    { own: tag(items, OWN, CHAR_ID), group: [], project: [], general: [] },
  )
}

/** A pool with explicit tiers. */
function tieredPool(layers: { own?: WardrobeItem[]; group?: WardrobeItem[]; project?: WardrobeItem[]; general?: WardrobeItem[] }) {
  return buildWearablePool(
    CHAR_ID,
    { groupMountPointIds: ['g-mp'], projectMountPointIds: ['p-mp'] },
    {
      own: tag(layers.own ?? [], OWN, CHAR_ID),
      group: tag(layers.group ?? [], GROUP),
      project: tag(layers.project ?? [], PROJECT),
      general: tag(layers.general ?? [], GENERAL),
    },
  )
}

const emptySlots = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })

describe('resolveEquippedOutfitForCharacter', () => {
  it('returns empty results when nothing is equipped', () => {
    const resolved = resolveEquippedOutfitForCharacter(ownPool([]), emptySlots())
    expect(resolved.outfitValues).toEqual({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })
    expect(resolved.leafItemsBySlot.top).toEqual([])
    expect(resolved.itemsById.size).toBe(0)
  })

  it('routes a single-slot atomic item to its declared slot', () => {
    const shirt = makeItem('shirt-id', 'Linen shirt', ['top'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([shirt]), { ...emptySlots(), top: ['shirt-id'] })
    expect(resolved.outfitValues.top).toEqual(['Linen shirt'])
    expect(resolved.outfitValues.bottom).toEqual([])
  })

  it('spreads an atomic multi-slot item into all slots its types declare, even when only equipped to one', () => {
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([dress]), { ...emptySlots(), top: ['dress-id'] })
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.outfitValues.footwear).toEqual([])
  })

  it('does not double-count a multi-slot item already populated in multiple input slots', () => {
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([dress]), {
      ...emptySlots(),
      top: ['dress-id'],
      bottom: ['dress-id'],
    })
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.leafItemsBySlot.top).toHaveLength(1)
    expect(resolved.leafItemsBySlot.bottom).toHaveLength(1)
  })

  it("routes composite components to each component's own slot, not the composite's equipped slot", () => {
    const blouse = makeItem('blouse-id', 'White blouse', ['top'])
    const slacks = makeItem('slacks-id', 'Gray slacks', ['bottom'])
    const loafers = makeItem('loafers-id', 'Brown loafers', ['footwear'])
    const outfit = makeItem('outfit-id', 'Casual office outfit', ['top'], ['blouse-id', 'slacks-id', 'loafers-id'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([blouse, slacks, loafers, outfit]), {
      ...emptySlots(),
      top: ['outfit-id'],
    })
    expect(resolved.outfitValues.top).toEqual(['White blouse'])
    expect(resolved.outfitValues.bottom).toEqual(['Gray slacks'])
    expect(resolved.outfitValues.footwear).toEqual(['Brown loafers'])
    expect(resolved.outfitValues.accessories).toEqual([])
    // Composite and leaves are both reported as touched.
    expect(Array.from(resolved.itemsById.keys()).sort()).toEqual(
      ['blouse-id', 'loafers-id', 'outfit-id', 'slacks-id'],
    )
  })

  it('layers a separately-equipped item on top of distributed coverage', () => {
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const apron = makeItem('apron-id', 'Linen apron', ['top'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([dress, apron]), {
      ...emptySlots(),
      top: ['dress-id', 'apron-id'],
    })
    expect(resolved.outfitValues.top).toEqual(['Sundress', 'Linen apron'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
  })

  it('resolves items the character does not own from the shared tiers', () => {
    const jacket = makeItem('arch-id', 'Borrowed jacket', ['top'])
    const coat = makeItem('proj-item', 'Project livery coat', ['top'])
    const sash = makeItem('group-item', 'Guild sash', ['accessories'])
    const pool = tieredPool({ general: [jacket], project: [coat], group: [sash] })
    const resolved = resolveEquippedOutfitForCharacter(pool, {
      ...emptySlots(),
      top: ['arch-id', 'proj-item'],
      accessories: ['group-item'],
    })
    expect(resolved.outfitValues.top).toEqual(['Borrowed jacket', 'Project livery coat'])
    expect(resolved.outfitValues.accessories).toEqual(['Guild sash'])
  })

  it('expands a shared composite whose components are neither equipped nor owned', () => {
    const coat = makeItem('coat-id', 'Livery coat', ['top'])
    const waistcoat = makeItem('waistcoat-id', 'Livery waistcoat', ['top'])
    const boots = makeItem('boots-id', 'Livery boots', ['footwear'])
    const livery = makeItem('livery-id', 'House livery', ['top'], ['coat-id', 'waistcoat-id', 'boots-id'])
    const pool = tieredPool({ general: [coat, waistcoat, boots], project: [livery] })

    const resolved = resolveEquippedOutfitForCharacter(pool, { ...emptySlots(), top: ['livery-id'] })

    expect(resolved.outfitValues.top).toEqual(['Livery coat', 'Livery waistcoat'])
    expect(resolved.outfitValues.footwear).toEqual(['Livery boots'])
  })

  it("expands a character composite whose parts live in a group store", () => {
    const sash = makeItem('sash-id', 'Guild sash', ['accessories'])
    const shirt = makeItem('shirt-id', 'Dress shirt', ['top'])
    const regalia = makeItem('regalia-id', 'Guild regalia', ['top', 'accessories'], ['shirt-id', 'sash-id'])
    const pool = tieredPool({ own: [shirt, regalia], group: [sash] })

    const resolved = resolveEquippedOutfitForCharacter(pool, { ...emptySlots(), top: ['regalia-id'] })

    expect(resolved.outfitValues.top).toEqual(['Dress shirt'])
    expect(resolved.outfitValues.accessories).toEqual(['Guild sash'])
  })

  it('expands nested composites to leaves', () => {
    const cufflinks = makeItem('cufflinks-id', 'Cufflinks', ['accessories'])
    const jewelry = makeItem('jewelry-id', 'Formal jewelry', ['accessories'], ['cufflinks-id'])
    const shirt = makeItem('shirt-id', 'Dress shirt', ['top'])
    const formal = makeItem('formal-id', 'Formal set', ['top'], ['shirt-id', 'jewelry-id'])
    const pool = tieredPool({ general: [cufflinks, jewelry, shirt, formal] })

    const resolved = resolveEquippedOutfitForCharacter(pool, { ...emptySlots(), top: ['formal-id'] })

    expect(resolved.outfitValues.top).toEqual(['Dress shirt'])
    expect(resolved.outfitValues.accessories).toEqual(['Cufflinks'])
  })

  it('resolves nothing for a composite whose components exist nowhere, and an unknown id is skipped', () => {
    const orphanParent = makeItem('parent-id', 'Mystery bundle', ['top'], ['ghost-id'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([orphanParent]), {
      ...emptySlots(),
      top: ['parent-id', 'never-heard-of-it'],
    })
    expect(resolved.outfitValues.top).toEqual([])
  })

  it('survives a component cycle without looping', () => {
    const a = makeItem('a', 'A', ['top'], ['b'])
    const b = makeItem('b', 'B', ['top'], ['a', 'leaf'])
    const leaf = makeItem('leaf', 'Leaf', ['top'])
    const resolved = resolveEquippedOutfitForCharacter(ownPool([a, b, leaf]), { ...emptySlots(), top: ['a'] })
    expect(resolved.outfitValues.top).toEqual(['Leaf'])
  })

  // Bug 78: `equippedOutfit` is unconstrained JSON, so a chat row written
  // before a slot existed simply has no key for it.
  it('resolves a legacy slot bag written before the hair slot existed', () => {
    const shirt = makeItem('shirt-id', 'Linen shirt', ['top'])
    const legacySlots = { top: ['shirt-id'], bottom: [], footwear: [], accessories: [] } as unknown as EquippedSlots

    const resolved = resolveEquippedOutfitForCharacter(ownPool([shirt]), legacySlots)

    expect(resolved.outfitValues.top).toEqual(['Linen shirt'])
    expect(resolved.outfitValues.hair).toEqual([])
    expect(resolved.leafItemsBySlot.hair).toEqual([])
  })

  // Archiving hides a garment from the pickers; it does NOT undress anyone.
  // The pool's byId keeps archived items so a worn one still resolves.
  it('still resolves a garment archived while it was being worn', () => {
    const coat = { ...makeItem('coat-id', 'Travelling coat', ['top']), archivedAt: NOW }
    const sharedHat = { ...makeItem('hat-id', 'Old hat', ['accessories']), archivedAt: NOW }
    const pool = tieredPool({ own: [coat], general: [sharedHat] })

    const resolved = resolveEquippedOutfitForCharacter(pool, {
      ...emptySlots(),
      top: ['coat-id'],
      accessories: ['hat-id'],
    })

    expect(resolved.outfitValues.top).toEqual(['Travelling coat'])
    expect(resolved.outfitValues.accessories).toEqual(['Old hat'])
  })
})
