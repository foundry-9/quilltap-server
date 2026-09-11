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

/**
 * The transcript as a subscribed read.
 *
 * Before this, the only way a message could reach an open tab was the read loop
 * of the `POST /api/v1/messages` fetch the tab itself issued. On 2026-09-11 a
 * reply persisted at 12:49:59.812Z — a plain ASSISTANT row, fully renderable —
 * and never appeared, because the stream it would have ridden was gone and
 * `safeEnqueue` swallows a write to a closed controller. Nothing existed to tell
 * the tab to look again.
 *
 * These pins hold the subscription, the conditional, and the narrowing.
 */
describe('useChatData — the transcript', () => {
  const OTHER_CHAT = '5f13a7b0-2c41-4a8e-9f77-2b6b0e6a1d22'

  /** Rows as `?action=transcript` would return them, newest last. */
  type Row = { id: string; role: string; content: string; createdAt: string }

  let transcript: { version: number; messages: Row[] }

  /** How many times the hook has read the transcript endpoint. */
  function transcriptReads(): string[] {
    return fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('action=transcript'))
  }

  function stubTranscript() {
    fetchMock.mockImplementation((url: string) => {
      const href = String(url)

      if (href.startsWith('/api/v1/memories?chatId=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ memoryCount: 0 }),
        })
      }

      if (href.includes('action=transcript')) {
        const known = new URL(href, 'http://x').searchParams.get('knownVersion')
        if (known !== null && Number(known) === transcript.version) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ unchanged: true, version: transcript.version }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              unchanged: false,
              version: transcript.version,
              messages: transcript.messages,
              count: transcript.messages.length,
            }),
        })
      }

      if (href.startsWith(`/api/v1/chats/${CHAT_ID}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              chat: {
                id: CHAT_ID,
                title: 'The orchard',
                participants: [],
                user: { id: 'u' },
                transcriptVersion: transcript.version,
                messages: transcript.messages,
              },
            }),
        })
      }

      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    })
  }

  beforeEach(() => {
    transcript = {
      version: 4,
      messages: [
        {
          id: '47a3a91d-0000-4000-8000-000000000001',
          role: 'USER',
          content: 'Go on, then.',
          createdAt: '2026-09-11T12:49:25.818Z',
        },
      ],
    }
    stubTranscript()
  })

  it('delivers a reply that no stream carried — the incident', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })
    expect(result.current.messages.map((m) => m.id)).toEqual([
      '47a3a91d-0000-4000-8000-000000000001',
    ])

    // 34 seconds of generation later, with the operator's tab long since
    // backgrounded and its stream gone, the reply persists — and the write
    // funnel publishes the hint this hook is listening for.
    transcript = {
      version: 5,
      messages: [
        ...transcript.messages,
        {
          id: '71369b19-0000-4000-8000-000000000002',
          role: 'ASSISTANT',
          content: 'As you like.',
          createdAt: '2026-09-11T12:49:59.812Z',
        },
      ],
    }
    emit({ topic: 'chats', id: CHAT_ID })

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.content)).toEqual([
        'Go on, then.',
        'As you like.',
      ]),
    )
  })

  it('hands back the version it last saw, and takes "unchanged" for an answer', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })

    const before = result.current.messages

    // A Lantern backdrop lands. It publishes the same `chats` topic, but the
    // transcript has not moved — so the read costs a round trip and the word
    // "unchanged", not a re-serialized conversation.
    emit({ topic: 'chats', id: CHAT_ID })

    await waitFor(() => expect(transcriptReads().length).toBeGreaterThan(0))
    expect(transcriptReads().at(-1)).toContain('knownVersion=4')
    expect(result.current.messages).toBe(before)
  })

  it('ignores a chats event that names a different chat', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })
    const before = transcriptReads().length

    emit({ topic: 'chats', id: OTHER_CHAT })

    expect(transcriptReads().length).toBe(before)
  })

  it('re-reads for free on socket open — a tab that slept', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })

    transcript = {
      version: 6,
      messages: [
        ...transcript.messages,
        {
          id: '9be06466-0000-4000-8000-000000000003',
          role: 'ASSISTANT',
          content: 'Welcome back.',
          createdAt: '2026-09-11T13:02:00.000Z',
        },
      ],
    }
    act(() => {
      for (const subscriber of [...subscribers]) subscriber.onOpen?.()
    })

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.content)).toContain('Welcome back.'),
    )
  })

  it('keeps an optimistic bubble until the read carries its persisted row', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })

    act(() => {
      result.current.setMessages((prev) => [
        ...prev,
        {
          id: 'temp-user-1757594999999',
          role: 'USER',
          content: 'And the orchard?',
          createdAt: '2026-09-11T12:50:00.000Z',
        },
      ])
    })
    expect(result.current.messages.at(-1)?.id).toBe('temp-user-1757594999999')

    // A hint fires for something else entirely; the transcript has not moved,
    // and the bubble must survive an "unchanged" answer.
    emit({ topic: 'chats', id: CHAT_ID })
    await waitFor(() => expect(transcriptReads().length).toBeGreaterThan(0))
    expect(result.current.messages.at(-1)?.id).toBe('temp-user-1757594999999')

    // Now the send persists.
    transcript = {
      version: 7,
      messages: [
        ...transcript.messages,
        {
          id: 'c0ffee00-0000-4000-8000-000000000004',
          role: 'USER',
          content: 'And the orchard?',
          createdAt: '2026-09-11T12:50:01.000Z',
        },
      ],
    }
    emit({ topic: 'chats', id: CHAT_ID })

    await waitFor(() =>
      expect(result.current.messages.at(-1)?.id).toBe('c0ffee00-0000-4000-8000-000000000004'),
    )
  })

  it('leaves the first load to fetchChat — the mount open-fire reads nothing', async () => {
    // `useRealtimeTopic` fires on socket open as well as on an event, which is
    // what makes a reconnect re-read for free. At mount that would race the
    // initial chat read, and both would project the whole transcript for one
    // chat being opened.
    renderHook(() => useChatData(CHAT_ID))
    await waitFor(() => expect(subscribers.length).toBeGreaterThan(0))
    act(() => {
      for (const subscriber of [...subscribers]) subscriber.onOpen?.()
    })
    expect(transcriptReads()).toEqual([])
  })

  it('serializes overlapping reads, taking one trailing pass', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })
    const before = transcriptReads().length

    // Two hints inside the bus's coalescing window, against a read slower than
    // it. Applying the older rows last would walk the transcript backwards.
    await act(async () => {
      await Promise.all([
        result.current.refreshTranscript(),
        result.current.refreshTranscript(),
        result.current.refreshTranscript(),
      ])
    })

    // The first read, plus exactly one trailing pass for the two that queued
    // behind it — not three.
    expect(transcriptReads().length - before).toBe(2)
  })

  it('holds the sweep when no read backs it up, and takes it on the next one', async () => {
    // The send path sweeps at the turn boundary. If the error-path read failed
    // too, the server may well have persisted the line and the bubble is the
    // operator's only copy of it — so the sweep waits for a read that came back.
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })

    act(() => {
      result.current.setMessages((prev) => [
        ...prev,
        {
          id: 'temp-user-1757595111111',
          role: 'USER',
          content: 'a send during an outage',
          createdAt: '2026-09-11T12:50:00.000Z',
        },
      ])
    })

    // The network is down: the turn's own read fails, then the sweep is asked for.
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    await act(async () => {
      await result.current.fetchChat()
    })
    act(() => {
      result.current.clearProvisionalMessages()
    })
    expect(result.current.messages.map((m) => m.id)).toContain('temp-user-1757595111111')

    // The network returns and the transcript does not carry the line.
    stubTranscript()
    transcript = { version: 9, messages: transcript.messages }
    await act(async () => {
      await result.current.refreshTranscript()
    })

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([
        '47a3a91d-0000-4000-8000-000000000001',
      ]),
    )
  })

  it('sweeps a bubble that never persisted at all', async () => {
    const { result } = renderHook(() => useChatData(CHAT_ID))
    await act(async () => {
      await result.current.fetchChat()
    })

    act(() => {
      result.current.setMessages((prev) => [
        ...prev,
        {
          id: 'temp-user-1757595000000',
          role: 'USER',
          content: 'a send that 400ed',
          createdAt: '2026-09-11T12:50:00.000Z',
        },
      ])
    })

    act(() => {
      result.current.clearProvisionalMessages()
    })

    expect(result.current.messages.map((m) => m.id)).toEqual([
      '47a3a91d-0000-4000-8000-000000000001',
    ])
  })
})
