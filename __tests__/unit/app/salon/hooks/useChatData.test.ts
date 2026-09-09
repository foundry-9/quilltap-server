/**
 * The Salon's chat-data hook — the memory-count subscription.
 *
 * Bug 128. The count was read exactly once, by a mount-only effect, and
 * memories are written afterwards by background jobs in the forked child, turn
 * after turn. The tabbed workspace hides an inactive Salon pane with a CSS
 * class and keeps it mounted, so "once per mount" became "once per session":
 * a chat opened before its first memory landed read `Delete Memories (0)`
 * forever, and the destructive control early-returned on that false zero.
 *
 * These pins hold the subscription itself, not the re-render. Removing the
 * `useRealtimeTopic('memories', …)` call from `useChatData` must turn the
 * first case red.
 */

import { act, renderHook, waitFor } from '@testing-library/react'

import { useChatData } from '@/app/salon/[id]/hooks/useChatData'
import type { RealtimeEvent } from '@/lib/schemas/realtime.types'

const CHAT_ID = '27961b14-ae98-46bf-ba1e-9f0ec13bb103'

/** Subscribers registered through the realtime client, newest last. */
type Subscriber = { onEvent?: (event: RealtimeEvent) => void; onOpen?: () => void }
const subscribers: Subscriber[] = []

jest.mock('@/lib/realtime/client', () => ({
  subscribeRealtime: (subscriber: Subscriber) => {
    subscribers.push(subscriber)
    return () => {
      const at = subscribers.indexOf(subscriber)
      if (at >= 0) subscribers.splice(at, 1)
    }
  },
  subscribeRealtimeStatus: () => () => {},
  getRealtimeStatus: () => 'connected',
}))

const fetchMock = global.fetch as jest.Mock

/** Answer the memory-count read with `count`; everything else 404s. */
function stubMemoryCount(count: number) {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith('/api/v1/memories?chatId=')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ chatId: CHAT_ID, memoryCount: count }),
      })
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  })
}

/** How many times the hook has read the memory-count endpoint. */
function memoryCountReads(): number {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).startsWith('/api/v1/memories?chatId=')
  ).length
}

function emit(event: Partial<RealtimeEvent>) {
  const full: RealtimeEvent = { v: 1, topic: 'memories', at: Date.now(), ...event }
  act(() => {
    for (const subscriber of [...subscribers]) subscriber.onEvent?.(full)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  subscribers.length = 0
})

describe('useChatData — the memory count', () => {
  it('re-reads the count when a memories event names this chat', async () => {
    stubMemoryCount(0)
    const { result } = renderHook(() => useChatData(CHAT_ID))

    // The hook subscribes on mount; the first read is the subscription's own
    // open-fire, since the mocked client reports a connected socket.
    await act(async () => {
      await result.current.fetchChatMemoryCount()
    })
    expect(result.current.chatMemoryCount).toBe(0)

    // Extraction lands 93 seconds after the chat row, in the forked child.
    stubMemoryCount(59)
    emit({ topic: 'memories', id: CHAT_ID })

    await waitFor(() => expect(result.current.chatMemoryCount).toBe(59))
  })

  it('ignores a memories event that names a different chat', async () => {
    stubMemoryCount(0)
    const { result } = renderHook(() => useChatData(CHAT_ID))

    await act(async () => {
      await result.current.fetchChatMemoryCount()
    })
    const before = memoryCountReads()

    emit({ topic: 'memories', id: 'a-different-chat' })

    // No refetch at all — an unrelated chat's extraction must not wake every
    // open Salon tab.
    expect(memoryCountReads()).toBe(before)
    expect(result.current.chatMemoryCount).toBe(0)
  })

  it('ignores a topic it does not subscribe to', async () => {
    stubMemoryCount(7)
    const { result } = renderHook(() => useChatData(CHAT_ID))

    await act(async () => {
      await result.current.fetchChatMemoryCount()
    })
    const before = memoryCountReads()

    emit({ topic: 'characters', id: CHAT_ID })

    expect(memoryCountReads()).toBe(before)
  })

  it('re-reads on a collection-wide memories event, which carries no id', async () => {
    stubMemoryCount(59)
    const { result } = renderHook(() => useChatData(CHAT_ID))

    await act(async () => {
      await result.current.fetchChatMemoryCount()
    })

    // A housekeeping sweep prunes across every chat a character was in, so its
    // hint has no chat to name. An id-scoped subscriber must still take it.
    stubMemoryCount(12)
    emit({ topic: 'memories' })

    await waitFor(() => expect(result.current.chatMemoryCount).toBe(12))
  })

  it('reads the count with no-store, so a cached 200 cannot answer the correcting refetch', async () => {
    stubMemoryCount(59)
    const { result } = renderHook(() => useChatData(CHAT_ID))

    await act(async () => {
      await result.current.fetchChatMemoryCount()
    })

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).startsWith('/api/v1/memories?chatId=')
    )
    expect(call?.[1]).toMatchObject({ cache: 'no-store' })
  })
})
