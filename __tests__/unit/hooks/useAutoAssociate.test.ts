/**
 * Unit tests for useAutoAssociate hook
 * Tests auto-association of profiles with API keys
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { renderHook, act } from '@testing-library/react'

jest.mock('@/lib/fetch-helpers', () => ({
  fetchJson: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
}))

import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast } from '@/lib/toast'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>
const mockShowSuccessToast = showSuccessToast as jest.MockedFunction<typeof showSuccessToast>

describe('useAutoAssociate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return a function', () => {
    const { result } = renderHook(() => useAutoAssociate())
    expect(typeof result.current).toBe('function')
  })

  it('should call fetchJson when invoked', async () => {
    mockFetchJson.mockResolvedValue({
      ok: true,
      data: { success: true, associations: [] },
    } as any)

    const { result } = renderHook(() => useAutoAssociate())

    await act(async () => {
      await result.current()
    })

    expect(mockFetchJson).toHaveBeenCalledWith('/api/v1/api-keys?action=auto-associate', {
      method: 'POST',
    })
  })

  it('should show toast for each association', async () => {
    mockFetchJson.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        associations: [
          { profileName: 'GPT-4', keyLabel: 'OpenAI Key 1' },
          { profileName: 'Claude', keyLabel: 'Anthropic Key' },
        ],
      },
    } as any)

    const { result } = renderHook(() => useAutoAssociate())

    await act(async () => {
      await result.current()
    })

    expect(mockShowSuccessToast).toHaveBeenCalledTimes(2)
    expect(mockShowSuccessToast).toHaveBeenNthCalledWith(
      1,
      'GPT-4 linked to API key "OpenAI Key 1"',
      4000
    )
    expect(mockShowSuccessToast).toHaveBeenNthCalledWith(
      2,
      'Claude linked to API key "Anthropic Key"',
      4000
    )
  })

  it('should not show toast when no associations', async () => {
    mockFetchJson.mockResolvedValue({
      ok: true,
      data: { success: true, associations: [] },
    } as any)

    const { result } = renderHook(() => useAutoAssociate())

    await act(async () => {
      await result.current()
    })

    expect(mockShowSuccessToast).not.toHaveBeenCalled()
  })

  it('should not show toast when response fails', async () => {
    mockFetchJson.mockResolvedValue({
      ok: false,
      data: null,
    } as any)

    const { result } = renderHook(() => useAutoAssociate())

    await act(async () => {
      await result.current()
    })

    expect(mockShowSuccessToast).not.toHaveBeenCalled()
  })

  it('should handle errors silently', async () => {
    mockFetchJson.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useAutoAssociate())

    // Should not throw
    await act(async () => {
      await result.current()
    })

    expect(mockShowSuccessToast).not.toHaveBeenCalled()
  })

  it('should be callable multiple times', async () => {
    mockFetchJson.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        associations: [{ profileName: 'GPT-4', keyLabel: 'OpenAI Key' }],
      },
    } as any)

    const { result } = renderHook(() => useAutoAssociate())

    await act(async () => {
      await result.current()
    })

    await act(async () => {
      await result.current()
    })

    expect(mockFetchJson).toHaveBeenCalledTimes(2)
    expect(mockShowSuccessToast).toHaveBeenCalledTimes(2)
  })
})
