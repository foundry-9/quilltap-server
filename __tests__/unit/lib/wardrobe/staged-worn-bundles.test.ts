/**
 * Wear ledger — the Wardrobe dialog's staged bundle claims
 * (docs/developer/features/wardrobe-wear-ledger.md §3.3, "The Wardrobe
 * dialog's staged edits").
 *
 * The dialog dissolves an outfit to its leaves client-side, so the slots it
 * flushes cannot say an outfit was worn. The bundle ids ride beside them on the
 * `set_all`, accumulate per character, and reset whenever the staged state is
 * rebased.
 */

import {
  appendWornBundleIds,
  buildSetAllEquipBody,
  classifyStagedOutfits,
  rebaseStagedGestures,
  wornBundleIdsFor,
  type StagedGesture,
} from '@/lib/wardrobe/staged-live-outfits'
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { wearItemIntoSlots } from '@/lib/wardrobe/outfit-displacement'

const slots = (partial: Partial<EquippedSlots>): EquippedSlots => ({
  ...EMPTY_EQUIPPED_SLOTS,
  ...partial,
})

const item = (
  id: string,
  types: WardrobeItem['types'],
  componentItemIds: string[] = [],
): WardrobeItem =>
  ({ id, title: id, types, replace: false, componentItemIds }) as unknown as WardrobeItem

const hat = item('hat', ['accessories'])
const boots = item('boots', ['footwear'])
const walkingSet = item('walking-set', ['accessories', 'footwear'], ['hat', 'boots'])
const itemsById = new Map([hat, boots, walkingSet].map((i) => [i.id, i]))

const wearGesture = (it: WardrobeItem): StagedGesture => ({
  mutate: (prev) => wearItemIntoSlots(prev, it, itemsById),
  wornBundleIds: wornBundleIdsFor(it),
})

describe('wornBundleIdsFor', () => {
  it('claims a bundle by its own id and claims nothing for a garment', () => {
    expect(wornBundleIdsFor(walkingSet)).toEqual(['walking-set'])
    expect(wornBundleIdsFor(hat)).toEqual([])
    expect(wornBundleIdsFor({ id: 'x', componentItemIds: null })).toEqual([])
  })
})

describe('appendWornBundleIds', () => {
  it('accumulates in first-seen order without duplicates', () => {
    let acc = appendWornBundleIds(undefined, ['a'])
    acc = appendWornBundleIds(acc, ['b', 'a'])
    acc = appendWornBundleIds(acc, [])
    expect(acc).toEqual(['a', 'b'])
  })
})

describe('staged bundle ids travel with set_all', () => {
  it('a dirty character carries its accumulated bundle ids into the flush body', () => {
    const baseline = slots({ top: ['shirt'] })
    const staged = wearItemIntoSlots(baseline, walkingSet, itemsById)
    const acc = appendWornBundleIds(undefined, wornBundleIdsFor(walkingSet))

    const { dirty } = classifyStagedOutfits(
      { alice: staged },
      { alice: baseline },
      { alice: acc },
    )
    expect(dirty).toEqual([{ characterId: 'alice', slots: staged, wornBundleIds: ['walking-set'] }])

    const body = buildSetAllEquipBody(dirty[0].characterId, dirty[0].slots, dirty[0].wornBundleIds)
    expect(body).toEqual({
      characterId: 'alice',
      mode: 'set_all',
      slots: slots({ top: ['shirt'], accessories: ['hat'], footwear: ['boots'] }),
      wornBundleIds: ['walking-set'],
    })
  })

  it('a plain edit sends exactly the old body — no empty wornBundleIds', () => {
    const body = buildSetAllEquipBody('alice', slots({ top: ['shirt'] }), [])
    expect(body).toEqual({ characterId: 'alice', mode: 'set_all', slots: slots({ top: ['shirt'] }) })
    expect('wornBundleIds' in body).toBe(false)
  })

  it('a clean character sends nothing, whatever it accumulated', () => {
    const baseline = slots({ top: ['shirt'] })
    expect(
      classifyStagedOutfits({ alice: baseline }, { alice: baseline }, { alice: ['walking-set'] })
        .dirty,
    ).toEqual([])
  })

  it('ids belong to their own character', () => {
    const baseline = slots({})
    const { dirty } = classifyStagedOutfits(
      { alice: slots({ top: ['shirt'] }), bob: slots({ top: ['vest'] }) },
      { alice: baseline, bob: baseline },
      { alice: ['walking-set'] },
    )
    expect(dirty.find((d) => d.characterId === 'alice')?.wornBundleIds).toEqual(['walking-set'])
    expect(dirty.find((d) => d.characterId === 'bob')?.wornBundleIds).toBeUndefined()
  })
})

describe('rebaseStagedGestures', () => {
  it('replays the gestures onto the snapshot and rebuilds the ids from them alone', () => {
    const worn = slots({ top: ['shirt'] })
    const rebased = rebaseStagedGestures(worn, [wearGesture(walkingSet), wearGesture(hat)])
    expect(rebased.slots).toEqual(
      slots({ top: ['shirt'], accessories: ['hat'], footwear: ['boots'] }),
    )
    expect(rebased.wornBundleIds).toEqual(['walking-set'])
  })

  it('resets the ids when nothing is replayed — no claim outlives its staged state', () => {
    const worn = slots({ top: ['shirt'] })
    const rebased = rebaseStagedGestures(worn, [])
    expect(rebased).toEqual({ slots: worn, wornBundleIds: [] })
  })

  it('does not mutate the snapshot it rebases onto', () => {
    const worn = slots({ top: ['shirt'] })
    rebaseStagedGestures(worn, [wearGesture(walkingSet)])
    expect(worn).toEqual(slots({ top: ['shirt'] }))
  })
})
