/**
 * The composer gestures every staging surface shares (`useComposerHandlers`):
 * the wardrobe dialog's Live tab and Outfit Builder, and the chat-start
 * composer. One implementation, so the three can't disagree on what a click
 * does.
 */

import {
  addToSlotGesture,
  clearSlotGesture,
  removeFromSlotGesture,
  wearGesture,
} from '@/lib/wardrobe/staged-live-outfits'
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'

const slots = (partial: Partial<EquippedSlots>): EquippedSlots => ({
  ...EMPTY_EQUIPPED_SLOTS,
  ...partial,
})

const item = (
  id: string,
  types: WardrobeItem['types'],
  extra: Partial<WardrobeItem> = {},
): WardrobeItem =>
  ({ id, title: id, types, replace: false, componentItemIds: [], ...extra }) as unknown as WardrobeItem

const pool = (...items: WardrobeItem[]) => new Map(items.map((i) => [i.id, i]))

describe('wearGesture', () => {
  it('wears a garment across every slot it covers', () => {
    const dress = item('dress', ['top', 'bottom'])
    const g = wearGesture('top', 'dress', pool(dress))
    expect(g.mutate(slots({}))).toEqual(slots({ top: ['dress'], bottom: ['dress'] }))
    expect(g.wornBundleIds).toEqual([])
  })

  it('dissolves an outfit into its leaves and claims the outfit for the ledger', () => {
    const hat = item('hat', ['accessories'])
    const boots = item('boots', ['footwear'])
    const rambler = item('rambler', ['accessories', 'footwear'], { componentItemIds: ['hat', 'boots'] })
    const g = wearGesture('accessories', 'rambler', pool(hat, boots, rambler))
    expect(g.mutate(slots({}))).toEqual(slots({ accessories: ['hat'], footwear: ['boots'] }))
    expect(g.wornBundleIds).toEqual(['rambler'])
  })

  it('appends an id the pool does not know to the slot it started in, once', () => {
    const g = wearGesture('top', 'ghost', pool())
    const once = g.mutate(slots({ top: ['shirt'] }))
    expect(once).toEqual(slots({ top: ['shirt', 'ghost'] }))
    expect(g.mutate(once)).toEqual(once)
  })
})

describe('slot gestures', () => {
  it('layers into one slot, removes one id, and clears a slot', () => {
    const coat = item('coat', ['top'])
    expect(addToSlotGesture('top', coat, pool(coat)).mutate(slots({ top: ['shirt'] }))).toEqual(
      slots({ top: ['shirt', 'coat'] }),
    )
    expect(removeFromSlotGesture('top', 'shirt').mutate(slots({ top: ['shirt', 'coat'] }))).toEqual(
      slots({ top: ['coat'] }),
    )
    expect(clearSlotGesture('top').mutate(slots({ top: ['shirt', 'coat'] }))).toEqual(slots({}))
  })

  it('never mutates the slots it is given', () => {
    const before = slots({ top: ['shirt'] })
    removeFromSlotGesture('top', 'shirt').mutate(before)
    clearSlotGesture('top').mutate(before)
    expect(before).toEqual(slots({ top: ['shirt'] }))
  })
})
