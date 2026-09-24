/**
 * Regression coverage for bug 170 — switching the Salon's "speaking as" seat
 * sent `?action=set-active-speaker` as a PUT, but the chat route serves that
 * action on POST only. Before the dispatch consolidation the PUT fell through
 * to the plain chat update and the switch never persisted; afterwards it was a
 * 400 "Unknown action" toast.
 */

import { renderHook, act } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

import { useImpersonation } from '@/app/salon/[id]/hooks/useImpersonation'
import { showErrorToast } from '@/lib/toast'

const fetchMock = global.fetch as jest.Mock

describe('useImpersonation — set-active-speaker (bug 170)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    jest.clearAllMocks()
  })

  it('posts the switch to the action the server actually serves', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({
      success: true,
      activeTypingParticipantId: 'p-laura',
      impersonatingParticipantIds: ['p-laura'],
    }) })

    const { result } = renderHook(() => useImpersonation({
      chatId: 'chat-1',
      chat: null,
      participantData: [],
      fetchChat: jest.fn().mockResolvedValue(undefined),
      setSelectLLMProfileDialogState: jest.fn(),
    }))

    await act(async () => {
      await result.current.handleSetActiveSpeaker('p-laura')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/chats/chat-1?action=set-active-speaker')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ participantId: 'p-laura' })
    expect(showErrorToast).not.toHaveBeenCalled()
    expect(result.current.activeTypingParticipantId).toBe('p-laura')
    expect(result.current.impersonatingParticipantIds).toEqual(['p-laura'])
  })
})
