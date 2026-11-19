/**
 * @jest-environment node
 *
 * GET /api/v1/system/navigation (navigation-menus §6): the registry as the
 * Electron shell reads it — ids, labels, kinds and hrefs, no icon or
 * activator detail.
 */

import { GET } from '@/app/api/v1/system/navigation/route'
import { NAV_GROUPS, NAV_PINNED, NAV_PROFILE, NAV_TOP } from '@/lib/navigation/registry'

describe('GET /api/v1/system/navigation', () => {
  it('lists the registry in order', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.top.map((i: { id: string }) => i.id)).toEqual(NAV_TOP.map((i) => i.id))
    expect(body.groups.map((g: { id: string; label: string }) => [g.id, g.label])).toEqual(NAV_GROUPS.map((g) => [g.id, g.label]))
    for (const [index, group] of NAV_GROUPS.entries()) {
      expect(body.groups[index].items.map((i: { id: string }) => i.id)).toEqual(group.items.map((i) => i.id))
    }
    expect(body.pinned.map((i: { id: string }) => i.id)).toEqual([...NAV_PINNED, ...NAV_PROFILE.items].map((i) => i.id))
  })

  it('carries an href for a destination and none for an action', async () => {
    const body = await (await GET()).json()
    const all = [...body.top, ...body.groups.flatMap((g: { items: unknown[] }) => g.items), ...body.pinned]
    const atlas = all.find((i: { id: string }) => i.id === 'atlas')
    expect(atlas).toEqual({ id: 'atlas', label: 'The Atlas', type: 'destination', href: '/workspace?open=atlas' })
    const help = all.find((i: { id: string }) => i.id === 'help')
    expect(help).toEqual({ id: 'help', label: 'Help', type: 'action' })
  })

  it('leaves out icons, tab kinds and anything else of the page’s', async () => {
    const text = JSON.stringify(await (await GET()).json())
    expect(text).not.toMatch(/"icon"|"tabKind"|"tabKinds"|"target"|"action":/)
  })
})
