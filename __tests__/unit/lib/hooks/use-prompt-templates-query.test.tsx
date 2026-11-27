/**
 * `usePromptTemplatesQuery` — the one read of `/api/v1/prompt-templates`:
 * unwraps `templates`, applies the caller's `select`, honours `enabled`, and
 * caches under `queryKeys.promptTemplates.list()` so two readers share a fetch.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { usePromptTemplatesQuery } from '@/lib/hooks/use-profiles'
import { queryKeys } from '@/lib/query/keys'

const mockFetch = global.fetch as jest.Mock
const templates = [
  { id: 't1', name: 'Narrator', content: 'You narrate.' },
  { id: 't2', name: 'Butler', content: 'You buttle.' },
]

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/v1/prompt-templates' ? { templates, count: templates.length } : {}),
  }))
})

describe('usePromptTemplatesQuery', () => {
  it('unwraps the templates envelope', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => usePromptTemplatesQuery(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(templates))
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/prompt-templates', expect.anything())
  })

  it('applies the caller select', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => usePromptTemplatesQuery({ select: (rows) => rows.map((t) => t.name) }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toEqual(['Narrator', 'Butler']))
  })

  it('reads as empty when the envelope has no templates', async () => {
    mockFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => usePromptTemplatesQuery(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  it('does not fetch while disabled', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => usePromptTemplatesQuery({ enabled: false }), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('caches under the promptTemplates list key', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    const { result } = renderHook(() => usePromptTemplatesQuery(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(queryKeys.promptTemplates.list())).toEqual({ templates, count: 2 })
  })
})
