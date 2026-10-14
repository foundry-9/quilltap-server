import { renderHook, act } from '@testing-library/react'

jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))
jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

import { useSummaryActions } from '@/app/salon/[id]/hooks/useSummaryActions'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

const fetchFn = () => global.fetch as unknown as jest.Mock

describe('useSummaryActions.handleRebuildSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as unknown as typeof fetch
  })

  const run = async () => {
    const { result } = renderHook(() => useSummaryActions({ chatId: 'c1' }))
    await act(async () => {
      await result.current.handleRebuildSummary()
    })
  }

  it('does nothing when the confirmation is declined', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(false)
    await run()
    expect(showConfirmation).toHaveBeenCalledTimes(1)
    expect(fetchFn()).not.toHaveBeenCalled()
    expect(showSuccessToast).not.toHaveBeenCalled()
  })

  it('POSTs ?action=rebuild-summary once confirmed and refreshes the queue badge', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(true)
    fetchFn().mockResolvedValue({ ok: true, status: 200 })
    await run()
    expect(fetchFn()).toHaveBeenCalledWith('/api/v1/chats/c1?action=rebuild-summary', { method: 'POST' })
    expect(showSuccessToast).toHaveBeenCalled()
    expect(notifyQueueChange).toHaveBeenCalled()
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('shows the server error on a failed response', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(true)
    fetchFn().mockResolvedValue({ ok: false, statusText: 'Bad', json: async () => ({ error: 'nope' }) })
    await run()
    expect(showErrorToast).toHaveBeenCalledWith('Failed to rebuild the summary: nope')
    expect(notifyQueueChange).not.toHaveBeenCalled()
  })

  it('falls back to statusText when the error body is unparseable', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(true)
    fetchFn().mockResolvedValue({
      ok: false,
      statusText: 'Server Error',
      json: async () => {
        throw new Error('x')
      },
    })
    await run()
    expect(showErrorToast).toHaveBeenCalledWith('Failed to rebuild the summary: Server Error')
  })

  it('shows a generic error when fetch throws', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(true)
    fetchFn().mockRejectedValue(new Error('offline'))
    await run()
    expect(showErrorToast).toHaveBeenCalledWith('Failed to rebuild the summary')
  })
})
