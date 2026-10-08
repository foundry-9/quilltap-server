import { renderHook, act } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn() }))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

import { useRegeneration } from '@/app/salon/[id]/hooks/useRegeneration'
import { showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { TextEncoder as NodeTextEncoder } from 'util'

const fetchFn = () => global.fetch as unknown as jest.Mock
const enc = new NodeTextEncoder()

/** A fake streaming Response whose body yields the given string chunks. */
function streamRes(chunks: string[]) {
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: enc.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  }
}
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n`

describe('useRegeneration', () => {
  let rafCallbacks: Array<() => void>

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as unknown as typeof fetch
    rafCallbacks = []
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(() => cb(0))
      return rafCallbacks.length
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('starts idle', () => {
    const { result } = renderHook(() => useRegeneration())
    expect(result.current.regeneration).toBeNull()
    expect(result.current.regenerationStatus).toBeNull()
    expect(result.current.isRegenerating).toBe(false)
  })

  it('streams from the swipe endpoint, refetches, selects the new swipe and clears state', async () => {
    fetchFn().mockResolvedValue(streamRes([
      frame({ status: { stage: 'streaming', message: 'Writing' } }),
      frame({ content: 'Hel' }),
      frame({ content: 'lo' }),
      frame({ done: true, message: { id: 'new-1', content: 'Hello!' } }),
    ]))
    const fetchChat = jest.fn().mockResolvedValue(undefined)
    const select = jest.fn()
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', fetchChat, select)
    })
    expect(fetchFn()).toHaveBeenCalledWith('/api/v1/messages/m1?action=swipe&stream=1', { method: 'POST' })
    expect(fetchChat).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith('new-1')
    expect(notifyQueueChange).toHaveBeenCalled()
    expect(showErrorToast).not.toHaveBeenCalled()
    expect(result.current.isRegenerating).toBe(false)
    expect(result.current.regenerationStatus).toBeNull()
  })

  it('shows the plate in the preparing stage while the stream is pending', async () => {
    let release!: (v: unknown) => void
    fetchFn().mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useRegeneration())
    let p!: Promise<void>
    act(() => {
      p = result.current.regenerate('m1', jest.fn())
    })
    expect(result.current.regeneration).toEqual({ messageId: 'm1', stage: 'preparing', content: '', reasoning: '' })
    expect(result.current.regenerationStatus).toEqual({ stage: 'regenerating', message: 'Regenerating...' })
    expect(result.current.isRegenerating).toBe(true)
    await act(async () => {
      release(streamRes([frame({ done: true })]))
      await p
    })
    expect(result.current.isRegenerating).toBe(false)
  })

  it('coalesces content deltas to one frame flush and surfaces reasoning and status mid-stream', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const chunks = [
      frame({ status: { stage: 'streaming', message: 'Go' } }),
      frame({ content: 'ab' }),
      frame({ content: 'cd' }),
      frame({ reasoning: 'thinking' }),
    ]
    let i = 0
    fetchFn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) }
            await gate
            return { done: true, value: undefined }
          },
        }),
      },
    })
    const { result } = renderHook(() => useRegeneration())
    let p!: Promise<void>
    await act(async () => {
      p = result.current.regenerate('m1', jest.fn())
      await new Promise(r => setTimeout(r, 0))
    })
    expect(rafCallbacks).toHaveLength(1)
    expect(result.current.regenerationStatus).toEqual({ stage: 'streaming', message: 'Go' })
    expect(result.current.regeneration?.reasoning).toBe('thinking')
    expect(result.current.regeneration?.stage).toBe('preparing')
    await act(async () => {
      rafCallbacks[0]()
    })
    expect(result.current.regeneration).toMatchObject({ stage: 'streaming', content: 'abcd' })
    await act(async () => {
      release()
      await p
    })
  })

  it('reassembles an SSE frame split across network chunks', async () => {
    const full = frame({ done: true, message: { id: 'sw', content: 'x' } })
    fetchFn().mockResolvedValue(streamRes([full.slice(0, 10), full.slice(10)]))
    const select = jest.fn()
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn().mockResolvedValue(undefined), select)
    })
    expect(select).toHaveBeenCalledWith('sw')
  })

  it('ignores non-data lines and malformed JSON', async () => {
    fetchFn().mockResolvedValue(streamRes([
      ': keepalive\n',
      'data: {not json\n',
      'data: [DONE]\n',
      frame({ done: true, message: { id: 'ok' } }),
    ]))
    const select = jest.fn()
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn().mockResolvedValue(undefined), select)
    })
    expect(select).toHaveBeenCalledWith('ok')
    expect(showErrorToast).not.toHaveBeenCalled()
  })

  it('does not select a variant when the done frame carries no message id', async () => {
    fetchFn().mockResolvedValue(streamRes([frame({ done: true })]))
    const select = jest.fn()
    const fetchChat = jest.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', fetchChat, select)
    })
    expect(fetchChat).toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('honours options.url (Try uncensored)', async () => {
    fetchFn().mockResolvedValue(streamRes([frame({ done: true })]))
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn().mockResolvedValue(undefined), undefined, { url: '/custom?x=1' })
    })
    expect(fetchFn()).toHaveBeenCalledWith('/custom?x=1', { method: 'POST' })
  })

  it('toasts a stream error (with details), skips refetch and clears state', async () => {
    fetchFn().mockResolvedValue(streamRes([frame({ error: 'Provider down', details: 'timeout' })]))
    const fetchChat = jest.fn()
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', fetchChat)
    })
    expect(showErrorToast).toHaveBeenCalledWith('Provider down: timeout')
    expect(fetchChat).not.toHaveBeenCalled()
    expect(result.current.isRegenerating).toBe(false)
    expect(result.current.regenerationStatus).toBeNull()
  })

  it('toasts a stream error without details', async () => {
    fetchFn().mockResolvedValue(streamRes([frame({ error: 'Bad' })]))
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenCalledWith('Bad')
  })

  it('uses the server error from a non-ok response', async () => {
    fetchFn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'kaput' }) })
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenCalledWith('kaput')
  })

  it('falls back to a default message when the error body is unparseable', async () => {
    fetchFn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('x')
      },
    })
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenCalledWith('Failed to generate alternative response')
  })

  it.each([
    ['no-understudy', 'no uncensored desk'],
    ['locked', 'Locked'],
  ])('describes a 409 %s refusal in words', async (code, fragment) => {
    fetchFn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: code }) })
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining(fragment))
  })

  it('fails when the response has no readable body', async () => {
    fetchFn().mockResolvedValue({ ok: true, status: 200, body: null })
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenCalledWith('Failed to generate alternative response')
  })

  it('reports a thrown fetch and a non-Error rejection', async () => {
    fetchFn().mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useRegeneration())
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenLastCalledWith('offline')
    fetchFn().mockRejectedValueOnce('string')
    await act(async () => {
      await result.current.regenerate('m1', jest.fn())
    })
    expect(showErrorToast).toHaveBeenLastCalledWith('Failed to generate alternative response')
  })

  it('is a no-op for a second call while one is in flight, then re-arms', async () => {
    let release!: (v: unknown) => void
    fetchFn().mockImplementationOnce(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useRegeneration())
    let p!: Promise<void>
    act(() => {
      p = result.current.regenerate('m1', jest.fn())
    })
    await act(async () => {
      await result.current.regenerate('m2', jest.fn())
    })
    expect(fetchFn()).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(streamRes([frame({ done: true })]))
      await p
    })
    fetchFn().mockResolvedValue(streamRes([frame({ done: true })]))
    await act(async () => {
      await result.current.regenerate('m2', jest.fn().mockResolvedValue(undefined))
    })
    expect(fetchFn()).toHaveBeenCalledTimes(2)
  })

  it('cancels a pending frame flush on unmount', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let sent = false
    fetchFn().mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (!sent) { sent = true; return { done: false, value: enc.encode(frame({ content: 'a' })) } }
            await gate
            return { done: true, value: undefined }
          },
        }),
      },
    })
    const { result, unmount } = renderHook(() => useRegeneration())
    let p!: Promise<void>
    await act(async () => {
      p = result.current.regenerate('m1', jest.fn().mockResolvedValue(undefined))
      await new Promise(r => setTimeout(r, 0))
    })
    unmount()
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    release()
    await p
  })
})
