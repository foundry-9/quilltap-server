/**
 * The one-shot startup notifier behind the plugin-upgrade and
 * migration-warning toasts.
 */

import { createStartupNotifier } from '@/components/startup/startup-notices'

type Response = { items: string[] }

function okResponse(body: Response) {
  return { ok: true, status: 200, json: async () => body }
}

describe('createStartupNotifier', () => {
  const fetchMock = jest.fn()
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    jest.useFakeTimers()
    fetchMock.mockReset()
    errorSpy.mockClear()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function makeNotifier(shown: string[]) {
    return createStartupNotifier<Response>({
      initialDelayMs: 1000,
      url: '/read',
      markNotifiedUrl: '/mark',
      label: 'test notices',
      toNotices: (data) =>
        data.items.length === 0 ? null : data.items.map((item) => () => shown.push(item)),
    })
  }

  it('shows each notice in turn, then marks them notified', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ items: ['one', 'two'] })).mockResolvedValueOnce({ ok: true })
    const shown: string[] = []
    const done = makeNotifier(shown)()

    await jest.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledWith('/read')
    expect(shown).toEqual(['one'])

    await jest.advanceTimersByTimeAsync(3000)
    await done
    expect(shown).toEqual(['one', 'two'])
    expect(fetchMock).toHaveBeenLastCalledWith('/mark', { method: 'POST' })
  })

  it('marks nothing when there is nothing to show', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ items: [] }))
    const done = makeNotifier([])()
    await jest.advanceTimersByTimeAsync(1000)
    await done
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('logs a failed read and marks nothing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    const done = makeNotifier([])()
    await jest.advanceTimersByTimeAsync(1000)
    await done
    expect(errorSpy).toHaveBeenCalledWith('Failed to fetch test notices', { status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second call while the first is still running', async () => {
    fetchMock.mockResolvedValue(okResponse({ items: [] }))
    const notify = makeNotifier([])
    const first = notify()
    const second = notify()
    await jest.advanceTimersByTimeAsync(1000)
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
