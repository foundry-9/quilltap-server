/**
 * Linking a store through the project page's card refreshes every view of
 * the project's linked stores on the same client (the project store browser
 * reads the same entry), and a group reads its own route.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useOwnerStoreLinks, useOwnerStoresQuery } from '@/lib/hooks/use-owner-store-links'

const stores = [
  { id: 'm1', name: 'Ledger' },
  { id: 'm2', name: 'Almanack' },
]
let linked: Record<string, string[]>
const calls: string[] = []

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

describe('useOwnerStoreLinks', () => {
  beforeEach(() => {
    calls.length = 0
    linked = { 'projects/p1': [], 'groups/g1': ['m2'] }
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${url}`)
      if (url === '/api/v1/mount-points') return json({ mountPoints: stores })
      const owner = /\/api\/v1\/((?:projects|groups)\/[^/]+)\/mount-points/.exec(url)?.[1]
      if (!owner) return json({ error: 'not found' }, 404)
      if (method === 'POST') {
        const { mountPointId } = JSON.parse(init!.body as string)
        if (mountPointId === 'missing') return json({ error: 'Mount point not found' }, 404)
        linked[owner] = [...linked[owner], mountPointId]
        return json({ link: {} }, 201)
      }
      if (method === 'DELETE') {
        const id = new URL(url, 'http://localhost').searchParams.get('mountPointId')
        linked[owner] = linked[owner].filter((m) => m !== id)
        return json({ message: 'ok' })
      }
      return json({
        mountPoints: stores.filter((s) => linked[owner].includes(s.id)),
        officialMountPointId: null,
      })
    })
  })

  it('a link through one view updates a second view of the same owner', async () => {
    const { wrapper } = createQueryWrapper()
    const card = renderHook(() => useOwnerStoreLinks('project', 'p1'), { wrapper })
    const browser = renderHook(() => useOwnerStoresQuery({ kind: 'project', id: 'p1' }), { wrapper })
    await waitFor(() => expect(card.result.current.allStores).toHaveLength(2))
    expect(card.result.current.linkedStores).toEqual([])

    let ok = false
    await act(async () => { ok = await card.result.current.linkStore('m1') })
    expect(ok).toBe(true)
    await waitFor(() => expect(browser.result.current.data?.mountPoints.map((s) => s.id)).toEqual(['m1']))
    expect(card.result.current.linkedStores.map((s) => s.id)).toEqual(['m1'])

    await act(async () => { await card.result.current.unlinkStore('m1') })
    await waitFor(() => expect(browser.result.current.data?.mountPoints).toEqual([]))
  })

  it('reads a group through its own route', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useOwnerStoreLinks('group', 'g1'), { wrapper })
    await waitFor(() => expect(result.current.linkedStores.map((s) => s.id)).toEqual(['m2']))
    expect(calls).toContain('GET /api/v1/groups/g1/mount-points')
  })

  it('resolves false on a refused link', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useOwnerStoreLinks('project', 'p1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    let ok = true
    await act(async () => { ok = await result.current.linkStore('missing') })
    expect(ok).toBe(false)
  })
})
