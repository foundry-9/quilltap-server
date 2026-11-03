/**
 * The shared folder mutations (`lib/mount-index/item-folder-location`):
 *
 *  - create resolves the requested path first, and an empty one raises the
 *    kind's own path error;
 *  - rename trims the path and normalises the new name under the kind's
 *    rules (a slash is refused with the kind's error);
 *  - delete trims and answers only the counts;
 *  - moving items de-duplicates ids, resolves the folder once, and asks for
 *    every id (`requireAll`).
 */

import {
  createItemFolder,
  deleteItemFolder,
  locationKey,
  moveItemsToFolderIn,
  renameItemFolder,
  type ItemFilingLocation,
  type ItemFolderKind,
} from '@/lib/mount-index/item-folder-location'

jest.mock('@/lib/logger', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))

class KindPathError extends Error {}

const KIND: ItemFolderKind = {
  rules: { root: 'Shelf', reserved: ['images'], maxDepth: 8, noun: 'shelf' },
  pathError: (message) => new KindPathError(message),
}

function fakeLocation(): ItemFilingLocation<{ id: string; folder: string }> & Record<string, jest.Mock> {
  return {
    scope: 'project',
    id: 'p1',
    mountPointId: 'mp-1',
    characterId: null,
    listFolders: jest.fn(),
    resolveFolder: jest.fn(async (requested: string) => requested.trim()),
    createFolder: jest.fn(async (path: string) => ({ path, name: path, itemCount: 0 })),
    renameFolder: jest.fn(async (_path: string, name: string) => ({ path: name, name, itemCount: 2 })),
    deleteFolder: jest.fn(async () => ({ movedItems: 3, movedFolders: 1, parent: '' })),
    writableMountPointId: jest.fn(async () => 'mp-1'),
    updateMany: jest.fn(async (patches: Array<{ id: string; patch: { folder: string } }>) =>
      patches.map((p) => ({ id: p.id, folder: p.patch.folder })),
    ),
  } as never
}

describe('item folder mutations', () => {
  it('creates the resolved folder, and refuses an empty one with the kind\'s error', async () => {
    const loc = fakeLocation()
    await expect(createItemFolder(KIND, loc, ' Tools ')).resolves.toMatchObject({ path: 'Tools' })
    expect(loc.createFolder).toHaveBeenCalledWith('Tools')
    await expect(createItemFolder(KIND, loc, '   ')).rejects.toBeInstanceOf(KindPathError)
  })

  it('renames with a trimmed path and a normalised name', async () => {
    const loc = fakeLocation()
    await renameItemFolder(KIND, loc, '/Old/', '  New  ')
    expect(loc.renameFolder).toHaveBeenCalledWith('Old', 'New')
    await expect(renameItemFolder(KIND, loc, 'Old', 'a/b')).rejects.toBeInstanceOf(KindPathError)
  })

  it('deletes with a trimmed path and answers the counts', async () => {
    const loc = fakeLocation()
    await expect(deleteItemFolder(KIND, loc, '/Old/')).resolves.toEqual({ movedItems: 3, movedFolders: 1 })
    expect(loc.deleteFolder).toHaveBeenCalledWith('Old')
  })

  it('files a de-duplicated batch into one resolved folder, requiring every id', async () => {
    const loc = fakeLocation()
    const moved = await moveItemsToFolderIn(KIND, loc, ['a', 'b', 'a'], ' Tools ')
    expect(moved).toEqual([{ id: 'a', folder: 'Tools' }, { id: 'b', folder: 'Tools' }])
    expect(loc.resolveFolder).toHaveBeenCalledTimes(1)
    expect(loc.updateMany).toHaveBeenCalledWith(expect.any(Array), { requireAll: true })
  })

  it('keys a location by scope and mount', () => {
    expect(locationKey({ scope: 'general', mountPointId: 'mp-9' })).toBe('general:mp-9')
  })
})
