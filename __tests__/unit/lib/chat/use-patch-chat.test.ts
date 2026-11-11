/**
 * usePatchChat — the one component-side chat writer (#176).
 */
import { act, renderHook } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { usePatchChat } from '@/lib/chat/use-patch-chat'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }))

const mockFetch = global.fetch as jest.Mock

describe('usePatchChat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends a chat field under `chat`, toasts, runs onSaved and refreshes the chat reads', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ chat: {} }) })
    const { wrapper, queryClient } = createQueryWrapper()
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
    const onSaved = jest.fn()
    const { result } = renderHook(() => usePatchChat('c1', { onSaved }), { wrapper })

    let ok = false
    await act(async () => {
      ok = await result.current.patch({ alertCharactersOfLanternImages: true }, { success: 'Saved', failure: 'Nope' })
    })

    expect(ok).toBe(true)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/v1/chats/c1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ chat: { alertCharactersOfLanternImages: true } })
    expect(showSuccessToast).toHaveBeenCalledWith('Saved')
    expect(onSaved).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats.detail('c1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chats.project('c1') })
  })

  it('toasts the server sentence on a refusal and resolves false', async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: 'Unrecognized key' }),
    })
    const { wrapper } = createQueryWrapper()
    const onSaved = jest.fn()
    const { result } = renderHook(() => usePatchChat('c1', { onSaved }), { wrapper })

    let ok = true
    await act(async () => {
      ok = await result.current.update({ conciergeState: 'locked' }, { failure: 'Failed' })
    })
    expect(ok).toBe(false)
    expect(showErrorToast).toHaveBeenCalledWith('Unrecognized key')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
