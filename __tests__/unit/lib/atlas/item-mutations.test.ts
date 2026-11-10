/**
 * @jest-environment node
 *
 * Atlas mutations (atlas spec §5.2): the per-tier name rule, alias
 * normalisation, archive/restore, duplicate, folder filing and copies.
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
jest.mock('@/lib/atlas/item-images', () => ({ cleanupAtlasEntryImages: jest.fn(async () => undefined) }))

import { GENERAL_MP, getFakeRepos, pathsIn, resetStore } from '@/__tests__/helpers/inventory-fake-store'
import { publishRealtime } from '@/lib/realtime/bus'
import { cleanupAtlasEntryImages } from '@/lib/atlas/item-images'
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location'
import {
  copyAtlasEntriesToFolder,
  createAtlasEntry,
  deleteAtlasEntry,
  duplicateAtlasEntry,
  moveAtlasEntriesToFolder,
  setAtlasEntryArchived,
  updateAtlasEntry,
} from '@/lib/atlas/item-mutations'
import { AtlasNameTakenError } from '@/lib/atlas/errors'

let general: AtlasLocation

beforeEach(async () => {
  resetStore()
  jest.clearAllMocks()
  general = (await resolveAtlasLocation('general', null, getFakeRepos() as never, 'user-1')) as AtlasLocation
})

it('creates an entry with normalised aliases and publishes the atlas topic', async () => {
  const entry = await createAtlasEntry(general, { name: ' Convertible ', aliases: ['car', 'Car', ' lander ', 'CONVERTIBLE'], metadata: {} } as never)
  expect(entry.name).toBe('Convertible')
  expect(entry.aliases).toEqual(['car', 'lander'])
  expect(entry.knowledge).toBeNull()
  expect(publishRealtime).toHaveBeenCalledWith('atlas')
  expect(pathsIn(GENERAL_MP)).toEqual(['Atlas/Convertible.md'])
})

it('refuses a second live entry of the same name in a tier, case-insensitively (NAME_TAKEN)', async () => {
  await createAtlasEntry(general, { name: 'Convertible', aliases: [], metadata: {} } as never)
  await expect(createAtlasEntry(general, { name: 'convertible', aliases: [], metadata: {} } as never)).rejects.toBeInstanceOf(AtlasNameTakenError)
})

it('refuses a rename into a taken name, and a restore into one; an alias overlap is fine', async () => {
  const a = await createAtlasEntry(general, { name: 'Convertible', aliases: ['car'], metadata: {} } as never)
  const b = await createAtlasEntry(general, { name: 'Lighthouse', aliases: ['car'], metadata: {} } as never)
  await expect(updateAtlasEntry(general, b, { name: 'CONVERTIBLE' })).rejects.toBeInstanceOf(AtlasNameTakenError)

  await setAtlasEntryArchived(general, a, true)
  const renamed = await updateAtlasEntry(general, b, { name: 'Convertible' })
  expect(renamed?.name).toBe('Convertible')
  const archivedA = (await general.findEntry(a.id))!
  await expect(setAtlasEntryArchived(general, archivedA, false)).rejects.toBeInstanceOf(AtlasNameTakenError)
})

it('archives idempotently and restores', async () => {
  const a = await createAtlasEntry(general, { name: 'Lighthouse', aliases: [], metadata: {} } as never)
  const first = await setAtlasEntryArchived(general, a, true)
  expect(first.changed).toBe(true)
  const again = await setAtlasEntryArchived(general, first.entry!, true)
  expect(again.changed).toBe(false)
  expect((await general.readEntries(false)).map((e) => e.id)).toEqual([])
  const back = await setAtlasEntryArchived(general, first.entry!, false)
  expect(back.entry?.archivedAt).toBeNull()
})

it('duplicates beside the original as "(copy)" with no picture', async () => {
  const a = await createAtlasEntry(general, { name: 'Convertible', aliases: ['car'], metadata: {} } as never)
  await updateAtlasEntry(general, a, {})
  const copy = await duplicateAtlasEntry(general, (await general.findEntry(a.id))!)
  expect(copy.id).not.toBe(a.id)
  expect(copy.name).toBe('Convertible (copy)')
  expect(copy.imageFileId).toBeNull()
})

it('files, copies into a folder, and deletes with the pictures', async () => {
  const a = await createAtlasEntry(general, { name: 'Convertible', aliases: [], metadata: {} } as never)
  const moved = await moveAtlasEntriesToFolder(general, [a.id], 'Vehicles')
  expect(moved[0].folder).toBe('Vehicles')
  const copies = await copyAtlasEntriesToFolder(general, [a.id], 'Spares')
  expect(copies[0].name).toBe('Convertible (copy)')
  expect(pathsIn(GENERAL_MP)).toEqual(['Atlas/Spares/Convertible (copy).md', 'Atlas/Vehicles/Convertible.md'])

  const result = await deleteAtlasEntry(getFakeRepos() as never, general, (await general.findEntry(a.id))!)
  expect(result.deleted).toBe(true)
  expect(cleanupAtlasEntryImages).toHaveBeenCalledWith(expect.anything(), a.id, '[AtlasMutations]', expect.any(Object))
})
