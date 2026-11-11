/**
 * @jest-environment node
 *
 * The item-store kernel (Refactor 4.13, item-family kernel): tier reads that
 * remember what they could not read, one shadowing rule, one name fold.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))

import { publishRealtime } from '@/lib/realtime/bus'
import { pathsIn, putDoc, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { foldItemName } from '@/lib/mount-index/item-rules'
import { readTiers, shadowLayers } from '@/lib/mount-index/item-tiers'
import { defineItemFolderErrors, folderOfItemPath, isItemDocumentPath, type ItemFolderRules } from '@/lib/mount-index/item-folders'
import {
  archivedPatch,
  cleanPatch,
  createItemFolderStore,
  nextCopyTitle,
  locationWriter,
  type ItemFolderScan,
} from '@/lib/mount-index/item-store'
import type { VaultFolderMount } from '@/lib/mount-index/item-folder-ops'

type Rec = { id: string; from: string }
const mounts: Record<string, Rec[]> = {
  'g-1': [{ id: 'x', from: 'g-1' }],
  'g-2': [{ id: 'x', from: 'g-2' }, { id: 'y', from: 'g-2' }],
  'p-1': [{ id: 'y', from: 'p-1' }],
}
const read = async (mp: string): Promise<Rec[]> => {
  if (mp === 'broken') throw new Error('nope')
  return mounts[mp] ?? []
}

describe('readTiers', () => {
  it('returns one layer per tier, strongest mount first, and consulted in tier order', async () => {
    const result = await readTiers('inventory', [
      { mountPointIds: ['g-1', 'g-2'], read },
      { mountPointIds: ['p-1'], read },
    ])
    expect(result.layers.map((layer) => layer.map((r) => r.from))).toEqual([['g-1', 'g-2', 'g-2'], ['p-1']])
    expect(result.consulted).toEqual(['g-1', 'g-2', 'p-1'])
    expect(result.unread).toEqual([])
  })

  it('records a failed mount as unread and keeps the rest of its tier', async () => {
    const result = await readTiers('atlas', [{ mountPointIds: ['broken', 'g-1'], read }, { mountPointIds: [], read }])
    expect(result.layers).toEqual([[{ id: 'x', from: 'g-1' }], []])
    expect(result.unread).toEqual([{ mountPointId: 'broken', error: 'nope' }])
    expect(result.consulted).toEqual(['broken', 'g-1'])
  })

  it('joins bookkeeping in tier order whatever order the reads settle in (#155)', async () => {
    const slow = async (mp: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (mp === 'slow-broken') throw new Error('late')
      return []
    }
    const result = await readTiers('wardrobe', [
      { mountPointIds: ['slow-broken'], read: slow },
      { mountPointIds: ['broken'], read },
    ])
    expect(result.unread.map((u) => u.mountPointId)).toEqual(['slow-broken', 'broken'])
  })
})

describe('shadowLayers', () => {
  it('the first record to claim a key keeps it, within a layer and across layers', () => {
    const { byKey, shadowedCount } = shadowLayers(
      [[{ id: 'x', from: 'own' }], [{ id: 'x', from: 'g-1' }, { id: 'y', from: 'g-1' }, { id: 'y', from: 'g-2' }]],
      (r) => r.id,
    )
    expect(Array.from(byKey.values())).toEqual([{ id: 'x', from: 'own' }, { id: 'y', from: 'g-1' }])
    expect(shadowedCount).toBe(2)
  })
})

describe('foldItemName', () => {
  it('trims, lower-cases without a locale, and normalises to NFC', () => {
    expect(foldItemName('  Convertible ')).toBe('convertible')
    expect(foldItemName('CAFÉ')).toBe(foldItemName('café'))
    expect(foldItemName('ISTANBUL')).toBe('istanbul')
  })
})

// ============================================================================
// The folder store, bound with a toy serialiser
// ============================================================================

interface Toy { id: string; name: string; folder: string; colour?: string; archivedAt?: string | null; createdAt: string; updatedAt: string }

const TOY_RULES: ItemFolderRules = { root: 'Toys', reserved: ['images'], maxDepth: 8, noun: 'toy box' }
const ToyErrors = defineItemFolderErrors('Toy', 'toy box')
const MP = 'mp-toys'
const mount: VaultFolderMount = { mountPointId: MP, scope: 'project', characterId: null }

/** Toy files are `<name>.toy.json`, one JSON object each; the first file to claim an id wins it. */
async function scanToys(mountPointId: string): Promise<ItemFolderScan<Toy>> {
  const records: Toy[] = []
  const duplicatePaths = new Set<string>()
  const ownedPaths = new Set<string>()
  const seen = new Set<string>()
  for (const path of pathsIn(mountPointId)) {
    if (!isItemDocumentPath(TOY_RULES, path, '.json')) continue
    const raw = JSON.parse(state.docs.get(`${mountPointId}::${path}`) as string)
    if (seen.has(raw.id)) {
      duplicatePaths.add(path)
      continue
    }
    seen.add(raw.id)
    ownedPaths.add(path)
    records.push({ ...raw, folder: folderOfItemPath(TOY_RULES, path) })
  }
  return { records, duplicatePaths, ownedPaths }
}

const guarded: string[] = []
const store = createItemFolderStore<Toy>({
  kind: 'inventory',
  rules: TOY_RULES,
  ext: '.json',
  noun: { one: 'Toy', many: 'Toys', idKey: 'toyId' },
  fileNameFor: (toy) => `${toy.folder ? `${toy.folder}/` : ''}${toy.name}.json`,
  serialize: ({ folder: _folder, ...toy }) => `${JSON.stringify(toy)}\n`,
  scan: scanToys,
  isItemDocument: (doc) => isItemDocumentPath(TOY_RULES, doc.relativePath, '.json'),
  hasStableId: (content) => !!content && /"id"/.test(content),
  errors: {
    path: (message) => new ToyErrors.FolderPathError(message),
    notFound: (folder) => new ToyErrors.FolderNotFoundError(folder),
    conflict: (folder, message) => new ToyErrors.FolderConflictError(folder, message),
    notInLocation: (ids) => new ToyErrors.NotInLocationError(ids),
  },
  wrapWrite: async (fn) => {
    guarded.push('in')
    return fn()
  },
})

const toy = (id: string, name: string, extra: Partial<Toy> = {}): Toy =>
  ({ id, name, folder: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra })

describe('createItemFolderStore', () => {
  beforeEach(() => {
    resetStore()
    guarded.length = 0
    jest.clearAllMocks()
  })

  it('creates, files and reads back through the serialiser, inside the family wrapper', async () => {
    await store.create(mount, toy('t1', 'top', { folder: 'Spinning' }))
    await store.create(mount, toy('t2', 'kite'))
    expect(pathsIn(MP)).toEqual(['Toys/Spinning/top.json', 'Toys/kite.json'])
    expect((await store.read(mount)).map((t) => [t.id, t.folder])).toEqual([['t1', 'Spinning'], ['t2', '']])
    expect(guarded).toHaveLength(2)
  })

  it('normalises an unsafe folder on the way in', async () => {
    await store.create(mount, toy('t1', 'top', { folder: ' /Spinning// ' }))
    expect((await store.read(mount))[0].folder).toBe('Spinning')
  })

  it('patches a batch with one projection, keeps identity, stamps updatedAt and removes keys', async () => {
    await store.create(mount, toy('t1', 'top', { colour: 'red' }))
    await store.create(mount, toy('t2', 'kite'))
    const updated = await store.updateMany(mount, [
      { id: 't1', patch: { id: 'hijack', createdAt: 'x' } as Partial<Toy>, remove: ['colour'] },
      { id: 'missing', patch: { name: 'ghost' } },
      { id: 't2', patch: { folder: 'Sky' } },
    ])
    expect(updated.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(updated[0]).toMatchObject({ id: 't1', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(updated[0].colour).toBeUndefined()
    expect(updated[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(pathsIn(MP)).toEqual(['Toys/Sky/kite.json', 'Toys/top.json'])
  })

  it('refuses a requireAll batch naming a record elsewhere, writing nothing', async () => {
    await store.create(mount, toy('t1', 'top'))
    await expect(store.updateMany(mount, [{ id: 't1', patch: { name: 'spinner' } }, { id: 'nope', patch: {} }], { requireAll: true }))
      .rejects.toBeInstanceOf(ToyErrors.NotInLocationError)
    expect((await store.read(mount))[0].name).toBe('top')
  })

  it('runs a guard inside the write chain: two concurrent creates, one refused', async () => {
    const guard = (name: string) => (records: readonly Toy[]) => {
      if (records.some((t) => foldItemName(t.name) === foldItemName(name))) throw new Error('taken')
    }
    const results = await Promise.allSettled([
      store.create(mount, toy('t1', 'Top'), { guard: guard('Top') }),
      store.create(mount, toy('t2', 'top'), { guard: guard('top') }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(pathsIn(MP)).toHaveLength(1)
  })

  it('deletes, applying follow-on patches to the survivors in the same projection', async () => {
    await store.create(mount, toy('t1', 'top', { colour: 'red' }))
    await store.create(mount, toy('t2', 'kite'))
    const deleted = await store.delete(mount, ['t1', 'missing'], (remaining) =>
      remaining.map((t) => ({ id: t.id, patch: { colour: 'orphaned' } })),
    )
    expect(deleted).toEqual(['t1'])
    expect((await store.read(mount)).map((t) => [t.id, t.colour])).toEqual([['t2', 'orphaned']])
    expect(await store.delete(mount, ['missing'])).toEqual([])
  })

  it('leaves a duplicate-id file where it is', async () => {
    await store.create(mount, toy('t1', 'top'))
    putDoc(MP, 'Toys/top copy.json', JSON.stringify({ id: 't1', name: 'top copy' }))
    await store.updateMany(mount, [{ id: 't1', patch: { colour: 'blue' } }])
    expect(pathsIn(MP)).toEqual(['Toys/top copy.json', 'Toys/top.json'])
  })

  it('creates, renames and deletes folders through the shared folder operations', async () => {
    await store.create(mount, toy('t1', 'top', { folder: 'Spinning' }))
    await store.createFolder(mount, 'Empty')
    expect((await store.listFolderPaths(mount)).sort()).toEqual(['Empty', 'Spinning'])
    await store.renameFolder(mount, 'Spinning', 'Whirling')
    expect((await store.read(mount))[0].folder).toBe('Whirling')
    const moved = await store.deleteFolder(mount, 'Whirling')
    expect(moved.movedItems).toBe(1)
    expect((await store.read(mount))[0].folder).toBe('')
    await expect(store.renameFolder(mount, 'Nowhere', 'X')).rejects.toBeInstanceOf(ToyErrors.FolderNotFoundError)
  })
})

describe('the location write wrapper', () => {
  it('publishes the family topic only when the write landed', async () => {
    const writer = locationWriter('atlas', mount, async () => mount)
    await writer.write(async () => [], writer.nonEmpty)
    expect(publishRealtime).not.toHaveBeenCalled()
    await writer.write(async () => ['x'], writer.nonEmpty)
    expect(publishRealtime).toHaveBeenCalledWith('atlas')
  })

  it("re-resolves a character's mount at write time, and refuses one with no vault", async () => {
    const character: VaultFolderMount = { mountPointId: 'mp-old', scope: 'character', characterId: 'c-1' }
    const resolve = jest.fn(async () => ({ ...character, mountPointId: 'mp-now' }))
    expect((await locationWriter('wardrobe', character, resolve).writableMount()).mountPointId).toBe('mp-now')
    await expect(locationWriter('wardrobe', character, async () => null).writableMount()).rejects.toThrow('no linked vault')
  })

  it('cleanPatch strips identity and timestamps', () => {
    expect(cleanPatch({ id: 'x', createdAt: 'a', updatedAt: 'b', name: 'kept' } as Partial<Toy>)).toEqual({ name: 'kept' })
  })
})

describe('shared helpers', () => {
  it('archivedPatch stamps, clears, or answers null for no change', () => {
    expect(archivedPatch(null, true, 'now')).toEqual({ archivedAt: 'now' })
    expect(archivedPatch('then', false, 'now')).toEqual({ archivedAt: null })
    expect(archivedPatch('then', true, 'now')).toBeNull()
  })

  it('nextCopyTitle escalates past taken copies, case-insensitively', () => {
    expect(nextCopyTitle('Shirt', ['Shirt'])).toBe('Shirt (copy)')
    expect(nextCopyTitle('Shirt (copy)', ['shirt (COPY)'])).toBe('Shirt (copy 2)')
  })
})
