/**
 * The project page's chat list: pages through `?action=list-chats` as one
 * infinite query, and a removal re-reads it from the server.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useProjectChats, PROJECT_CHATS_PAGE_SIZE } from '@/app/prospero/[id]/hooks/useProjectChats'

jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }))

let serverChats: Array<{ id: string; title: string }>
const removed: string[] = []

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

describe('useProjectChats', () => {
  beforeEach(() => {
    removed.length = 0
    serverChats = Array.from({ length: PROJECT_CHATS_PAGE_SIZE + 3 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}` }))
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        const { chatId } = JSON.parse(init.body as string)
        removed.push(chatId)
        serverChats = serverChats.filter((c) => c.id !== chatId)
        return json({ success: true })
      }
      const params = new URL(url, 'http://localhost').searchParams
      const offset = Number(params.get('offset'))
      const limit = Number(params.get('limit'))
      const chats = serverChats.slice(offset, offset + limit)
      return json({
        chats,
        pagination: { total: serverChats.length, offset, limit, hasMore: offset + chats.length < serverChats.length },
      })
    })
  })

  it('loads the first page, then the next on demand', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProjectChats('p1'), { wrapper })
    await waitFor(() => expect(result.current.chats).toHaveLength(PROJECT_CHATS_PAGE_SIZE))
    expect(result.current.pagination.hasMore).toBe(true)
    expect(result.current.pagination.total).toBe(PROJECT_CHATS_PAGE_SIZE + 3)

    await act(async () => { await result.current.loadMoreChats() })
    await waitFor(() => expect(result.current.chats).toHaveLength(PROJECT_CHATS_PAGE_SIZE + 3))
    expect(result.current.pagination.hasMore).toBe(false)
  })

  it('re-reads the list after removing a chat', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProjectChats('p1'), { wrapper })
    await waitFor(() => expect(result.current.chats).toHaveLength(PROJECT_CHATS_PAGE_SIZE))

    await act(async () => { await result.current.handleRemoveChat('c0') })
    expect(removed).toEqual(['c0'])
    await waitFor(() => expect(result.current.chats.map((c) => c.id)).not.toContain('c0'))
    expect(result.current.pagination.total).toBe(PROJECT_CHATS_PAGE_SIZE + 2)
  })
})
