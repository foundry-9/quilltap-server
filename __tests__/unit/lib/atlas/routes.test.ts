/**
 * @jest-environment node
 *
 * The Atlas routes (atlas spec §5.6) over the in-memory store: the factory's
 * action dispatch (an unknown action is a 400), NAME_TAKEN as a 409 with its
 * code, folders, overlaps, and transfers (a move keeps the id, a clash at the
 * destination refuses).
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: unknown) => handler,
  createContextHandler: (handler: unknown) => handler,
  withActionDispatch: jest.requireActual('@/lib/api/middleware/actions').withActionDispatch,
}))
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: jest.fn(async () => ({ mountPointId: 'mp-project' })),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/atlas/item-images', () => {
  class ForeignAtlasImageError extends Error {}
  return {
    ForeignAtlasImageError,
    assertAtlasImageChoice: jest.fn(async () => undefined),
    cleanupAtlasEntryImages: jest.fn(async () => undefined),
    carryAtlasEntryImages: jest.fn(async () => ({ fileIdMap: new Map(), pendingMove: { repoints: [] } })),
    commitMovedAtlasEntryImages: jest.fn(async () => undefined),
  }
})

import { NextRequest } from 'next/server'
import { addCharacter, getFakeRepos, pathsIn, resetStore, GENERAL_MP } from '@/__tests__/helpers/inventory-fake-store'
import { computeAtlasOverlaps, createAtlasCollectionHandlers, createAtlasItemHandlers } from '@/lib/atlas/routes/atlas-route-factory'
import { POST as transfer } from '@/app/api/v1/atlas/transfers/route'

type Handler = (req: NextRequest, ctx: unknown, params: unknown) => Promise<Response>
const project = createAtlasCollectionHandlers<{ id: string }>({ scope: 'project', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'projectId' }) as unknown as Record<'GET' | 'POST', Handler>
const projectItem = createAtlasItemHandlers<{ id: string; entryId: string }>({ scope: 'project', paramsToId: ({ id }) => id, logTag: '[t]', logIdKey: 'projectId' }) as unknown as Record<'GET' | 'PUT' | 'DELETE', Handler>
const general = createAtlasCollectionHandlers<Record<string, never>>({ scope: 'general', paramsToId: () => null, logTag: '[t]', logIdKey: 'generalId' }) as unknown as Record<'GET' | 'POST', Handler>

const people: Array<{ id: string; name: string; aliases: string[] }> = []
const ctx = () => {
  const repos = getFakeRepos() as unknown as Record<string, Record<string, unknown>>
  repos.characters.findByUserId = jest.fn(async () => people)
  return { user: { id: 'user-1', name: 'Op' }, repos }
}
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

beforeEach(() => {
  resetStore()
  people.length = 0
  addCharacter('c-a', 'Agatha')
})

it('answers an unknown action with 400 on every verb', async () => {
  expect((await project.GET(req('/x?action=nonsense'), ctx(), { id: 'project-1' })).status).toBe(400)
  expect((await project.POST(req('/x?action=nonsense', 'POST', {}), ctx(), { id: 'project-1' })).status).toBe(400)
  expect((await projectItem.DELETE(req('/x?action=nonsense', 'DELETE'), ctx(), { id: 'project-1', entryId: 'e' })).status).toBe(400)
})

it('creates, lists, edits, refuses a clash with NAME_TAKEN, and deletes', async () => {
  const created = await json(await project.POST(req('/x', 'POST', { name: 'Convertible', aliases: ['car'] }), ctx(), { id: 'project-1' }))
  expect(created.status).toBe(201)
  const id = created.body.entry.id
  expect(created.body.entry.origin).toMatchObject({ scope: 'project', id: 'project-1' })

  const clash = await json(await project.POST(req('/x', 'POST', { name: 'convertible' }), ctx(), { id: 'project-1' }))
  expect(clash.status).toBe(409)
  expect(clash.body.details?.code ?? clash.body.code).toBe('NAME_TAKEN')

  const edited = await json(await projectItem.PUT(req('/x', 'PUT', { knowledge: 'Fast.', archived: true }), ctx(), { id: 'project-1', entryId: id }))
  expect(edited.body.entry).toMatchObject({ knowledge: 'Fast.' })
  expect(edited.body.entry.archivedAt).toEqual(expect.any(String))

  const listed = await json(await project.GET(req('/x'), ctx(), { id: 'project-1' }))
  expect(listed.body.entries).toEqual([])
  const all = await json(await project.GET(req('/x?includeArchived=true'), ctx(), { id: 'project-1' }))
  expect(all.body.entries).toHaveLength(1)

  expect((await projectItem.DELETE(req('/x', 'DELETE'), ctx(), { id: 'project-1', entryId: id })).status).toBe(200)
  expect((await projectItem.GET(req('/x'), ctx(), { id: 'project-1', entryId: id })).status).toBe(404)
})

it('makes and lists folders, and files entries into them', async () => {
  const { body } = await json(await project.POST(req('/x', 'POST', { name: 'Lander' }), ctx(), { id: 'project-1' }))
  await project.POST(req('/x?action=create-folder', 'POST', { path: 'Vehicles' }), ctx(), { id: 'project-1' })
  const moved = await json(await project.POST(req('/x?action=move-items', 'POST', { entryIds: [body.entry.id], folder: 'Vehicles' }), ctx(), { id: 'project-1' }))
  expect(moved.body.entries[0].folder).toBe('Vehicles')
  const folders = await json(await project.GET(req('/x?action=folders'), ctx(), { id: 'project-1' }))
  expect(folders.body.folders.map((f: { path: string }) => f.path)).toContain('Vehicles')
})

it('reports overlaps with other reachable entries and with characters', async () => {
  people.push({ id: 'c-car', name: 'Car', aliases: [] })
  await general.POST(req('/x', 'POST', { name: 'Raft', aliases: ['dinghy'] }), ctx(), {})
  await project.POST(req('/x', 'POST', { name: 'Convertible', aliases: ['car', 'dinghy'] }), ctx(), { id: 'project-1' })
  const { body } = await json(await project.GET(req('/x?action=overlaps'), ctx(), { id: 'project-1' }))
  expect(body.overlaps).toEqual(expect.arrayContaining([
    expect.objectContaining({ term: 'car', kind: 'character', otherName: 'Car' }),
    expect.objectContaining({ term: 'dinghy', kind: 'entry', otherName: 'Raft' }),
  ]))
})

it('computeAtlasOverlaps ignores an entry overlapping itself and archived entries', () => {
  const e = (id: string, name: string, aliases: string[], archivedAt: string | null = null) =>
    ({ id, name, aliases, archivedAt }) as never
  expect(computeAtlasOverlaps([e('1', 'A', ['a'])], [e('1', 'A', ['a'])], [])).toEqual([])
  expect(computeAtlasOverlaps([e('1', 'A', [], 'x')], [e('2', 'A', [])], [])).toEqual([])
})

it('transfers: a move keeps the id; a clash at the destination is NAME_TAKEN', async () => {
  const { body } = await json(await project.POST(req('/x', 'POST', { name: 'Convertible' }), ctx(), { id: 'project-1' }))
  const moved = await json(await (transfer as unknown as Handler)(req('/x', 'POST', {
    action: 'move', entryId: body.entry.id, from: { scope: 'project', id: 'project-1' }, to: { scope: 'general', id: null },
  }), ctx(), {}))
  expect(moved.status).toBe(200)
  expect(moved.body.entry.id).toBe(body.entry.id)
  expect(pathsIn(GENERAL_MP)).toEqual(['Atlas/Convertible.md'])

  const again = await json(await project.POST(req('/x', 'POST', { name: 'Convertible' }), ctx(), { id: 'project-1' }))
  const clash = await json(await (transfer as unknown as Handler)(req('/x', 'POST', {
    action: 'copy', entryId: again.body.entry.id, from: { scope: 'project', id: 'project-1' }, to: { scope: 'general', id: null },
  }), ctx(), {}))
  expect(clash.status).toBe(409)
})
