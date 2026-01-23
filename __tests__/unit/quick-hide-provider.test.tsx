import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QuickHideProvider, useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSession } from '@/components/providers/session-provider'

const STORAGE_KEY = 'quilltap.quickHide.activeTags'
const defaultTags = [
  { id: 'tag-1', name: 'Spoilers', quickHide: true },
  { id: 'tag-2', name: 'NSFW', quickHide: true },
  { id: 'tag-3', name: 'Unrelated', quickHide: false },
]

const useSessionMock = useSession as jest.MockedFunction<typeof useSession>
const fetchMock = global.fetch as jest.Mock

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

  it('toggles tag visibility correctly', async () => {
    const { result } = await renderQuickHideHook()

    act(() => {
      result.current.toggleTag('tag-1')
    })

    expect(result.current.hiddenTagIds.has('tag-1')).toBe(true)
    expect(result.current.shouldHideByIds(['tag-1', 'tag-x'])).toBe(true)

    act(() => {
      result.current.toggleTag('tag-1')
    })

    expect(result.current.hiddenTagIds.has('tag-1')).toBe(false)
    expect(result.current.shouldHideByIds(['tag-1'])).toBe(false)
  })

  it('clears all hidden tags', async () => {
    const { result } = await renderQuickHideHook()

    act(() => {
      result.current.toggleTag('tag-1')
      result.current.toggleTag('tag-2')
    })

    expect(result.current.hiddenTagIds.size).toBe(2)

    act(() => {
      result.current.clearAllHidden()
    })

    expect(result.current.hiddenTagIds.size).toBe(0)
    expect(result.current.shouldHideByIds(['tag-1', 'tag-2'])).toBe(false)
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
