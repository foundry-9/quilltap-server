/**
 * Bug 242 — the server sends a depth-0 `turnStart` before every first turn
 * (so the streaming bubble shows the right responder). The stream reader took
 * any `turnStart` as entering a chain, so a single-character turn's `done`
 * went down the chain's intermediate path and skipped the end-of-turn work:
 * no transcript refetch, no queue notification, no empty-response toast.
 */

import { renderHook, act } from '@testing-library/react'

import { useSSEStreaming } from '@/app/salon/[id]/hooks/useSSEStreaming'
import type { Message } from '@/app/salon/[id]/types'
import { showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function rawBody(chunks: string[]) {
  const encoder = new TextEncoder()
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

function setup(chunks: string[]) {
  let messages: Message[] = []
  const setMessages = jest.fn((next: Message[] | ((prev: Message[]) => Message[])) => {
    messages = typeof next === 'function' ? next(messages) : next
  })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, body: rawBody(chunks) })) as never

  const fetchChat = jest.fn(async () => {})
  const setRespondingParticipantId = jest.fn()
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
      isMultiChar: false,
      hasActiveCharacters: true,
      participantsAsBase: [],
      isPaused: false,
      respondingParticipantId: null,
      setRespondingParticipantId,
      activeTypingParticipantId: null,
      impersonatingParticipantIds: [],
      fetchChat,
      clearProvisionalMessages: jest.fn(),
      scrollOnUserMessage: jest.fn(),
      scrollOnStreamComplete: jest.fn(),
      setAttachedFiles: jest.fn(),
      inputRef: inputRef as never,
      getFirstCharacterParticipant: () => ({ id: 'participant-1' }) as never,
      setPauseState: jest.fn(),
    } as never),
  )

  const send = async () => {
    await act(async () => {
      await rendered.result.current.sendMessage(
        null,
        'Good evening.',
        jest.fn(),
        [],
        [],
        jest.fn(),
        jest.fn(),
        jest.fn(),
      )
    })
  }

  return { send, fetchChat, setRespondingParticipantId, assistant: () => messages.find((m) => m.role === 'ASSISTANT') }
}

const TURN_START = frame({ turnStart: true, participantId: 'participant-1', characterName: 'Ada', chainDepth: 0 })

describe('useSSEStreaming — a single-character turn (bug 242)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('runs the end-of-turn work after a depth-0 turnStart and done', async () => {
    const h = setup([
      TURN_START,
      frame({ content: 'Good evening to you.' }),
      frame({ done: true, messageId: 'assistant-1', participantId: 'participant-1' }),
    ])

    await h.send()

    expect(h.assistant()?.content).toBe('Good evening to you.')
    expect(h.fetchChat).toHaveBeenCalled()
    expect(notifyQueueChange).toHaveBeenCalled()
    expect(h.setRespondingParticipantId).toHaveBeenLastCalledWith(null)
  })

  it('shows the empty-response toast after a depth-0 turnStart', async () => {
    const h = setup([
      TURN_START,
      frame({ done: true, emptyResponse: true, messageId: 'assistant-1', participantId: 'participant-1' }),
    ])

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expect(jest.mocked(showErrorToast).mock.calls[0][0]).toMatch(/empty response/i)
  })
})
