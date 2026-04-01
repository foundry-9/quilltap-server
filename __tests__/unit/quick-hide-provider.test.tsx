import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterAll } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QuickHideProvider, useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSession } from '@/components/providers/session-provider'
import { clientLogger } from '@/lib/client-logger'

jest.mock('@/lib/client-logger', () => ({
  clientLogger: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

const STORAGE_KEY = 'quilltap.quickHide.activeTags'
const defaultTags = [
  { id: 'tag-1', name: 'Spoilers', quickHide: true },
  { id: 'tag-2', name: 'NSFW', quickHide: true },
  { id: 'tag-3', name: 'Unrelated', quickHide: false },
]

const useSessionMock = useSession as jest.MockedFunction<typeof useSession>
const loggerMock = clientLogger as jest.Mocked<typeof clientLogger>
const fetchMock = global.fetch as jest.Mock
const globalAny = globalThis as any
const originalQueueMicrotask =
  globalAny.queueMicrotask ??
  ((cb: VoidFunction) => {
    Promise.resolve().then(cb)
  })

const queueMicrotaskMock = jest.fn<void, [VoidFunction]>()
let queuedMicrotasks: VoidFunction[] = []

const flushQueuedMicrotasks = () => {
  const callbacks = [...queuedMicrotasks]
  queuedMicrotasks = []
  callbacks.forEach((cb) => cb())
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QuickHideProvider>{children}</QuickHideProvider>
)

const renderQuickHideHook = async () => {
  const hook = renderHook(() => useQuickHide(), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('QuickHideProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    queuedMicrotasks = []
    queueMicrotaskMock.mockImplementation((cb: VoidFunction) => {
      queuedMicrotasks.push(cb)
    })
    globalAny.queueMicrotask = queueMicrotaskMock
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tags: defaultTags }),
    } as any)
    useSessionMock.mockReturnValue({
      data: { user: { id: 'user-1' } },
      status: 'authenticated',
      update: jest.fn(),
    } as any)
  })

  afterAll(() => {
    globalAny.queueMicrotask = originalQueueMicrotask
  })

  it('defers toggle logging until the microtask queue runs', async () => {
    const { result } = await renderQuickHideHook()

    act(() => {
      result.current.toggleTag('tag-1')
    })

    expect(result.current.hiddenTagIds.has('tag-1')).toBe(true)
    expect(queueMicrotaskMock).toHaveBeenCalledTimes(1)
    expect(loggerMock.debug).not.toHaveBeenCalled()

    flushQueuedMicrotasks()
    expect(loggerMock.debug).toHaveBeenCalledWith('Hiding tag', { tagId: 'tag-1' })
    expect(result.current.shouldHideByIds(['tag-1', 'tag-x'])).toBe(true)

    queueMicrotaskMock.mockClear()
    loggerMock.debug.mockClear()

    act(() => {
      result.current.toggleTag('tag-1')
    })

    expect(result.current.hiddenTagIds.has('tag-1')).toBe(false)
    expect(queueMicrotaskMock).toHaveBeenCalledTimes(1)
    expect(loggerMock.debug).not.toHaveBeenCalled()

    flushQueuedMicrotasks()

    expect(loggerMock.debug).toHaveBeenCalledWith('Unhiding tag', { tagId: 'tag-1' })
    expect(result.current.shouldHideByIds(['tag-1'])).toBe(false)
  })

  it('clears all hidden tags and logs after microtask processing', async () => {
    const { result } = await renderQuickHideHook()

    act(() => {
      result.current.toggleTag('tag-1')
      result.current.toggleTag('tag-2')
    })

    flushQueuedMicrotasks()
    expect(result.current.hiddenTagIds.size).toBe(2)

    queueMicrotaskMock.mockClear()
    loggerMock.debug.mockClear()

    act(() => {
      result.current.clearAllHidden()
    })

    expect(result.current.hiddenTagIds.size).toBe(0)
    expect(result.current.shouldHideByIds(['tag-1', 'tag-2'])).toBe(false)
    expect(queueMicrotaskMock).toHaveBeenCalledTimes(1)
    expect(loggerMock.debug).not.toHaveBeenCalled()

    flushQueuedMicrotasks()
    expect(loggerMock.debug).toHaveBeenCalledWith('Clearing all hidden tags', { previousCount: 2 })
  })

  it('restores persisted hidden tags but removes ones that no longer exist', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['tag-1', 'ghost']))

    const { result } = await renderQuickHideHook()

    expect(result.current.hiddenTagIds.has('tag-1')).toBe(true)
    expect(result.current.hiddenTagIds.has('ghost')).toBe(false)
    expect(result.current.shouldHideByIds(['tag-1'])).toBe(true)
    expect(result.current.shouldHideByIds(['ghost'])).toBe(false)
  })
})
