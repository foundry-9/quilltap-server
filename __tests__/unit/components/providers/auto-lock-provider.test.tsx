import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { screen, waitFor, cleanup, act } from '@testing-library/react'
import { AutoLockProvider } from '@/components/providers/auto-lock-provider'
import { queryKeys } from '@/lib/query/keys'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const render = (ui: React.ReactElement) => renderWithQuery(ui)

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

describe('AutoLockProvider', () => {
  let now: number
  const fetchMock = global.fetch as jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    fetchMock.mockReset()
    cleanup()
    document.body.innerHTML = ''
    sessionStorage.clear()
    window.history.pushState({}, '', '/salon/chat-1')
    now = 0
    jest.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    cleanup()
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    document.body.innerHTML = ''
    sessionStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('reads config on mount and again when the settings card refreshes it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasUserPassphrase: true, autoLockMinutes: 5 })
    )

    const { queryClient } = render(<AutoLockProvider />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/system/unlock')
    })
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.system.unlock)).toBeDefined())

    // The settings card refreshes the shared entry when it saves.
    act(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.unlock })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('does not activate on setup or unlock routes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasUserPassphrase: true, autoLockMinutes: 5 })
    )

    window.history.pushState({}, '', '/unlock')
    render(<AutoLockProvider />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()

    cleanup()
    window.history.pushState({}, '', '/setup/profile')
    render(<AutoLockProvider />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows and auto-dismisses the idle warning toast', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasUserPassphrase: true, autoLockMinutes: 2 })
    )

    const { queryClient } = render(<AutoLockProvider />)

    await waitFor(() => expect(queryClient.getQueryData(queryKeys.system.unlock)).toBeDefined())

    act(() => {
      now = 60000
      jest.advanceTimersByTime(60000)
    })
    // The toast region renders its first toast a beat after it is created.
    act(() => {
      jest.advanceTimersByTime(100)
    })

    expect(screen.getByText(/Auto-Lock Warning/)).toBeInTheDocument()
    expect(
      screen.getByText(/approximately one minute due to inactivity/i)
    ).toBeInTheDocument()

    act(() => {
      now = 90100
      jest.advanceTimersByTime(30000)
    })

    expect(screen.queryByText(/Auto-Lock Warning/)).not.toBeInTheDocument()
  })

  it('does not show a warning when auto-lock is disabled', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hasUserPassphrase: false, autoLockMinutes: null })
    )

    render(<AutoLockProvider />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    act(() => {
      now = 300000
      jest.advanceTimersByTime(300000)
    })

    expect(screen.queryByText(/Auto-Lock Warning/)).not.toBeInTheDocument()
  })
})