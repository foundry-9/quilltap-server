/**
 * useStagedLiveOutfits — the History tab's two needs: `isDirty` says whether
 * Done would commit a character's staging, and `discard` throws it away so a
 * rollback is never flushed over, re-seeding from the next snapshot.
 */

import { act, renderHook } from '@testing-library/react'
import { createQueryWrapper } from '@/__tests__/helpers/renderWithQuery'
import { useStagedLiveOutfits } from '@/components/wardrobe/hooks/useStagedLiveOutfits'
import { makeEmptyEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { StagedGesture } from '@/lib/wardrobe/staged-live-outfits'

const WORN: EquippedSlots = { ...makeEmptyEquippedSlots(), top: ['dress'] }
const ROLLED_BACK: EquippedSlots = { ...makeEmptyEquippedSlots(), footwear: ['boots'] }

const addScarf: StagedGesture = {
  mutate: (prev) => ({ ...prev, accessories: [...prev.accessories, 'scarf'] }),
  wornBundleIds: [],
}

describe('useStagedLiveOutfits — isDirty and discard', () => {
  function setup() {
    const { wrapper } = createQueryWrapper()
    return renderHook(
      ({ wornSlots }: { wornSlots: EquippedSlots }) =>
        useStagedLiveOutfits({
          chatId: 'chat-1',
          characterId: 'char-1',
          wornSlots,
          characterName: () => 'Bertie',
          requestConfirmation: async () => true,
        }),
      { wrapper, initialProps: { wornSlots: WORN } },
    )
  }

  it('is clean when seeded, dirty after a gesture', () => {
    const { result } = setup()
    expect(result.current.isDirty('char-1')).toBe(false)
    act(() => result.current.apply(addScarf))
    expect(result.current.isDirty('char-1')).toBe(true)
  })

  it('discard drops the staging and re-seeds from the next snapshot', () => {
    const { result, rerender } = setup()
    act(() => result.current.apply(addScarf))
    act(() => result.current.discard('char-1'))
    expect(result.current.isDirty('char-1')).toBe(false)
    expect(result.current.displaySlots).toEqual(WORN)

    rerender({ wornSlots: ROLLED_BACK })
    expect(result.current.displaySlots).toEqual(ROLLED_BACK)
    expect(result.current.isDirty('char-1')).toBe(false)
  })

  it('discard with reseed re-seeds at once when no new snapshot arrived', () => {
    const { result } = setup()
    act(() => result.current.apply(addScarf))
    act(() => result.current.discard('char-1'))
    act(() => result.current.discard('char-1', { reseed: true }))
    expect(result.current.displaySlots).toEqual(WORN)
    expect(result.current.isDirty('char-1')).toBe(false)
  })
})
