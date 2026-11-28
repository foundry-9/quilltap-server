/**
 * #242: every "Re-extract memories" button goes through one helper, which
 * makes exactly one request (the server's wipe-and-rebuild action) and never
 * deletes on its own, so a refusal leaves the chat's memories alone.
 */

jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))
jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

import { confirmAndReextractChatMemories, REEXTRACT_MEMORIES_CONFIRMATION } from '@/lib/chat-utils'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

const confirm = showConfirmation as jest.Mock

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  }))
  global.fetch = fn as unknown as typeof fetch
  return fn
}

beforeEach(() => jest.clearAllMocks())

describe('confirmAndReextractChatMemories', () => {
  it('does nothing when the operator declines', async () => {
    confirm.mockResolvedValue(false)
    const fetchMock = mockFetch(200, {})
    expect(await confirmAndReextractChatMemories('chat-1')).toBe(false)
    expect(confirm).toHaveBeenCalledWith(REEXTRACT_MEMORIES_CONFIRMATION)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts only the reextract action, with no separate delete', async () => {
    confirm.mockResolvedValue(true)
    const fetchMock = mockFetch(200, { success: true, turnCount: 3 })
    expect(await confirmAndReextractChatMemories('chat-1')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1?action=reextract-memories', { method: 'POST' })
    expect(showSuccessToast).toHaveBeenCalled()
    expect(notifyQueueChange).toHaveBeenCalled()
  })

  it("shows the server's refusal and makes no other request", async () => {
    confirm.mockResolvedValue(true)
    const fetchMock = mockFetch(400, { error: 'No connection profile available for memory extraction.' })
    expect(await confirmAndReextractChatMemories('chat-1')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(showErrorToast).toHaveBeenCalledWith('No connection profile available for memory extraction.')
    expect(notifyQueueChange).not.toHaveBeenCalled()
  })
})
