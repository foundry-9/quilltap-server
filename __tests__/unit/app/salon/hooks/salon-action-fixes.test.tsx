/**
 * Salon hook regressions:
 *
 * - #264 — a row's stale action closure wrote back the transcript it closed
 *   over, so one swipe or delete undid another.
 * - #281 — the delete dialog always said "1 swipes".
 * - #306 — a refused queue / dequeue kept its optimistic state, and Copy
 *   claimed success before the clipboard answered.
 * - #313 — a server-side end of an impersonation left "Speaking as" on screen.
 * - #262 — a hidden terminal pane re-opened when the chat object was re-spread.
 */

import { useState } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))
jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn(async () => true) }))
jest.mock('@/hooks/useChatSettingsMutation', () => ({
  useChatSettingsMutation: () => ({ save: jest.fn() }),
}))
jest.mock('@/lib/realtime/client', () => ({
  subscribeRealtime: () => () => {},
  subscribeRealtimeStatus: () => () => {},
  getRealtimeStatus: () => 'connected',
}))
jest.mock('@/app/salon/[id]/hooks/terminalModeApi', () => ({
  getTerminalSession: jest.fn(async (id: string) => ({ id, exitedAt: null })),
  isLiveSession: () => true,
  killTerminalSessionApi: jest.fn(),
  listTerminalSessions: jest.fn(async () => []),
  persistChatTerminalState: jest.fn(async () => undefined),
  spawnTerminalSession: jest.fn(),
}))

import { useMessageActions } from '@/app/salon/[id]/hooks/useMessageActions'
import { useChatData } from '@/app/salon/[id]/hooks/useChatData'
import { useTurnManagement } from '@/app/salon/[id]/hooks/useTurnManagement'
import { useImpersonation } from '@/app/salon/[id]/hooks/useImpersonation'
import { useTerminalMode } from '@/app/salon/[id]/hooks/useTerminalMode'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { Chat, Message, ChatSettings } from '@/app/salon/[id]/types'

const fetchMock = global.fetch as jest.Mock

function msg(id: string, extra: Partial<Message> = {}): Message {
  return { id, role: 'ASSISTANT', content: id, createdAt: '2026-11-27T00:00:00Z', ...extra } as Message
}

function okJson(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => body })
}

function renderActions(initial: Message[], chatSettings: Partial<ChatSettings> | null) {
  return renderHook(() => {
    const [messages, setMessages] = useState<Message[]>(initial)
    const actions = useMessageActions(
      messages,
      setMessages,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      null,
      '',
      new Set(),
      jest.fn(),
      jest.fn(),
      { current: null },
      { current: null } as unknown as React.RefObject<HTMLDivElement>,
      chatSettings as ChatSettings | null,
    )
    return { messages, setMessages, actions }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockReset()
})

describe('useMessageActions', () => {
  it('a delete run from an old closure keeps a message that arrived since (#264)', async () => {
    fetchMock.mockImplementation(() => okJson({ memoriesDeleted: 0 }))
    const { result } = renderActions([msg('a'), msg('b')], {
      memoryCascadePreferences: { onMessageDelete: 'KEEP_MEMORIES', onSwipeRegenerate: 'DELETE_MEMORIES' },
    } as Partial<ChatSettings>)

    const staleDelete = result.current.actions.deleteMessage
    act(() => {
      result.current.setMessages(prev => [...prev, msg('c')])
    })
    await act(async () => {
      await staleDelete('a')
    })

    expect(result.current.messages.map(m => m.id)).toEqual(['b', 'c'])
  })

  it('carries the swipe group size into the confirmation (#281)', async () => {
    fetchMock.mockImplementation(() => okJson({
      requiresConfirmation: true,
      memoryCount: 4,
      isSwipeGroup: true,
      messageIds: ['a', 'a2', 'a3'],
    }))
    const { result } = renderActions([msg('a', { swipeGroupId: 'g' })], null)

    await act(async () => {
      await result.current.actions.deleteMessage('a')
    })

    expect(result.current.actions.memoryCascadeConfirmation).toEqual(
      expect.objectContaining({ isSwipeGroup: true, memoryCount: 4, swipeCount: 3 }),
    )
  })

  it('does not claim a copy the clipboard refused (#306)', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn(async () => { throw new Error('denied') }) },
    })
    const { result } = renderActions([], null)

    await act(async () => {
      await result.current.actions.copyMessageContent('hello')
    })

    expect(showSuccessToast).not.toHaveBeenCalled()
    expect(showErrorToast).toHaveBeenCalled()
  })
})

describe('useChatData.stepSwipe (#264)', () => {
  it('a second swipe on another group keeps the first one', () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }))
    const { result } = renderHook(() => useChatData('chat-1'))

    const a1 = msg('a1', { swipeGroupId: 'A' })
    const a2 = msg('a2', { swipeGroupId: 'A' })
    const b1 = msg('b1', { swipeGroupId: 'B' })
    const b2 = msg('b2', { swipeGroupId: 'B' })
    act(() => {
      result.current.setMessages([a1, b1])
      result.current.setSwipeStates({
        A: { current: 0, total: 2, messages: [a1, a2] },
        B: { current: 0, total: 2, messages: [b1, b2] },
      })
    })

    const step = result.current.stepSwipe
    act(() => step('A', 'next'))
    act(() => step('B', 'next'))

    expect(result.current.messages.map(m => m.id)).toEqual(['a2', 'b2'])
    expect(result.current.swipeStates.A.current).toBe(1)
    expect(result.current.swipeStates.B.current).toBe(1)
  })
})

describe('useTurnManagement queue rollback (#306)', () => {
  it('restores the queue and says so when the server refuses', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 500, statusText: 'err', json: async () => ({}) }))
    const turnState = { spokenSinceUserTurn: [], currentTurnParticipantId: null, queue: [], lastSpeakerId: null }
    const setTurnState = jest.fn()
    const { result } = renderHook(() => useTurnManagement(
      'chat-1', [], turnState as never, null, setTurnState, jest.fn(), jest.fn(),
    ))

    await act(async () => {
      await result.current.handleQueue('p-1')
    })

    expect(setTurnState).toHaveBeenCalledTimes(2)
    expect(setTurnState.mock.calls[0][0].queue).toEqual(['p-1'])
    expect(setTurnState.mock.calls[1][0]).toBe(turnState)
    expect(showErrorToast).toHaveBeenCalled()
  })
})

describe('useImpersonation server-side clear (#313)', () => {
  it('drops the list and the active speaker when the chat comes back empty', () => {
    const base = { id: 'chat-1', participants: [] } as unknown as Chat
    const { result, rerender } = renderHook(({ chat }: { chat: Chat }) => useImpersonation({
      chatId: 'chat-1',
      chat,
      fetchChat: jest.fn(),
      setSelectLLMProfileDialogState: jest.fn(),
    }), { initialProps: { chat: { ...base, impersonatingParticipantIds: ['x'], activeTypingParticipantId: 'x' } as Chat } })

    expect(result.current.impersonatingParticipantIds).toEqual(['x'])
    expect(result.current.activeTypingParticipantId).toBe('x')

    rerender({ chat: { ...base, impersonatingParticipantIds: [], activeTypingParticipantId: null } as Chat })

    expect(result.current.impersonatingParticipantIds).toEqual([])
    expect(result.current.activeTypingParticipantId).toBeNull()
  })

  it('hands the speaker to a seat still impersonated when one is dropped', () => {
    const base = { id: 'chat-1', participants: [] } as unknown as Chat
    const { result, rerender } = renderHook(({ chat }: { chat: Chat }) => useImpersonation({
      chatId: 'chat-1',
      chat,
      fetchChat: jest.fn(),
      setSelectLLMProfileDialogState: jest.fn(),
    }), { initialProps: { chat: { ...base, impersonatingParticipantIds: ['x', 'y'], activeTypingParticipantId: 'x' } as Chat } })

    rerender({ chat: { ...base, impersonatingParticipantIds: ['y'], activeTypingParticipantId: 'y' } as Chat })

    expect(result.current.activeTypingParticipantId).toBe('y')
  })
})

describe('useTerminalMode re-hydrate (#262)', () => {
  it('a hidden pane stays hidden when the chat object is re-spread', async () => {
    const chat = { id: 'chat-1', participants: [], terminalMode: 'split', activeTerminalSessionId: 's1' } as unknown as Chat
    const { result, rerender } = renderHook(({ chat }: { chat: Chat }) => useTerminalMode({
      chatId: 'chat-1',
      chat,
      fetchChat: jest.fn(),
    }), { initialProps: { chat } })

    await waitFor(() => expect(result.current.terminalMode).toBe('split'))

    await act(async () => {
      await result.current.hidePane()
    })
    expect(result.current.terminalMode).toBe('normal')

    rerender({ chat: { ...chat } as Chat })
    await act(async () => {})

    expect(result.current.terminalMode).toBe('normal')
  })
})
