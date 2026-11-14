/**
 * Refactor 4.12, stream frames §6 — the golden streams, replayed through the
 * Salon's hook.
 *
 * The fixtures under `__tests__/fixtures/salon-stream/` were recorded from the
 * pre-4.12 encoders and are translated to frames (`loadFrameStream`). Each is
 * played as the body of a real send (or a Storyteller run) and the hook's
 * visible outcome is checked: the bubbles it appends, the messages it surfaces,
 * the raised-hand chip, the Storyteller board, the toasts and the refetches.
 */

import { renderHook, act } from '@testing-library/react'

import { useSSEStreaming, type StorytellerStreamEvent } from '@/app/salon/[id]/hooks/useSSEStreaming'
import type { GreenRoomEvent } from '@/lib/chat/stream-frames'
import type { Message } from '@/app/salon/[id]/types'
import { showErrorToast, showWarningToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { loadFrameStream, sseText, type GoldenStream } from '../../helpers/salon-stream-golden'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

/** A body that delivers the golden stream in ragged chunks, splitting frames. */
function goldenBody(name: GoldenStream) {
  const text = sseText(loadFrameStream(name))
  const encoder = new TextEncoder()
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 37) chunks.push(text.slice(i, i + 37))
  return {
    getReader() {
      let i = 0
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: encoder.encode(chunks[i++]) }
        },
        releaseLock() {},
        cancel: async () => {},
      }
    },
  }
}

function setup(name: GoldenStream) {
  let messages: Message[] = []
  const setMessages = jest.fn((next: Message[] | ((prev: Message[]) => Message[])) => {
    messages = typeof next === 'function' ? next(messages) : next
  })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, body: goldenBody(name) })) as never

  const fetchChat = jest.fn(async () => {})
  const onStorytellerEvent = jest.fn<void, [StorytellerStreamEvent]>()
  const onGreenRoom = jest.fn<void, [GreenRoomEvent]>()
  const inputRef = {
    current: {
      focus: jest.fn(),
      scrollIntoView: jest.fn(),
      getMarkdown: () => '',
      setMarkdown: jest.fn(),
      prependText: jest.fn(),
      getEditor: () => null,
    },
  }

  const rendered = renderHook(() =>
    useSSEStreaming({
      chatId: 'chat-1',
      chat: { id: 'chat-1', participants: [] } as never,
      messages,
      setMessages: setMessages as never,
      isMultiChar: true,
      hasActiveCharacters: true,
      participantsAsBase: [],
      isPaused: false,
      respondingParticipantId: null,
      setRespondingParticipantId: jest.fn(),
      activeTypingParticipantId: null,
      impersonatingParticipantIds: [],
      fetchChat,
      clearProvisionalMessages: jest.fn(),
      scrollOnUserMessage: jest.fn(),
      scrollOnStreamComplete: jest.fn(),
      setAttachedFiles: jest.fn(),
      inputRef: inputRef as never,
      getFirstCharacterParticipant: () => ({ id: 'p-ada' }) as never,
      setPauseState: jest.fn(),
      onStorytellerEvent,
      onGreenRoom,
    } as never),
  )

  const send = async () => {
    await act(async () => {
      await rendered.result.current.sendMessage(null, 'Good evening.', jest.fn(), [], [], jest.fn(), jest.fn(), jest.fn())
    })
  }

  const runStoryteller = async () => {
    await act(async () => {
      await rendered.result.current.runStorytellerSelection('r-1', ['p-ada', 'p-bo'], 'simultaneous')
    })
  }

  const openChat = async () => {
    await act(async () => {
      await rendered.result.current.openChat()
    })
  }

  const byId = (id: string) => messages.find((m) => m.id === id)

  return { send, runStoryteller, openChat, rendered, fetchChat, onStorytellerEvent, onGreenRoom, byId, messages: () => messages }
}

describe('useSSEStreaming — golden streams', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('plain reply: one bubble with its thinking, then the confirmation badge', async () => {
    const h = setup('plain-reply')
    await h.send()

    const reply = h.byId('m-1')
    expect(reply).toMatchObject({
      role: 'ASSISTANT',
      content: 'Good evening, old thing.',
      participantId: 'p-ada',
      provider: 'anthropic',
      modelName: 'model-x',
      reasoningContent: 'Hmm.',
      confirmed: true,
      confirmationChecked: true,
    })
    expect(h.fetchChat).toHaveBeenCalled()
    expect(notifyQueueChange).toHaveBeenCalled()
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('tool reply: Pascal surfaces, the failed image says why, the call sheet lands', async () => {
    const h = setup('tool-reply')
    await h.send()

    expect(h.byId('m-pascal')).toBeDefined()
    expect(h.byId('m-2')).toMatchObject({ content: 'Let me look. Found it.', provider: 'openai' })
    expect(h.byId('m-2')?.routeTrail).toHaveLength(1)
    expect(showErrorToast).toHaveBeenCalledWith('Image generation failed: no image profile')
    expect(h.rendered.result.current.streamingToolBatches).toEqual([])
  })

  it('Storyteller, all at once, with a raised hand: board, seats, hand and chain', async () => {
    const h = setup('storyteller-concurrent-hand')
    await h.runStoryteller()

    expect(h.onStorytellerEvent.mock.calls.map(([e]) => e.kind)).toEqual(['round', 'bid', 'open'])
    expect(h.onStorytellerEvent.mock.calls[1][0]).toMatchObject({ kind: 'bid', roundId: 'r-1' })
    // Ada spoke concurrently; Bo yielded (no bubble), and the Host noted it.
    expect(h.byId('m-3')).toMatchObject({ participantId: 'p-ada', role: 'ASSISTANT', content: 'I say' })
    expect(h.messages().some((m) => m.participantId === 'p-bo' && m.role === 'ASSISTANT')).toBe(false)
    expect(h.byId('m-host')).toBeDefined()
    // The chained speaker after the concurrent ones, then Carina's answer.
    expect(h.byId('m-4')).toMatchObject({ participantId: 'p-cy', content: 'Next.' })
    expect(h.byId('m-carina')).toBeDefined()
    // The hand's outcome outlives the stream.
    expect(h.rendered.result.current.handStatus).toEqual({ kind: 'yielded', characterName: 'Bo' })
    expect(h.rendered.result.current.concurrentStreams).toEqual([])
  })

  it('Courier: the parked turn is refetched, not pushed', async () => {
    const h = setup('courier-external')
    await h.send()

    expect(h.byId('m-5')).toBeUndefined()
    // pendingExternalTurn, the done's own refetch, and the end of the send.
    expect(h.fetchChat.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('failures: the rescue is said aloud, an empty reply toasts, an error ends the send', async () => {
    const h = setup('failures')
    await h.send()

    expect(showWarningToast).toHaveBeenCalledWith('Trying the understudy')
    expect(showErrorToast).toHaveBeenCalledWith('Nothing came back.')
    expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Failed to send: boom'), expect.any(Number))
    expect(h.messages().some((m) => m.role === 'ASSISTANT')).toBe(false)
  })

  it('opening: the Green Room narrates, then the greeting lands as an ordinary bubble', async () => {
    const h = setup('opening')
    await h.openChat()

    const events = h.onGreenRoom.mock.calls.map(([e]) => e.event)
    expect(events).toEqual([
      'phase', 'status', 'phase', 'status', 'wardrobeStart', 'wardrobeResult', 'inventory', 'log', 'phase', 'status', 'done',
    ])
    expect(h.messages().filter((m) => m.role === 'ASSISTANT')).toEqual([
      expect.objectContaining({ content: "Ah — you're early. Do come in.", participantId: 'p-ada' }),
    ])
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ continueMode: true, opening: true })
    expect(h.fetchChat).toHaveBeenCalled()
    expect(showErrorToast).not.toHaveBeenCalled()
  })
})
