/**
 * Unit tests for useAvatarDisplay hook
 */

import { describe, it, expect, afterEach } from '@jest/globals'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { AvatarDisplayProvider } from '@/components/providers/avatar-display-provider'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../helpers/renderWithQuery'

function jsonResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response)
}

// The provider reads the shared settings query, so it needs a client.
let client = createTestQueryClient()
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>
    <AvatarDisplayProvider>{children}</AvatarDisplayProvider>
  </QueryClientProvider>
)

describe('useAvatarDisplay', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    client = createTestQueryClient()
  })

  it('loads avatar style from chat settings', async () => {
    jest.spyOn(global as any, 'fetch').mockResolvedValue(
      jsonResponse({ avatarDisplayStyle: 'RECTANGULAR' })
    )

    const { result } = renderHook(() => useAvatarDisplay(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.style).toBe('RECTANGULAR')
    expect(result.current.error).toBeNull()
  })

  it('defaults to circular style on unauthorized response', async () => {
    jest.spyOn(global as any, 'fetch').mockResolvedValue(
      jsonResponse({}, false, 401)
    )

    const { result } = renderHook(() => useAvatarDisplay(), { wrapper })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.style).toBe('CIRCULAR')
    expect(result.current.error).toBeNull()
  })

  it('updates avatar style via PUT request', async () => {
    const fetchMock = jest.spyOn(global as any, 'fetch')
    // Use mockImplementation to handle multiple calls by URL
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/v1/settings/chat') {
        if (options?.method === 'PUT') {
          return jsonResponse({ avatarDisplayStyle: 'RECTANGULAR' })
        }
        // GET request
        return jsonResponse({ avatarDisplayStyle: 'CIRCULAR' })
      }
      // Return 404 for any other URLs (like logger endpoints)
      return jsonResponse({}, false, 404)
    })

    const { result } = renderHook(() => useAvatarDisplay(), { wrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.updateAvatarDisplayStyle('RECTANGULAR')
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/settings/chat',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ avatarDisplayStyle: 'RECTANGULAR' }),
      })
    )
    await waitFor(() => expect(result.current.style).toBe('RECTANGULAR'))
  })

  it('follows a change written to the shared settings row elsewhere', async () => {
    jest.spyOn(global as any, 'fetch').mockImplementation(() =>
      jsonResponse({ avatarDisplayStyle: 'CIRCULAR' })
    )

    const { result } = renderHook(() => useAvatarDisplay(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.style).toBe('CIRCULAR')

    // The settings card's write lands in the same cache entry.
    act(() => {
      client.setQueryData(['settings', 'chat'], { avatarDisplayStyle: 'RECTANGULAR' })
    })
    await waitFor(() => expect(result.current.style).toBe('RECTANGULAR'))
  })
})
