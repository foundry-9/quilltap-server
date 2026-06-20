/**
 * Unit tests for the equipped-outfit hash helper that gates clothing-summary
 * re-derivation and mid-turn wardrobe-change detection.
 */

import { describe, it, expect } from '@jest/globals'
import { hashEquippedSlots, hasEquippedItems } from '@/lib/wardrobe/outfit-hash'

describe('outfit-hash', () => {
  it('hashes equal equipped states to the same value', () => {
    const a = { top: ['t1'], bottom: ['b1'], footwear: [], accessories: [] }
    const b = { top: ['t1'], bottom: ['b1'], footwear: [], accessories: [] }
    expect(hashEquippedSlots(a)).toBe(hashEquippedSlots(b))
  })

  it('changes when an item is added or removed', () => {
    const base = { top: ['t1'], bottom: [], footwear: [], accessories: [] }
    const added = { top: ['t1', 't2'], bottom: [], footwear: [], accessories: [] }
    expect(hashEquippedSlots(base)).not.toBe(hashEquippedSlots(added))
  })

  it('is order-sensitive within a slot (layering matters)', () => {
    const ab = { top: ['a', 'b'], bottom: [], footwear: [], accessories: [] }
    const ba = { top: ['b', 'a'], bottom: [], footwear: [], accessories: [] }
    expect(hashEquippedSlots(ab)).not.toBe(hashEquippedSlots(ba))
  })

  it('treats null/empty as a stable sentinel', () => {
    const empty = { top: [], bottom: [], footwear: [], accessories: [] }
    expect(hashEquippedSlots(null)).toBe(hashEquippedSlots(empty))
    expect(hashEquippedSlots(undefined)).toBe(hashEquippedSlots(empty))
  })

  it('hasEquippedItems reflects whether any slot holds an item', () => {
    expect(hasEquippedItems(null)).toBe(false)
    expect(hasEquippedItems({ top: [], bottom: [], footwear: [], accessories: [] })).toBe(false)
    expect(hasEquippedItems({ top: [], bottom: [], footwear: ['shoe'], accessories: [] })).toBe(true)
  })
})
