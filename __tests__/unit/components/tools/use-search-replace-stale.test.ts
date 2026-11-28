/** #324: a late response for an earlier search never replaces the current preview. */
import { renderHook, act } from '@testing-library/react'
import { useSearchReplace } from '@/components/tools/search-replace/hooks/useSearchReplace'

const scope = { type: 'chat', chatId: 'c1' } as any
const preview = (n: number) => ({ messageMatches: n, memoryMatches: 0 })

function deferred() {
  let resolve!: (v: unknown) => void
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

describe('useSearchReplace stale previews', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('drops the preview on input change and ignores an out-of-order response', async () => {
    const first = deferred()
    const second = deferred()
    const calls = [first, second]
    global.fetch = jest.fn((_u: any, init: any) => {
      const d = calls.shift()!
      return d.promise.then((body) => {
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return { ok: true, json: async () => body }
      })
    }) as any

    const { result } = renderHook(() => useSearchReplace({ isOpen: true, initialScope: scope }))

    act(() => result.current.setSearchText('foo'))
    await act(async () => { jest.advanceTimersByTime(350) })
    act(() => result.current.setSearchText('foobar'))
    expect(result.current.preview).toBeNull()
    expect(result.current.canProceed).toBe(false)
    await act(async () => { jest.advanceTimersByTime(350) })

    await act(async () => { second.resolve(preview(2)) })
    await act(async () => { first.resolve(preview(99)) })

    expect(result.current.preview).toEqual(preview(2))
    expect(result.current.canProceed).toBe(true)
  })
})
