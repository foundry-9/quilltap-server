/**
 * useDynamicBackground: gated on the setting and tab visibility, fetches the
 * collage status, preloads the URL before returning it, and keeps the previous
 * URL until a new one loads (and when it fails).
 */

import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { createQueryWrapper } from '../../helpers/renderWithQuery'
import { WorkspaceTabVisibilityProvider } from '@/components/workspace/workspace-tab-context'
import { useDynamicBackground } from '@/hooks/useDynamicBackground'

class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  constructor() {
    FakeImage.instances.push(this)
  }
}

const SETTINGS_URL = '/api/v1/settings/chat'
const BG_PATH = '/api/v1/system/dynamic-backgrounds'

type Dyn = { enabled: boolean; allowUncensored?: boolean; refreshMinutes?: number }

describe('useDynamicBackground', () => {
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
  const realImage = global.Image
  let dyn: Dyn
  let urls: string[]

  const bgCalls = () =>
    mockFetch.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.startsWith(BG_PATH))

  const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response)

  const loadedImage = (url: string) => FakeImage.instances.filter((i) => i.src === url).pop()

  beforeEach(() => {
    jest.clearAllMocks()
    FakeImage.instances = []
    ;(global as unknown as { Image: unknown }).Image = FakeImage
    dyn = { enabled: true, allowUncensored: false, refreshMinutes: 3 }
    urls = ['/collage/one.webp']
    let n = 0
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === SETTINGS_URL) return ok({ id: 'cs', dynamicBackgrounds: dyn })
      if (url.startsWith(BG_PATH)) {
        const u = urls[Math.min(n, urls.length - 1)]
        n += 1
        return ok({ enabled: true, available: true, count: 5, refreshMinutes: 3, url: u })
      }
      return ok({})
    })
  })

  afterEach(() => {
    ;(global as unknown as { Image: unknown }).Image = realImage
    jest.useRealTimers()
  })

  function setup(visible: boolean, ...args: [scope: 'home'] | [scope: 'project' | 'character', id: string]) {
    const { wrapper: QueryWrapper, queryClient } = createQueryWrapper()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryWrapper>
        <WorkspaceTabVisibilityProvider visible={visible}>{children}</WorkspaceTabVisibilityProvider>
      </QueryWrapper>
    )
    const hook = renderHook(
      () => (useDynamicBackground as (...a: unknown[]) => string | null)(...args),
      { wrapper },
    )
    return { ...hook, queryClient }
  }

  it('returns null and makes no collage request while disabled', async () => {
    dyn = { enabled: false }
    const { result } = setup(true, 'home')
    await waitFor(
      () => expect(mockFetch.mock.calls.some(([u]) => String(u) === SETTINGS_URL)).toBe(true),
      { timeout: 4000 },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(bgCalls()).toHaveLength(0)
    expect(result.current).toBeNull()
  })

  it('makes no request while the tab is hidden', async () => {
    const { result } = setup(false, 'home')
    await waitFor(
      () => expect(mockFetch.mock.calls.some(([u]) => String(u) === SETTINGS_URL)).toBe(true),
      { timeout: 4000 },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(bgCalls()).toHaveLength(0)
    expect(result.current).toBeNull()
  })

  it('requests the home scope and returns the URL only once the image has loaded', async () => {
    const { result } = setup(true, 'home')
    await waitFor(() => expect(bgCalls().length).toBeGreaterThan(0), { timeout: 4000 })
    const params = new URL(bgCalls()[0], 'http://localhost').searchParams
    expect(params.get('scope')).toBe('home')
    expect(params.get('id')).toBeNull()

    await waitFor(() => expect(loadedImage('/collage/one.webp')).toBeDefined(), { timeout: 4000 })
    expect(result.current).toBeNull()

    act(() => {
      loadedImage('/collage/one.webp')!.onload?.()
    })
    await waitFor(() => expect(result.current).toBe('/collage/one.webp'), { timeout: 4000 })
  })

  it.each(['project', 'character'] as const)('sends the id for the %s scope', async (scope) => {
    setup(true, scope, 'abc-123')
    await waitFor(() => expect(bgCalls().length).toBeGreaterThan(0), { timeout: 4000 })
    const params = new URL(bgCalls()[0], 'http://localhost').searchParams
    expect(params.get('scope')).toBe(scope)
    expect(params.get('id')).toBe('abc-123')
  })

  it('keeps the first URL until the second has loaded, and keeps it if the second fails', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    urls = ['/collage/one.webp', '/collage/two.webp', '/collage/three.webp']
    dyn = { enabled: true, refreshMinutes: 1 }
    const { result } = setup(true, 'home')

    await waitFor(() => expect(loadedImage('/collage/one.webp')).toBeDefined(), { timeout: 4000 })
    act(() => {
      loadedImage('/collage/one.webp')!.onload?.()
    })
    await waitFor(() => expect(result.current).toBe('/collage/one.webp'), { timeout: 4000 })

    // The interval elapses: a second collage is fetched and preloaded.
    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    await waitFor(() => expect(loadedImage('/collage/two.webp')).toBeDefined(), { timeout: 4000 })
    expect(bgCalls().length).toBeGreaterThanOrEqual(2)
    expect(result.current).toBe('/collage/one.webp')

    act(() => {
      loadedImage('/collage/two.webp')!.onload?.()
    })
    await waitFor(() => expect(result.current).toBe('/collage/two.webp'), { timeout: 4000 })

    // A third that fails to load leaves the second in place.
    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    await waitFor(() => expect(loadedImage('/collage/three.webp')).toBeDefined(), { timeout: 4000 })
    act(() => {
      loadedImage('/collage/three.webp')!.onerror?.()
    })
    expect(result.current).toBe('/collage/two.webp')
  })

  it('does not refetch before the configured interval has elapsed', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    dyn = { enabled: true, refreshMinutes: 5 }
    setup(true, 'home')
    await waitFor(() => expect(bgCalls()).toHaveLength(1), { timeout: 4000 })

    await act(async () => {
      jest.advanceTimersByTime(4 * 60_000)
    })
    expect(bgCalls()).toHaveLength(1)

    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    await waitFor(() => expect(bgCalls()).toHaveLength(2), { timeout: 4000 })
  })
})
