/**
 * The wardrobe origin annotation: the chip text is spelled in exactly one
 * place, and tagging a collection read never disturbs the item itself.
 */

import {
  GENERAL_WARDROBE_ORIGIN,
  wardrobeOriginLabel,
  withOrigin,
  type WardrobeOrigin,
} from '../wardrobe-container'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const ITEM = {
  id: 'coat',
  characterId: null,
  title: 'Midnight Lightning Flapper Coat',
  types: ['top'],
  componentItemIds: [],
  isDefault: false,
  replace: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as WardrobeItem

describe('wardrobeOriginLabel', () => {
  it('names Quilltap General as a shared wardrobe', () => {
    expect(wardrobeOriginLabel(GENERAL_WARDROBE_ORIGIN)).toBe('Shared · Quilltap General')
  })

  it('names the project a garment was borrowed from', () => {
    expect(wardrobeOriginLabel({ scope: 'project', id: 'p1', name: 'Thornfield' })).toBe(
      'Project · Thornfield',
    )
  })

  it('names the group a garment was borrowed from', () => {
    expect(wardrobeOriginLabel({ scope: 'group', id: 'g1', name: 'The Sisters' })).toBe(
      'Group · The Sisters',
    )
  })

  it('returns null for a character-owned garment', () => {
    expect(wardrobeOriginLabel({ scope: 'character', id: 'c1', name: 'Bertie' })).toBeNull()
  })

  it('returns null when no origin arrived', () => {
    expect(wardrobeOriginLabel(undefined)).toBeNull()
    expect(wardrobeOriginLabel(null)).toBeNull()
  })
})

describe('withOrigin', () => {
  it('adds the origin and leaves every item field untouched', () => {
    const origin: WardrobeOrigin = { scope: 'project', id: 'p1', name: 'Thornfield' }
    const [tagged] = withOrigin([ITEM], origin)
    const { origin: attached, ...rest } = tagged
    expect(attached).toEqual(origin)
    expect(rest).toEqual(ITEM)
  })

  it('does not mutate the items it was given', () => {
    const items = [ITEM]
    withOrigin(items, GENERAL_WARDROBE_ORIGIN)
    expect(items[0]).not.toHaveProperty('origin')
  })
})
