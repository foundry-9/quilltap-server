/**
 * useChatOutfit must never hand the wardrobe dialog a cached snapshot from an
 * earlier visit (bug 198). The Live tab and the Outfit Builder seed once from
 * the first `slotsFor` answer and ignore later refetches, so a stale cached
 * outfit — Laura still dressed after an LLM's `wardrobe_take_off` — would be
 * what the dialog showed, and what a Done would commit.
 */

import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../helpers/renderWithQuery'
import { useChatOutfit } from '@/lib/hooks/use-outfit'
import { queryKeys } from '@/lib/query/keys'
import { makeEmptyEquippedSlots, type EquippedOutfitState } from '@/lib/schemas/wardrobe.types'

const CHAT = 'chat-1'
const LAURA = 'laura'

function outfitWith(top: string[]): EquippedOutfitState {
  return { [LAURA]: { ...makeEmptyEquippedSlots(), top } }
}

describe('useChatOutfit — bug 198', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('withholds a cached snapshot until a fresh fetch lands', async () => {
    const queryClient = createTestQueryClient()
    // A previous dialog visit cached Laura dressed, and the cache still
    // counts it fresh — the case where a plain mount would not refetch.
    queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 60_000, staleTime: 60_000 } })
    queryClient.setQueryData(queryKeys.wardrobe.outfit(CHAT), outfitWith(['blouse']))

    let release: (() => void) | undefined
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve({ ok: true, json: async () => ({ equippedOutfit: outfitWith([]) }) } as Response)
        }),
    )

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useChatOutfit(CHAT), { wrapper })

    // The cached dressed outfit must not answer while the refetch is in flight.
    expect(result.current.slotsFor(LAURA)).toBeUndefined()
    await waitFor(() => expect(release).toBeDefined())
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/chats/${CHAT}?action=outfit`,
      expect.anything(),
    )

    release!()
    await waitFor(() => expect(result.current.slotsFor(LAURA)?.top).toEqual([]))
  })
})
