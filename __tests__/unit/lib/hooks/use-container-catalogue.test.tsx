/**
 * useContainerCatalogue — the characters, projects and groups the wardrobe's
 * and Inventory's container selects offer: sorted by name, unnamed projects
 * and groups given a placeholder, and `charactersSettled` true even when the
 * characters read fails (auto-selection must not wait forever).
 */

import { renderHook, waitFor } from '@testing-library/react'
import { useContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { createQueryWrapper } from '@/__tests__/helpers/renderWithQuery'

const fetchMock = global.fetch as jest.Mock

function respondByUrl(bodies: Record<string, { status?: number; body: unknown }>) {
  fetchMock.mockImplementation((url: string) => {
    const hit = bodies[url] ?? { status: 404, body: {} }
    const status = hit.status ?? 200
    return Promise.resolve({
      ok: status < 400,
      status,
      statusText: '',
      json: () => Promise.resolve(hit.body),
    })
  })
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('useContainerCatalogue', () => {
  it('reads all three lists, sorted by name, with placeholders for unnamed rows', async () => {
    respondByUrl({
      '/api/v1/characters': {
        body: { characters: [{ id: 'c2', name: 'Zelda' }, { id: 'c1', name: 'Ada', avatarUrl: '/a.webp' }] },
      },
      '/api/v1/projects': { body: { projects: [{ id: 'p2', name: 'Opus' }, { id: 'p1', name: '' }] } },
      '/api/v1/groups': { body: { groups: [{ id: 'g1', name: '' }, { id: 'g2', name: 'Crew' }] } },
    })

    const { result } = renderHook(() => useContainerCatalogue(), { wrapper: createQueryWrapper().wrapper })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.characters.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.current.characters[0].avatarUrl).toBe('/a.webp')
    expect(result.current.projects).toEqual([
      { id: 'p2', name: 'Opus' },
      { id: 'p1', name: 'Untitled project' },
    ])
    expect(result.current.groups).toEqual([
      { id: 'g2', name: 'Crew' },
      { id: 'g1', name: 'Untitled group' },
    ])
    expect(result.current.charactersSettled).toBe(true)
  })

  it('settles the characters read even when it fails, leaving the list empty', async () => {
    respondByUrl({
      '/api/v1/characters': { status: 500, body: { error: 'boom' } },
      '/api/v1/projects': { body: { projects: [] } },
      '/api/v1/groups': { body: {} },
    })

    const { result } = renderHook(() => useContainerCatalogue(), { wrapper: createQueryWrapper().wrapper })

    await waitFor(() => expect(result.current.charactersSettled).toBe(true))
    expect(result.current.characters).toEqual([])
    expect(result.current.groups).toEqual([])
  })
})
