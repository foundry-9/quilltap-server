/**
 * useCreateProject — the one project create, shared by Prospero and the
 * homepage quick actions.
 */
import { act, renderHook } from '@testing-library/react'
import { createQueryWrapper, createTestQueryClient } from '../../../helpers/renderWithQuery'
import { useCreateProject } from '@/lib/hooks/use-projects'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const mockFetch = global.fetch as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockReset()
})

describe('useCreateProject', () => {
  it('posts the project, refreshes the project lists and returns the row', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ project: { id: 'p2', name: 'East Egg' } }) })
    const client = createTestQueryClient()
    const invalidate = jest.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateProject(), (createQueryWrapper(client)))

    let project: unknown
    await act(async () => {
      project = await result.current('East Egg', null)
    })

    expect(project).toEqual({ id: 'p2', name: 'East Egg' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/v1/projects')
    expect(JSON.parse(init.body)).toEqual({ name: 'East Egg', description: null })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.lists })
    expect(showSuccessToast).toHaveBeenCalled()
  })

  it('toasts the server sentence and returns null on failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Name taken' }) })
    const { result } = renderHook(() => useCreateProject(), (createQueryWrapper()))

    let project: unknown = 'unset'
    await act(async () => {
      project = await result.current('West Egg', 'x')
    })

    expect(project).toBeNull()
    expect(showErrorToast).toHaveBeenCalledWith('Name taken')
  })
})
