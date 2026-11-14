/**
 * useStagedLiveOutfits — `isDirty`, `discard`, and the History tab's staged
 * rollback: Wear again paints the recorded outfit on the Live tab without a
 * request, and Done commits it through `?action=wardrobe-rollback` — or, when
 * the Live tab was edited after the pick, through an ordinary `set_all`.
 */

import { act, renderHook } from '@testing-library/react'
import { createQueryWrapper } from '@/__tests__/helpers/renderWithQuery'
import { useStagedLiveOutfits } from '@/components/wardrobe/hooks/useStagedLiveOutfits'
import { makeEmptyEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { StagedGesture } from '@/lib/wardrobe/staged-live-outfits'

const WORN: EquippedSlots = { ...makeEmptyEquippedSlots(), top: ['dress'] }
const ROLLED_BACK: EquippedSlots = { ...makeEmptyEquippedSlots(), footwear: ['boots'] }

const ENTRY = {
  index: 1,
  slots: {
    footwear: [{ itemId: 'boots', archived: false, missing: false }],
    accessories: [{ itemId: 'gone', archived: false, missing: true }],
  },
}

const addScarf: StagedGesture = {
  mutate: (prev) => ({ ...prev, accessories: [...prev.accessories, 'scarf'] }),
  wornBundleIds: [],
}

describe('useStagedLiveOutfits — isDirty, discard and staged rollback', () => {
  const realFetch = global.fetch
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = url.includes('wardrobe-rollback')
        ? { restoredIndex: JSON.parse(String(init?.body)).index, skipped: [] }
        : { equippedSlots: ROLLED_BACK }
      return { ok: true, status: 200, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) }
    })
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

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

  const calls = (action: string) => fetchSpy.mock.calls.filter(([url]) => String(url).includes(`action=${action}`))

  it('is clean when seeded, dirty after a gesture', () => {
    const { result } = setup()
    expect(result.current.isDirty('char-1')).toBe(false)
    act(() => result.current.apply(addScarf))
    expect(result.current.isDirty('char-1')).toBe(true)
  })

  it('discard drops the staging and re-seeds from the snapshot in hand', () => {
    const { result } = setup()
    act(() => result.current.apply(addScarf))
    act(() => result.current.discard('char-1'))
    expect(result.current.isDirty('char-1')).toBe(false)
    expect(result.current.displaySlots).toEqual(WORN)
  })

  it('stageRollback paints the recorded outfit and sends nothing', () => {
    const { result } = setup()
    act(() => result.current.apply(addScarf))
    act(() => result.current.stageRollback(ENTRY))
    expect(result.current.displaySlots).toEqual(ROLLED_BACK)
    expect(result.current.isDirty('char-1')).toBe(true)
    expect(result.current.stagedRollbackIndex('char-1')).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Done commits a standing pick through the rollback action', async () => {
    const { result } = setup()
    act(() => result.current.stageRollback(ENTRY))
    let ok = false
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(calls('wardrobe-rollback')).toHaveLength(1)
    expect(JSON.parse(String(calls('wardrobe-rollback')[0][1].body))).toEqual({ characterId: 'char-1', index: 1 })
    expect(calls('equip')).toHaveLength(0)
    expect(result.current.stagedRollbackIndex('char-1')).toBeNull()
  })

  it('Done sends a set_all when the pick was edited afterwards', async () => {
    const { result } = setup()
    act(() => result.current.stageRollback(ENTRY))
    act(() => result.current.apply(addScarf))
    expect(result.current.stagedRollbackIndex('char-1')).toBeNull()
    await act(async () => {
      await result.current.flush()
    })
    expect(calls('wardrobe-rollback')).toHaveLength(0)
    expect(calls('equip')).toHaveLength(1)
  })

  it('discard after a pick leaves nothing to commit', async () => {
    const { result } = setup()
    act(() => result.current.stageRollback(ENTRY))
    act(() => result.current.discard('char-1'))
    expect(result.current.displaySlots).toEqual(WORN)
    expect(result.current.stagedRollbackIndex('char-1')).toBeNull()
    await act(async () => {
      await result.current.flush()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
