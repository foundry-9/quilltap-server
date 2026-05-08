import { describe, expect, it, jest } from '@jest/globals'

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

import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'
const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001'

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
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeRepos(items: WardrobeItem[]) {
  return {
    wardrobe: {
      findByCharacterId: jest.fn(async () => items),
      findByIds: jest.fn(async (ids: string[]) => items.filter((i) => ids.includes(i.id))),
    },
  } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]
}

const emptySlots = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [] })

describe('resolveEquippedOutfitForCharacter', () => {
  it('returns empty results when nothing is equipped', async () => {
    const repos = makeRepos([])
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, emptySlots())
    expect(resolved.outfitValues).toEqual({ top: [], bottom: [], footwear: [], accessories: [] })
    expect(resolved.leafItemsBySlot.top).toEqual([])
    expect(resolved.leafItemsBySlot.bottom).toEqual([])
  })

  it('routes a single-slot atomic item to its declared slot', async () => {
    const shirt = makeItem('shirt-id', 'Linen shirt', ['top'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['shirt-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([shirt]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Linen shirt'])
    expect(resolved.outfitValues.bottom).toEqual([])
  })

  it('spreads an atomic multi-slot item into all slots its types declare, even when only equipped to one', async () => {
    // A dress that covers both top and bottom, but the equipped state only
    // lists it under slots.top. The renderer must still know the wearer
    // isn't bottomless.
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([dress]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.outfitValues.footwear).toEqual([])
  })

  it('does not double-count a multi-slot item already populated in multiple input slots', async () => {
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id'], bottom: ['dress-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(makeRepos([dress]), CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Sundress'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
    expect(resolved.leafItemsBySlot.top).toHaveLength(1)
    expect(resolved.leafItemsBySlot.bottom).toHaveLength(1)
  })

  it('routes composite components to each component\'s own slot, not the composite\'s equipped slot', async () => {
    // A "casual outfit" composite equipped only to slots.top, but its
    // components should distribute across top/bottom/footwear by their own types.
    const blouse = makeItem('blouse-id', 'White blouse', ['top'])
    const slacks = makeItem('slacks-id', 'Gray slacks', ['bottom'])
    const loafers = makeItem('loafers-id', 'Brown loafers', ['footwear'])
    const outfit = makeItem('outfit-id', 'Casual office outfit', ['top'], [
      'blouse-id',
      'slacks-id',
      'loafers-id',
    ])
    const slots: EquippedSlots = { ...emptySlots(), top: ['outfit-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(
      makeRepos([blouse, slacks, loafers, outfit]),
      CHAR_ID,
      slots,
    )
    expect(resolved.outfitValues.top).toEqual(['White blouse'])
    expect(resolved.outfitValues.bottom).toEqual(['Gray slacks'])
    expect(resolved.outfitValues.footwear).toEqual(['Brown loafers'])
    expect(resolved.outfitValues.accessories).toEqual([])
  })

  it('layers a separately-equipped item on top of distributed coverage', async () => {
    // Dress in slots.top covers top+bottom. A separate apron is also worn
    // (also covers top). The rendered top should list dress then apron.
    const dress = makeItem('dress-id', 'Sundress', ['top', 'bottom'])
    const apron = makeItem('apron-id', 'Linen apron', ['top'])
    const slots: EquippedSlots = { ...emptySlots(), top: ['dress-id', 'apron-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(
      makeRepos([dress, apron]),
      CHAR_ID,
      slots,
    )
    expect(resolved.outfitValues.top).toEqual(['Sundress', 'Linen apron'])
    expect(resolved.outfitValues.bottom).toEqual(['Sundress'])
  })

  it('falls back to findByIds for items missing from the character wardrobe', async () => {
    const archetype = makeItem('arch-id', 'Borrowed jacket', ['top'])
    const repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => []),
        findByIds: jest.fn(async (ids: string[]) =>
          ids.includes('arch-id') ? [archetype] : [],
        ),
      },
    } as unknown as Parameters<typeof resolveEquippedOutfitForCharacter>[0]
    const slots: EquippedSlots = { ...emptySlots(), top: ['arch-id'] }
    const resolved = await resolveEquippedOutfitForCharacter(repos, CHAR_ID, slots)
    expect(resolved.outfitValues.top).toEqual(['Borrowed jacket'])
  })
})
