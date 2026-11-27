/**
 * The provider list and the embedding provider names are each one cached read:
 * several views asking for them on one client share a single request, and each
 * narrows the rows with its own `select`.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useEmbeddingProviderNamesQuery, useProvidersQuery } from '@/lib/hooks/use-profiles'

const mockFetch = global.fetch as jest.Mock

const PROVIDERS = [
  { name: 'OPENAI', configRequirements: { requiresApiKey: true } },
  { name: 'OLLAMA', configRequirements: { requiresApiKey: false } },
]

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url === '/api/v1/providers') return ok({ providers: PROVIDERS })
    if (url === '/api/v1/embedding-profiles?action=list-providers') return ok({ providers: ['BUILTIN', 'OPENAI'] })
    return ok({})
  })
})

const callsTo = (url: string) => mockFetch.mock.calls.filter(([u]) => u === url).length

describe('useProvidersQuery', () => {
  it('unwraps the envelope and shares one request between selects', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => ({
        rows: useProvidersQuery<{ name: string }>(),
        names: useProvidersQuery<{ name: string }, string[]>({ select: (rows) => rows.map((r) => r.name) }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.names.data).toEqual(['OPENAI', 'OLLAMA']))
    expect(result.current.rows.data).toEqual(PROVIDERS)
    expect(callsTo('/api/v1/providers')).toBe(1)
  })

  it('reads an envelope without providers as an empty list', async () => {
    mockFetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProvidersQuery(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([]))
  })
})

describe('useEmbeddingProviderNamesQuery', () => {
  it('returns the provider names from list-providers', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useEmbeddingProviderNamesQuery(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(['BUILTIN', 'OPENAI']))
  })
})
