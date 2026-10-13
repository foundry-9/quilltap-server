/**
 * Bug 241 — a send that failed before the server saved the user's message
 * silently lost the operator's words: the composer, draft, attachments and
 * staged tool results were all cleared up front and nothing put them back, and
 * the stream reader dropped an error frame split across two reads (and read a
 * bare EOF as success), so the failure was often invisible too.
 */

import { renderHook, act } from '@testing-library/react'
import React from 'react'

import {
  useSSEStreaming,
  STREAM_CLOSED_EARLY_MESSAGE,
  SUBMISSION_RESTORED_NOTE,
  sendFailureToastText,
  SEND_FAILURE_TOAST_MS,
} from '@/app/salon/[id]/hooks/useSSEStreaming'
import type { Message, PendingToolResult } from '@/app/salon/[id]/types'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

const TEXT = 'A remark of some consequence.'

const ATTACHMENTS = [
  { id: 'file-1', filename: 'map.png', filepath: '/files/map.png', mimeType: 'image/png' },
]

const TOOL_RESULTS: PendingToolResult[] = [
  {
    id: 'pending-1',
    tool: 'rng',
    displayName: 'Random Number Generator',
    icon: 'dice',
    summary: 'd20: 17',
    formattedResult: 'Rolled 17',
    requestPrompt: 'Roll a d20',
    createdAt: new Date().toISOString(),
  } as PendingToolResult,
]

function frame(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** A response body that plays the given raw text chunks, one per read, then closes. */
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

interface SetupOptions {
  chunks?: string[]
  response?: Record<string, unknown>
  /** Simulates reconciliation: the post-error read retires every temp bubble. */
  readReconcilesBubble?: boolean
  /** What the composer holds by the time the failure lands. */
  composerText?: string
}

function setup({ chunks = [], response, readReconcilesBubble = false, composerText = '' }: SetupOptions) {
  let messages: Message[] = []
  const setMessages = jest.fn((next: Message[] | ((prev: Message[]) => Message[])) => {
    messages = typeof next === 'function' ? next(messages) : next
  })

  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
    response ?? { ok: true, body: rawBody(chunks) },
  ) as never

  const fetchChat = jest.fn(async () => {
    if (readReconcilesBubble) {
      messages = messages.filter((m) => !m.id.startsWith('temp-'))
    }
  })
  const setAttachedFiles = jest.fn()
  const setMarkdown = jest.fn()
  const inputRef = {
    current: {
      focus: jest.fn(),
      scrollIntoView: jest.fn(),
      getMarkdown: () => composerText,
      setMarkdown,
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
      setRespondingParticipantId: jest.fn(),
      activeTypingParticipantId: null,
      impersonatingParticipantIds: [],
      fetchChat,
      clearProvisionalMessages: jest.fn(),
      scrollOnUserMessage: jest.fn(),
      scrollOnStreamComplete: jest.fn(),
      setAttachedFiles,
      inputRef: inputRef as never,
      getFirstCharacterParticipant: () => ({ id: 'participant-1' }) as never,
      setPauseState: jest.fn(),
    } as never),
  )

  const setInput = jest.fn()
  const setPendingToolResults = jest.fn()
  const clearDraft = jest.fn()
  const persistDraft = jest.fn()

  const send = async () => {
    await act(async () => {
      await rendered.result.current.sendMessage(
        null,
        TEXT,
        setInput,
        ATTACHMENTS,
        TOOL_RESULTS,
        setPendingToolResults,
        clearDraft,
        persistDraft,
      )
    })
  }

  return {
    send,
    setInput,
    setPendingToolResults,
    clearDraft,
    persistDraft,
    setAttachedFiles,
    setMarkdown,
    assistant: () => messages.find((m) => m.role === 'ASSISTANT'),
  }
}

function expectRestored(h: ReturnType<typeof setup>) {
  expect(h.setInput).toHaveBeenLastCalledWith(TEXT)
  expect(h.setMarkdown).toHaveBeenCalledWith(TEXT)
  expect(h.persistDraft).toHaveBeenCalledWith(TEXT)
  expect(h.setAttachedFiles).toHaveBeenLastCalledWith(ATTACHMENTS)
  expect(h.setPendingToolResults).toHaveBeenLastCalledWith(TOOL_RESULTS)
}

function expectNotRestored(h: ReturnType<typeof setup>) {
  expect(h.setInput).not.toHaveBeenCalledWith(TEXT)
  expect(h.setMarkdown).not.toHaveBeenCalled()
  expect(h.persistDraft).not.toHaveBeenCalled()
  expect(h.setAttachedFiles).not.toHaveBeenCalledWith(ATTACHMENTS)
  expect(h.setPendingToolResults).not.toHaveBeenCalledWith(TOOL_RESULTS)
}

const PRE_PERSIST_ERROR = frame({
  error: 'Failed to generate response',
  errorType: 'Error',
  details: 'No API key configured for this connection profile',
  userMessagePersisted: false,
  pendingToolResultsPersisted: false,
})

describe('useSSEStreaming — a send that fails before the server saves it', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('toasts the error and hands the submission back to the composer', async () => {
    const h = setup({ chunks: [frame({ status: { stage: 'initializing', message: 'Loading chat...' } }), PRE_PERSIST_ERROR] })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    const [message, duration] = jest.mocked(showErrorToast).mock.calls[0]
    expect(message).toContain('No API key configured for this connection profile')
    expect(message).toContain(SUBMISSION_RESTORED_NOTE)
    expect(duration).toBe(SEND_FAILURE_TOAST_MS)
    expectRestored(h)
  })

  it('still reads an error frame split across two reads', async () => {
    const cut = Math.floor(PRE_PERSIST_ERROR.length / 2)
    const h = setup({ chunks: [PRE_PERSIST_ERROR.slice(0, cut), PRE_PERSIST_ERROR.slice(cut)] })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expect(jest.mocked(showErrorToast).mock.calls[0][0]).toContain('No API key configured')
    expectRestored(h)
  })

  it('leaves the composer empty when the server says the message was saved', async () => {
    const h = setup({
      chunks: [frame({
        error: 'Failed to generate response',
        errorType: 'Error',
        details: 'Provider exploded',
        userMessagePersisted: true,
        pendingToolResultsPersisted: true,
      })],
    })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expect(jest.mocked(showErrorToast).mock.calls[0][0]).not.toContain(SUBMISSION_RESTORED_NOTE)
    expectNotRestored(h)
  })

  it('hands the submission back when the request is refused outright', async () => {
    const h = setup({
      response: {
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Chat not found' }),
      },
    })

    await h.send()

    expect(jest.mocked(showErrorToast).mock.calls[0][0]).toContain('Chat not found')
    expectRestored(h)
  })

  it('does not clobber words typed into the composer since', async () => {
    const h = setup({ chunks: [PRE_PERSIST_ERROR], composerText: 'Something new entirely.' })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expectNotRestored(h)
  })
})

describe('useSSEStreaming — a stream that ends without a terminal event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('raises an error instead of reading the silence as success', async () => {
    const h = setup({ chunks: [frame({ content: 'Half a reply' })] })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expect(jest.mocked(showErrorToast).mock.calls[0][0]).toContain(STREAM_CLOSED_EARLY_MESSAGE)
    expect(jest.mocked(showErrorToast).mock.calls[0][1]).toBe(SEND_FAILURE_TOAST_MS)
  })

  it('restores the submission when the read shows no row for it', async () => {
    const h = setup({ chunks: [frame({ status: { stage: 'initializing', message: 'Loading chat...' } })] })

    await h.send()

    expectRestored(h)
  })

  it('leaves it alone when the read reconciled the bubble to a saved row', async () => {
    const h = setup({ chunks: [frame({ content: 'Half a reply' })], readReconcilesBubble: true })

    await h.send()

    expect(showErrorToast).toHaveBeenCalledTimes(1)
    expectNotRestored(h)
  })
})

describe('useSSEStreaming — frames split across reads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses a normal stream cut mid-line', async () => {
    const body =
      frame({ content: 'Good evening, ' }) +
      frame({ content: 'one and all.' }) +
      frame({ done: true, messageId: 'assistant-1', participantId: 'participant-1' })
    const h = setup({ chunks: [body.slice(0, 7), body.slice(7, 40), body.slice(40, 95), body.slice(95)] })

    await h.send()

    expect(showErrorToast).not.toHaveBeenCalled()
    expect(h.assistant()?.content).toBe('Good evening, one and all.')
    expectNotRestored(h)
  })

  it('reads a final frame that arrives without its trailing newline', async () => {
    const body =
      frame({ content: 'Brief.' }) +
      `data: ${JSON.stringify({ done: true, messageId: 'assistant-2', participantId: 'participant-1' })}`
    const h = setup({ chunks: [body] })

    await h.send()

    expect(showErrorToast).not.toHaveBeenCalled()
    expect(h.assistant()?.content).toBe('Brief.')
  })
})

describe('sendFailureToastText', () => {
  it('ends the reason as a sentence before the restored note', () => {
    expect(sendFailureToastText('Failed to generate response: No API key configured', true))
      .toBe(`Failed to generate response: No API key configured. ${SUBMISSION_RESTORED_NOTE}`)
    expect(sendFailureToastText('Please try again.', true)).toBe(`Please try again. ${SUBMISSION_RESTORED_NOTE}`)
    expect(sendFailureToastText('Nothing restored', false)).toBe('Nothing restored')
  })
})
