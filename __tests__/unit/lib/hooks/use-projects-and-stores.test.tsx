/**
 * The Prospero list and the Scriptorium list are shared queries: a write in
 * one view refreshes a picker on the same client, and the realtime topics'
 * prefixes reach them.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useProjects } from '@/app/prospero/hooks/useProjects'
import { useProjectsQuery } from '@/lib/hooks/use-projects'
import { useDocumentStores } from '@/app/scriptorium/hooks/useDocumentStores'
import { useDocumentStoresQuery } from '@/lib/hooks/use-document-stores'
import { queryKeysForTopic } from '@/lib/realtime/topic-map'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

const mockFetch = global.fetch as jest.Mock
let projects: Array<Record<string, unknown>>
let stores: Array<Record<string, unknown>>

beforeEach(() => {
  projects = [{ id: 'p1', name: 'West Egg', _count: { chats: 2, files: 1, characters: 3 } }]
  stores = [{ id: 's1', name: 'Library' }]
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/v1/projects' && init?.method === 'POST') {
      const project = { id: 'p2', name: 'East Egg' }
      projects = [...projects, project]
      return ok({ project })
    }
    if (url === '/api/v1/projects') return ok({ projects })
    if (url === '/api/v1/mount-points/s1' && init?.method === 'DELETE') {
      stores = []
      return ok({ success: true })
    }
    if (url === '/api/v1/mount-points') return ok({ mountPoints: stores })
    return ok({})
  })
})

describe('shared project and store lists', () => {
  it('a project created in Prospero shows in a project picker; counts are mapped', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({ list: useProjects(), picker: useProjectsQuery({ select: (r) => r.map((p) => p.name) }) }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.list.projects).toHaveLength(1))
    expect(result.current.list.projects[0]).toMatchObject({ chatCount: 2, fileCount: 1, characterCount: 3 })

    await act(async () => { await result.current.list.createProject('East Egg', null) })
    await waitFor(() => expect(result.current.picker.data).toEqual(['West Egg', 'East Egg']))
  })

  it('a store deleted in the Scriptorium leaves a store picker on the same client', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({ list: useDocumentStores(), picker: useDocumentStoresQuery() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.picker.data).toHaveLength(1))
    await act(async () => { await result.current.list.deleteStore('s1') })
    await waitFor(() => expect(result.current.picker.data).toHaveLength(0))
    expect(result.current.list.stores).toHaveLength(0)
  })

  it('a scoped mountPoints hint reaches the store list key', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    renderHook(() => useDocumentStoresQuery(), { wrapper })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/v1/mount-points', expect.anything()))
    const calls = mockFetch.mock.calls.length
    stores = [...stores, { id: 's2', name: 'Annex' }]
    await act(async () => {
      for (const queryKey of queryKeysForTopic('mountPoints', 's2')) {
        await queryClient.invalidateQueries({ queryKey })
      }
    })
    expect(mockFetch.mock.calls.length).toBeGreaterThan(calls)
  })
})
