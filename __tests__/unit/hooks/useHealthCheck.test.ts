import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { useHealthCheck } from '@/hooks/useHealthCheck'

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

describe('useHealthCheck', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('shares a single initial health check across multiple subscribers', async () => {
    mockFetch.mockResolvedValue({ status: 200 } as Response)

    const first = renderHook(() => useHealthCheck())
    const second = renderHook(() => useHealthCheck())

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    expect(first.result.current).toEqual({
      lockConflict: null,
      versionBlock: null,
    })
    expect(second.result.current).toEqual({
      lockConflict: null,
      versionBlock: null,
    })

    first.unmount()
    second.unmount()
  })

  it('starts polling on a 409 response and stops after the problem is resolved', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval')
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval')

    mockFetch
      .mockResolvedValueOnce({
        status: 409,
        json: async () => ({
          lockConflict: {
            pid: 42,
            hostname: 'macbook',
            environment: 'dev',
            startedAt: '2026-04-12T00:00:00.000Z',
            lockPath: '/tmp/quilltap.lock',
          },
        }),
      } as Response)
      .mockResolvedValue({ status: 200 } as Response)

    const { result, unmount } = renderHook(() => useHealthCheck())

    await waitFor(() => {
      expect(result.current.lockConflict?.pid).toBe(42)
    })
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.lockConflict).toBeNull()
    })

    act(() => {
      jest.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    act(() => {
      jest.advanceTimersByTime(15000)
    })

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(clearIntervalSpy).toHaveBeenCalled()

    unmount()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})
