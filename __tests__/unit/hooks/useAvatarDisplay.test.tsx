/**
 * Unit tests for useAvatarDisplay hook
 */

import { describe, it, expect, afterEach } from '@jest/globals'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { AvatarDisplayProvider } from '@/components/providers/avatar-display-provider'

function jsonResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response)
}

// Wrapper component that provides the AvatarDisplayProvider context
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AvatarDisplayProvider>{children}</AvatarDisplayProvider>
)

describe('useAvatarDisplay', () => {
  afterEach(() => {
    jest.restoreAllMocks()
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
      if (url === '/api/chat-settings') {
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
      '/api/chat-settings',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ avatarDisplayStyle: 'RECTANGULAR' }),
      })
    )
    expect(result.current.style).toBe('RECTANGULAR')
  })
})
