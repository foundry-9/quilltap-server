/**
 * The shared profile lists: a write through one view refreshes every other
 * view on the same client. The Settings "by kind" tabs used to hold private
 * copies, so a profile created there was missing from every other dropdown
 * and a deleted one could still be picked.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import {
  useConnectionProfilesQuery,
  useEmbeddingProfilesQuery,
  useImageProfilesQuery,
} from '@/lib/hooks/use-profiles'
import { useConnectionProfiles } from '@/components/settings/connection-profiles/hooks/useConnectionProfiles'
import { useEmbeddingProfiles } from '@/components/settings/embedding-profiles/hooks/useEmbeddingProfiles'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/hooks/useAutoAssociate', () => ({ useAutoAssociate: () => jest.fn() }))

const mockFetch = global.fetch as jest.Mock
let connection: Array<{ id: string; name: string }>
let embedding: Array<{ id: string; name: string }>

beforeEach(() => {
  connection = [{ id: 'c1', name: 'Gatsby' }, { id: 'c2', name: 'Daisy' }]
  embedding = [{ id: 'e1', name: 'Small' }]
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/v1/connection-profiles/c2' && init?.method === 'DELETE') {
      connection = connection.filter((p) => p.id !== 'c2')
      return ok({ success: true })
    }
    if (url === '/api/v1/connection-profiles') return ok({ profiles: connection })
    if (url === '/api/v1/embedding-profiles') return ok({ profiles: embedding })
    if (url === '/api/v1/image-profiles') return ok({ profiles: [] })
    if (url === '/api/v1/api-keys') return ok({ apiKeys: [] })
    if (url === '/api/v1/providers') return ok({ providers: [] })
    if (url.startsWith('/api/v1/embedding-profiles?action=list-models')) return ok({})
    if (url.startsWith('/api/v1/embedding-profiles?action=list-providers')) return ok({ providers: [] })
    if (url === '/api/v1/settings/chat') return ok({})
    return ok({})
  })
})

describe('shared profile lists', () => {
  it('a delete in the settings tab removes the profile from a picker on the same client', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({
        tab: useConnectionProfiles(),
        picker: useConnectionProfilesQuery({ select: (rows) => rows.map((r) => r.name) }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.picker.data).toEqual(['Gatsby', 'Daisy']))

    await act(async () => { await result.current.tab.handleDelete('c2') })
    await waitFor(() => expect(result.current.picker.data).toEqual(['Gatsby']))
    expect(result.current.tab.profiles.map((p) => p.id)).toEqual(['c1'])
  })

  it('a save in the embedding tab refreshes a picker on the same client', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({ tab: useEmbeddingProfiles(), picker: useEmbeddingProfilesQuery() }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.picker.data).toHaveLength(1))

    embedding = [...embedding, { id: 'e2', name: 'Large' }]
    await act(async () => { await result.current.tab.refreshProfiles() })
    await waitFor(() => expect(result.current.picker.data?.map((p) => p.id)).toEqual(['e1', 'e2']))
  })

  it('unwraps the envelope and applies the caller select', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useImageProfilesQuery({ select: (rows) => rows.length }), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(0))
  })
})
