/**
 * Bug 136 — the two refusals in `sendMessage`'s opening guard are different
 * events and must read differently. An empty composer is the operator's own
 * doing and wants no answer; a send declined because a turn is still in flight
 * is a real request refused, and the silence that used to cover it was
 * indistinguishable from a send that broke.
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'

import { useSSEStreaming } from '@/app/salon/[id]/hooks/useSSEStreaming'
import type { Message } from '@/app/salon/[id]/types'
import { showInfoToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

/** A turn that never lands, so `sending` stays true for the second press. */
function setup() {
  let messages: Message[] = []
  const setMessages = jest.fn((next: Message[] | ((prev: Message[]) => Message[])) => {
    messages = typeof next === 'function' ? next(messages) : next
  })

  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
    () => new Promise(() => {}),
  ) as never

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

  const send = (text: string) =>
    rendered.result.current.sendMessage(
      null,
      text,
      jest.fn() as never,
      [],
      [],
      jest.fn() as never,
      jest.fn() as never,
    )

  return { rendered, send }
}

describe('useSSEStreaming — the opening guard in sendMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('answers a send refused while a turn is in flight', async () => {
    const { rendered, send } = setup()

    act(() => {
      void send('The first remark.')
    })
    await waitFor(() => expect(rendered.result.current.sending).toBe(true))
    jest.mocked(showInfoToast).mockClear()

    await act(async () => {
      await send('A second, too soon.')
    })

    expect(showInfoToast).toHaveBeenCalledTimes(1)
    expect(jest.mocked(showInfoToast).mock.calls[0][0]).toContain('still speaking')
  })

  it('stays silent on an empty composer', async () => {
    const { send } = setup()

    await act(async () => {
      await send('   ')
    })

    expect(showInfoToast).not.toHaveBeenCalled()
  })
})
