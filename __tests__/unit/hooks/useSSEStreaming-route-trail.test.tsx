/**
 * The route trail on the wire: a `done` event's call sheet has to land on the
 * optimistic assistant message, or the list under the avatar only appears after
 * the post-turn `fetchChat()` — a visible flicker on exactly the turns that had
 * trouble.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

import { useSSEStreaming } from '@/app/salon/[id]/hooks/useSSEStreaming'
import type { Message } from '@/app/salon/[id]/types'
import type { RouteAttempt } from '@/lib/schemas/chat.types'

const TRAIL: RouteAttempt[] = [
  {
    profileId: '00000000-0000-4000-8000-00000000000a',
    profileName: 'OpenAI gpt-5',
    provider: 'openai',
    modelName: 'gpt-5',
    via: 'primary',
    outcome: 'failed',
    trigger: 'network',
    detail: 'Connection error.',
  },
  {
    profileId: '00000000-0000-4000-8000-00000000000b',
    profileName: 'Anthropic Sonnet',
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    via: 'understudy',
    outcome: 'answered',
  },
]

/** A response body that plays the given SSE frames and closes. */
function sseBody(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  return {
    getReader() {
      let i = 0
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined }
          const value = encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`)
          return { done: false, value }
        },
        releaseLock() {},
        cancel: async () => {},
      }
    },
  }
}

function setup(frames: Array<Record<string, unknown>>) {
  let messages: Message[] = []
  const setMessages = jest.fn((next: Message[] | ((prev: Message[]) => Message[])) => {
    messages = typeof next === 'function' ? next(messages) : next
  })

  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    body: sseBody(frames),
  })) as never

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
      fetchChat: jest.fn(async () => {}),
      clearProvisionalMessages: jest.fn(),
      scrollOnUserMessage: jest.fn(),
      scrollOnStreamComplete: jest.fn(),
      setAttachedFiles: jest.fn(),
      inputRef: { current: null } as React.RefObject<never>,
      getFirstCharacterParticipant: () => ({ id: 'participant-1' }) as never,
      setPauseState: jest.fn(),
    } as never),
  )

  const send = async () => {
    await act(async () => {
      await rendered.result.current.sendMessage(
        { preventDefault() {} } as React.FormEvent,
        'Hello',
        jest.fn() as never,
        [],
        [],
        jest.fn() as never,
        jest.fn() as never,
        { current: false } as React.MutableRefObject<boolean>,
      )
    })
  }

  return { send, assistant: () => messages.find((m) => m.role === 'ASSISTANT') }
}

describe('useSSEStreaming — the route trail on the done event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lands the call sheet on the optimistic assistant message', async () => {
    const { send, assistant } = setup([
      { content: 'A reply, at length.' },
      {
        done: true,
        messageId: 'assistant-1',
        participantId: 'participant-1',
        provider: 'anthropic',
        modelName: 'claude-sonnet-5',
        routeTrail: TRAIL,
      },
    ])

    await send()

    await waitFor(() => expect(assistant()).toBeDefined())
    expect(assistant()!.routeTrail).toEqual(TRAIL)
    expect(assistant()!.provider).toBe('anthropic')
  })

  it('leaves it null when the turn had no trouble', async () => {
    const { send, assistant } = setup([
      { content: 'All is well.' },
      {
        done: true,
        messageId: 'assistant-2',
        participantId: 'participant-1',
        provider: 'openai',
        modelName: 'gpt-5',
      },
    ])

    await send()

    await waitFor(() => expect(assistant()).toBeDefined())
    expect(assistant()!.routeTrail).toBeNull()
  })
})
