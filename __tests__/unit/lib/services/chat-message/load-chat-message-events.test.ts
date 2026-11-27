/**
 * The one transcript read every extraction path starts from leaves out the
 * swipe variants a regenerate replaced (#236), so re-extracting a re-rolled
 * turn forms memories from the new line, not the old one again.
 */

const getMessages = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ chats: { getMessages } }),
}))

import { loadChatMessageEvents } from '@/lib/services/chat-message/turn-transcript'

describe('loadChatMessageEvents', () => {
  it('returns message rows with only the newest variant of each swipe group', async () => {
    getMessages.mockResolvedValue([
      { type: 'message', id: 'u1', role: 'USER' },
      { type: 'message', id: 'a1', role: 'ASSISTANT', swipeGroupId: 'swipe-a1', swipeIndex: 0 },
      { type: 'context-summary', id: 'cs' },
      { type: 'message', id: 'a1b', role: 'ASSISTANT', swipeGroupId: 'swipe-a1', swipeIndex: 1 },
      { type: 'message', id: 'u2', role: 'USER' },
    ])
    const rows = await loadChatMessageEvents('chat-1')
    expect(getMessages).toHaveBeenCalledWith('chat-1')
    expect(rows.map(r => r.id)).toEqual(['u1', 'a1b', 'u2'])
  })
})
