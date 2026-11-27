/**
 * useChatMentions — one read per chat and kind, a row's share filtered from it.
 * Absent characters come back as the server lists them; Atlas entries become
 * thing chips.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { useChatMentionList, useChatMentions } from '@/hooks/useChatMentions'
import { createQueryWrapper } from '../../helpers/renderWithQuery'

jest.mock('@/hooks/useRealtime', () => ({ useRealtimeRefetchInterval: () => false }))

const mockFetch = global.fetch as jest.Mock

const absent = [
  { kind: 'person', characterId: 'c1', name: 'Aunt Agatha', text: 'Agatha', messageId: 'm1', avatarUrl: null },
  { kind: 'person', characterId: 'c2', name: 'Gussie', text: 'Gussie', messageId: 'm2' },
]
const atlas = [
  { entryId: 'e1', text: 'the Drones Club', card: { name: 'The Drones Club' }, messageId: 'm1' },
]

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('?action=absent-mentions')
        ? { mentions: absent }
        : url.endsWith('?action=atlas-mentions')
          ? { mentions: atlas }
          : {},
  }))
})

describe('useChatMentions', () => {
  it('reads each kind from its own action and keeps a row to its own mentions', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({
        people: useChatMentions('absent', 'chat-1', 'm1'),
        things: useChatMentions('atlas', 'chat-1', 'm1'),
        none: useChatMentions('atlas', 'chat-1', 'm2'),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.things).toHaveLength(1))
    await waitFor(() => expect(result.current.people).toHaveLength(1))
    expect(result.current.people[0]).toEqual(absent[0])
    expect(result.current.things[0]).toEqual({
      kind: 'thing',
      entryId: 'e1',
      text: 'the Drones Club',
      card: { name: 'The Drones Club' },
    })
    expect(result.current.none).toEqual([])
    expect(mockFetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/api/v1/chats/chat-1?action=absent-mentions',
      '/api/v1/chats/chat-1?action=atlas-mentions',
    ])
  })

  it('gives the sidebar the whole list, and reads nothing without a chat', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({ all: useChatMentionList('absent', 'chat-1'), idle: useChatMentionList('atlas', undefined) }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.all).toHaveLength(2))
    expect(result.current.idle).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
