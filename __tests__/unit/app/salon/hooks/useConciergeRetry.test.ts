import { renderHook, act } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

import { useConciergeRetry } from '@/app/salon/[id]/hooks/useConciergeRetry'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

const fetchMockFn = () => global.fetch as unknown as jest.Mock

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('useConciergeRetry', () => {
  let fetchChat: jest.Mock
  let startPolling: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    fetchChat = jest.fn().mockResolvedValue(undefined)
    startPolling = jest.fn()
    global.fetch = jest.fn() as unknown as typeof fetch
  })

  const setup = () => renderHook(() => useConciergeRetry('chat-1', fetchChat, startPolling))

  it('keeps a stable controller identity across rerenders', () => {
    const { result, rerender } = setup()
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  describe('retryPicture', () => {
    it('POSTs the tool message id, refetches, and announces success', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(200, {}))
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('tool-9')
      })
      expect(fetchMockFn()).toHaveBeenCalledWith(
        '/api/v1/chats/chat-1?action=retry-image-uncensored',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolMessageId: 'tool-9' }),
        }),
      )
      expect(showInfoToast).toHaveBeenCalled()
      expect(fetchChat).toHaveBeenCalledTimes(1)
      expect(showSuccessToast).toHaveBeenCalled()
      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('explains a 409 no-understudy refusal in words', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(409, { error: 'no-understudy' }))
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('t')
      })
      expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('no uncensored desk'))
      expect(fetchChat).not.toHaveBeenCalled()
    })

    it('explains a 409 locked refusal in words', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(409, { error: 'locked' }))
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('t')
      })
      expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Locked'))
    })

    it('uses the server error text for other failures', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(500, { error: 'boom' }))
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('t')
      })
      expect(showErrorToast).toHaveBeenCalledWith('boom')
    })

    it('falls back to a default message when the body is unparseable', async () => {
      fetchMockFn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json')
        },
      })
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('t')
      })
      expect(showErrorToast).toHaveBeenCalledWith('The uncensored desk could not produce the picture')
    })

    it('reports a network failure', async () => {
      fetchMockFn().mockRejectedValue(new Error('offline'))
      const { result } = setup()
      await act(async () => {
        await result.current.retryPicture('t')
      })
      expect(showErrorToast).toHaveBeenCalledWith('offline')
    })

    it('ignores a second press for the same picture while in flight, then allows another', async () => {
      let resolve!: (v: unknown) => void
      fetchMockFn().mockImplementationOnce(() => new Promise(r => { resolve = r }))
      const { result } = setup()
      let first!: Promise<void>
      act(() => {
        first = result.current.retryPicture('same')
      })
      await act(async () => {
        await result.current.retryPicture('same')
      })
      expect(fetchMockFn()).toHaveBeenCalledTimes(1)
      await act(async () => {
        resolve(jsonRes(200, {}))
        await first
      })
      fetchMockFn().mockResolvedValue(jsonRes(200, {}))
      await act(async () => {
        await result.current.retryPicture('same')
      })
      expect(fetchMockFn()).toHaveBeenCalledTimes(2)
    })
  })

  describe('retryBackground', () => {
    it('POSTs kind=background, pings the queue and starts polling', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(200, {}))
      const { result } = setup()
      await act(async () => {
        await result.current.retryBackground()
      })
      expect(fetchMockFn()).toHaveBeenCalledWith(
        '/api/v1/chats/chat-1?action=retry-image-uncensored',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'background' }) }),
      )
      expect(showSuccessToast).toHaveBeenCalled()
      expect(notifyQueueChange).toHaveBeenCalled()
      expect(startPolling).toHaveBeenCalled()
    })

    it('says why on a 409 and does not poll', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(409, { error: 'locked' }))
      const { result } = setup()
      await act(async () => {
        await result.current.retryBackground()
      })
      expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Locked'))
      expect(startPolling).not.toHaveBeenCalled()
      expect(notifyQueueChange).not.toHaveBeenCalled()
    })

    it('uses a default message on an opaque failure', async () => {
      fetchMockFn().mockResolvedValue(jsonRes(500, {}))
      const { result } = setup()
      await act(async () => {
        await result.current.retryBackground()
      })
      expect(showErrorToast).toHaveBeenCalledWith('Failed to queue the backdrop')
    })

    it('reports a thrown fetch', async () => {
      fetchMockFn().mockRejectedValue(new Error('nope'))
      const { result } = setup()
      await act(async () => {
        await result.current.retryBackground()
      })
      expect(showErrorToast).toHaveBeenCalledWith('nope')
    })
  })
})
