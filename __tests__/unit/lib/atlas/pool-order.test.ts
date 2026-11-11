/**
 * @jest-environment node
 *
 * The Atlas pool and cast view (atlas spec §5.4): shadowing by canonical name
 * (character > group > project > general), archived entries dropped per tier
 * before shadowing, and the cast view's seat order.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
/** Mounts whose Atlas read fails. */
const unreadableMounts = new Set<string>()
jest.mock('@/lib/atlas/vault-readers', () => {
  const actual = jest.requireActual('@/lib/atlas/vault-readers')
  return {
    ...actual,
    readAtlasRecords: async (mountPointId: string) => {
      if (unreadableMounts.has(mountPointId)) throw new Error('disk on fire')
      return actual.readAtlasRecords(mountPointId)
    },
  }
})

import { addCharacter, getFakeRepos, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location'
import { createAtlasEntry, setAtlasEntryArchived } from '@/lib/atlas/item-mutations'
import { loadAtlasPool, loadCastAtlasView, shadowAtlasLayers } from '@/lib/atlas/pool'

const repos = () => getFakeRepos() as never
const at = async (scope: 'character' | 'group' | 'project' | 'general', id: string | null) =>
  (await resolveAtlasLocation(scope, id, repos(), 'user-1')) as AtlasLocation
const make = (loc: AtlasLocation, name: string, knowledge: string) =>
  createAtlasEntry(loc, { name, aliases: [], knowledge, metadata: {} } as never)

beforeEach(() => {
  unreadableMounts.clear()
  resetStore()
  addCharacter('c-a', 'Agatha')
  addCharacter('c-b', 'Bertie')
})

it('shadows by canonical name, case-insensitively: character > project > general', async () => {
  await make(await at('general', null), 'Convertible', 'general')
  await make(await at('project', 'project-1'), 'convertible', 'project')
  await make(await at('character', 'c-a'), 'CONVERTIBLE', 'agatha')

  const a = await loadAtlasPool(repos(), { characterId: 'c-a', projectId: 'project-1' })
  expect(a.entries.map((e) => e.knowledge)).toEqual(['agatha'])
  expect(a.shadowedCount).toBe(2)
  const b = await loadAtlasPool(repos(), { characterId: 'c-b', projectId: 'project-1' })
  expect(b.entries.map((e) => [e.knowledge, e.origin.scope])).toEqual([['project', 'project']])
})

it('drops archived entries per tier before shadowing', async () => {
  await make(await at('project', 'project-1'), 'Convertible', 'project')
  const mine = await make(await at('character', 'c-a'), 'Convertible', 'agatha')
  await setAtlasEntryArchived(await at('character', 'c-a'), mine, true)
  const pool = await loadAtlasPool(repos(), { characterId: 'c-a', projectId: 'project-1' })
  expect(pool.entries.map((e) => e.knowledge)).toEqual(['project'])
})

it('gives an archived character no character tier', async () => {
  await make(await at('character', 'c-a'), 'Convertible', 'agatha')
  state.characters.get('c-a')!.archivedAt = '2026-11-01T00:00:00.000Z'
  const pool = await loadAtlasPool(repos(), { characterId: 'c-a' })
  expect(pool.entries).toEqual([])
})

it('reads group entries for members only', async () => {
  state.groups = [{ id: 'g-1', name: 'Crew', officialMountPointId: 'mp-crew' }]
  state.groupMounts.set('c-a', [{ group: { id: 'g-1', name: 'Crew' }, mountPointIds: ['mp-crew'] }])
  await make(await at('group', 'g-1'), 'Lander', 'crew only')
  expect((await loadAtlasPool(repos(), { characterId: 'c-a' })).entries.map((e) => e.origin.scope)).toEqual(['group'])
  expect((await loadAtlasPool(repos(), { characterId: 'c-b' })).entries).toEqual([])
})

it('the cast view takes the earlier present seat\'s entry and skips absent seats', async () => {
  await make(await at('character', 'c-a'), 'Convertible', 'agatha')
  await make(await at('character', 'c-b'), 'Convertible', 'bertie')
  await make(await at('project', 'project-1'), 'Convertible', 'project')
  const chat = (participants: Array<[string, string]>) => ({
    id: 'chat-1',
    projectId: 'project-1',
    participants: participants.map(([characterId, status]) => ({ characterId, status: status as 'active' })),
  })
  expect((await loadCastAtlasView(repos(), { chat: chat([['c-b', 'active'], ['c-a', 'active']]) })).entries[0].knowledge).toBe('bertie')
  expect((await loadCastAtlasView(repos(), { chat: chat([['c-b', 'absent'], ['c-a', 'active']]) })).entries[0].knowledge).toBe('agatha')
  expect((await loadCastAtlasView(repos(), { chat: chat([]) })).entries[0].knowledge).toBe('project')
})

it('shadowAtlasLayers is pure: strongest layer first', () => {
  const e = (id: string, name: string, archivedAt: string | null = null) =>
    ({ id, name, aliases: [], archivedAt, origin: { scope: 'general', id: null, name: '' }, mountPointId: 'm' }) as never
  const view = shadowAtlasLayers([[e('1', 'A', 'x')], [e('2', 'a'), e('3', 'B')], [e('4', 'b')]])
  expect(view.entries.map((x: { id: string }) => x.id)).toEqual(['2', '3'])
})

it('remembers a tier it failed to read, and keeps the rest', async () => {
  await make(await at('project', 'project-1'), 'Lighthouse', 'project')
  await make(await at('general', null), 'Convertible', 'general')
  unreadableMounts.add('mp-project')
  const pool = await loadAtlasPool(repos(), { characterId: 'c-a', projectId: 'project-1' })
  expect(pool.entries.map((e) => e.knowledge)).toEqual(['general'])
  expect(pool.unread).toEqual([{ mountPointId: 'mp-project', error: 'disk on fire' }])
})
