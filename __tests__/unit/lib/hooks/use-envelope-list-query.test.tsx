/**
 * `useEnvelopeListQuery` — the one body every entity list hook binds: fetch
 * the URL under the key, unwrap the envelope, then the caller's `select`.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useEnvelopeListQuery } from '@/lib/hooks/use-profiles'

const mockFetch = global.fetch as jest.Mock

const unwrapThings = (data: { things?: Array<{ id: string; name: string }> }) => data.things

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url === '/api/v1/things' ? { things: [{ id: 'a', name: 'Bertie' }, { id: 'b', name: 'Jeeves' }] } : {}),
  }))
})

describe('useEnvelopeListQuery', () => {
  it('unwraps the envelope into rows', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () => useEnvelopeListQuery({ queryKey: ['things'], url: '/api/v1/things', unwrap: unwrapThings }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'a', name: 'Bertie' }, { id: 'b', name: 'Jeeves' }])
  })

  it('runs the caller select on the unwrapped rows, and reads an absent envelope as empty', async () => {
    const { wrapper } = createQueryWrapper()
    const names = (rows: Array<{ id: string; name: string }>) => rows.map((r) => r.name)
    const { result } = renderHook(
      () => ({
        named: useEnvelopeListQuery({ queryKey: ['things'], url: '/api/v1/things', unwrap: unwrapThings, options: { select: names } }),
        empty: useEnvelopeListQuery({ queryKey: ['nothing'], url: '/api/v1/nothing', unwrap: unwrapThings }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.named.isSuccess && result.current.empty.isSuccess).toBe(true))
    expect(result.current.named.data).toEqual(['Bertie', 'Jeeves'])
    expect(result.current.empty.data).toEqual([])
  })

  it('lets the binding gate override the caller gate', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(
      () =>
        useEnvelopeListQuery({
          queryKey: ['things'],
          url: '/api/v1/things',
          unwrap: unwrapThings,
          options: { enabled: true },
          enabled: false,
        }),
      { wrapper },
    )
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
