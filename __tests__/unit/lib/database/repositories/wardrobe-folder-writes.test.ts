/**
 * Folder writes in `wardrobe-writes.ts`, over an in-memory store:
 *
 *   - `updateManyInMount` reads once and projects once for a whole batch;
 *   - `listFoldersInMount` unions folder rows and item paths, minus `images/`;
 *   - `createFolderInMount` answers an existing folder in any casing;
 *   - `renameFolderInMount` moves the folder (items follow) and maps a
 *     sibling collision to `WardrobeFolderConflictError`;
 *   - `deleteFolderInMount` sends items and subfolders up a level and removes
 *     only folder rows, refusing a folder that holds non-item files.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

interface FolderRow { id: string; path: string }
interface Link { relativePath: string; content?: string }
const store: { items: WardrobeItem[]; folders: FolderRow[]; strays: Link[]; unstamped: Set<string> } = {
  items: [],
  folders: [],
  strays: [],
  unstamped: new Set(),
};
const itemPath = (i: WardrobeItem) => `Wardrobe/${i.folder ? `${i.folder}/` : ''}${i.title}.md`;
const itemContent = (i: WardrobeItem) =>
  // Fixture ids are short; a stamped file carries a UUID-shaped id line.
  `---\n${store.unstamped.has(i.id) ? '' : 'id: 00000000-0000-4000-8000-000000000000\n'}title: ${i.title}\ntypes:\n  - top\n---\n`;
const lower = (s: string) => s.toLowerCase();

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: { findByIdRaw: jest.fn() },
    docMountFolders: {
      findByMountPointId: jest.fn(async () => store.folders.slice()),
      findByMountPointAndPath: jest.fn(
        async (_mp: string, path: string) => store.folders.find((f) => lower(f.path) === lower(path)) ?? null,
      ),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn(async () => [
        ...store.items.map((i) => ({ relativePath: itemPath(i) })),
        ...store.strays,
      ]),
    },
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async (_mps: string[], folder: string) =>
        [
          ...store.items.map((i) => ({ relativePath: itemPath(i), content: itemContent(i) })),
          ...store.strays.filter((l) => l.content !== undefined),
        ].filter((d) => lower(d.relativePath).startsWith(`${lower(folder)}/`)),
      ),
    },
  }),
}));

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }));
jest.mock('@/lib/wardrobe/expand-composites', () => ({ detectComponentCycles: jest.fn(() => []) }));

const readMock = jest.fn(async () => ({ items: store.items.map((i) => ({ ...i })) }));
jest.mock('@/lib/database/repositories/vault-overlay/vault-readers', () => ({
  readCharacterVaultWardrobe: () => readMock(),
}));

const projectMock = jest.fn(async (_mp: string, _owner: string, items: WardrobeItem[]) => {
  for (const item of items) if (item.folder) ensureRows(item.folder);
  store.items = items.map((i) => ({ ...i, folder: canonical(i.folder) }));
  // A projection writes every item's id into its file.
  store.unstamped.clear();
});
jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-sync', () => ({
  projectVaultWardrobe: (...a: [string, string, WardrobeItem[]]) => projectMock(...a),
}));

function ensureRows(folder: string) {
  const segments = folder.split('/');
  let prefix = 'Wardrobe';
  for (const segment of segments) {
    const wanted = `${prefix}/${segment}`;
    const row = store.folders.find((f) => lower(f.path) === lower(wanted));
    if (row) prefix = row.path;
    else {
      store.folders.push({ id: `f-${store.folders.length}`, path: wanted });
      prefix = wanted;
    }
  }
}
function canonical(folder: string | undefined): string {
  if (!folder) return '';
  const row = store.folders.find((f) => lower(f.path) === lower(`Wardrobe/${folder}`));
  return row ? row.path.slice('Wardrobe/'.length) : folder;
}

class FakeDatabaseStoreError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}
const moveFolderMock = jest.fn(async (_mp: string, from: string, to: string) => {
  if (store.folders.some((f) => lower(f.path) === lower(to) && lower(f.path) !== lower(from))) {
    throw new FakeDatabaseStoreError('exists', 'CONFLICT');
  }
  const fromRel = from.slice('Wardrobe/'.length);
  const toRel = to.slice('Wardrobe/'.length);
  for (const row of store.folders) {
    if (lower(row.path) === lower(from)) row.path = to;
    else if (lower(row.path).startsWith(`${lower(from)}/`)) row.path = to + row.path.slice(from.length);
  }
  for (const item of store.items) {
    if (lower(item.folder) === lower(fromRel)) item.folder = toRel;
    else if (lower(item.folder).startsWith(`${lower(fromRel)}/`)) item.folder = toRel + item.folder.slice(fromRel.length);
  }
});
const deleteFolderMock = jest.fn(async (_mp: string, path: string) => {
  store.folders = store.folders.filter((f) => lower(f.path) !== lower(path));
  return { deleted: true };
});
jest.mock('@/lib/mount-index/database-store', () => ({
  get DatabaseStoreError() {
    return FakeDatabaseStoreError;
  },
  moveDatabaseFolder: (...a: [string, string, string]) => moveFolderMock(...a),
  deleteDatabaseFolder: (...a: [string, string]) => deleteFolderMock(...a),
}));
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async (_mp: string, path: string) => {
    ensureRows(path.slice('Wardrobe/'.length));
    return 'folder-id';
  }),
}));

import {
  createFolderInMount,
  deleteFolderInMount,
  listFoldersInMount,
  renameFolderInMount,
  updateManyInMount,
  type WardrobeMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import {
  WardrobeFolderConflictError,
  WardrobeFolderNotFoundError,
  WardrobeItemNotInLocationError,
} from '@/lib/wardrobe/folders';

const MOUNT: WardrobeMount = { mountPointId: 'm-1', scope: 'project', characterId: null };

function item(id: string, title: string, folder = '', extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: null,
    title,
    description: null,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    folder,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(() => {
  store.items = [];
  store.folders = [];
  store.strays = [];
  store.unstamped = new Set();
  readMock.mockClear();
  projectMock.mockClear();
  moveFolderMock.mockClear();
  deleteFolderMock.mockClear();
});

describe('updateManyInMount', () => {
  it('moves a batch with one read and one projection, and no read-back', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }];
    store.items = [item('a', 'Coat'), item('b', 'Hat'), item('c', 'Scarf')];

    const moved = await updateManyInMount(MOUNT, [
      { id: 'a', patch: { folder: 'Formal' } },
      { id: 'b', patch: { folder: 'Formal' } },
      { id: 'missing', patch: { folder: 'Formal' } },
    ]);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(projectMock).toHaveBeenCalledTimes(1);
    expect(moved.map((i) => [i.id, i.folder])).toEqual([
      ['a', 'Formal'],
      ['b', 'Formal'],
    ]);
    expect(store.items.find((i) => i.id === 'c')!.folder).toBe('');
  });

  it('with requireAll, refuses the whole batch over a missing id before writing', async () => {
    store.items = [item('a', 'Coat')];
    await expect(
      updateManyInMount(MOUNT, [{ id: 'a', patch: { folder: 'Formal' } }, { id: 'borrowed', patch: { folder: 'Formal' } }], {
        requireAll: true,
      }),
    ).rejects.toBeInstanceOf(WardrobeItemNotInLocationError);
    expect(projectMock).not.toHaveBeenCalled();
  });

  it('keeps a hand-made folder an item brings, and refuses a path that climbs out', async () => {
    store.items = [item('a', 'Coat'), item('b', 'Hat')];
    await updateManyInMount(MOUNT, [
      { id: 'a', patch: { folder: 'Hats: Summer' } },
      { id: 'b', patch: { folder: '../escape' } },
    ]);
    expect(store.items.map((i) => i.folder)).toEqual(['Hats: Summer', '']);
  });
});

describe('listFoldersInMount', () => {
  it('unions folder rows and item paths, adds ancestors, skips images/, counts live items directly inside', async () => {
    store.folders = [
      { id: 'f-0', path: 'Wardrobe/Empty' },
      { id: 'f-1', path: 'Wardrobe/images' },
      { id: 'f-2', path: 'Wardrobe/images/abc' },
      { id: 'f-3', path: 'Notes' },
    ];
    store.items = [
      item('a', 'Coat', 'Formal/Evening'),
      item('b', 'Gown', 'Formal/Evening'),
      item('c', 'Old', 'Formal/Evening', { archivedAt: '2026-02-01T00:00:00.000Z' }),
      item('d', 'Hat', 'formal'),
    ];

    const folders = await listFoldersInMount(MOUNT);

    expect(folders).toEqual([
      { path: 'Empty', name: 'Empty', itemCount: 0 },
      { path: 'Formal', name: 'Formal', itemCount: 1 },
      { path: 'Formal/Evening', name: 'Evening', itemCount: 2 },
    ]);
  });
});

describe('createFolderInMount', () => {
  it('answers the existing folder when the name differs only in casing', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }];
    const folder = await createFolderInMount(MOUNT, 'formal');
    expect(folder.path).toBe('Formal');
    expect(store.folders).toHaveLength(1);
  });

  it('creates a nested folder and its ancestors', async () => {
    const folder = await createFolderInMount(MOUNT, 'Formal/Evening');
    expect(folder).toEqual({ path: 'Formal/Evening', name: 'Evening', itemCount: 0 });
    expect(store.folders.map((f) => f.path)).toEqual(['Wardrobe/Formal', 'Wardrobe/Formal/Evening']);
  });
});

describe('renameFolderInMount', () => {
  it('moves the folder in the store; items follow because the path is the truth', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }, { id: 'f-1', path: 'Wardrobe/Formal/Evening' }];
    store.items = [item('a', 'Coat', 'Formal'), item('b', 'Gown', 'Formal/Evening')];

    const folder = await renameFolderInMount(MOUNT, 'Formal', 'Dress');

    expect(moveFolderMock).toHaveBeenCalledWith('m-1', 'Wardrobe/Formal', 'Wardrobe/Dress');
    expect(folder).toEqual({ path: 'Dress', name: 'Dress', itemCount: 1 });
    expect(store.items.map((i) => i.folder)).toEqual(['Dress', 'Dress/Evening']);
    expect(projectMock).not.toHaveBeenCalled();
  });

  it('stamps ids into files that lack one before moving them, so no item changes identity', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }];
    store.items = [item('a', 'Gown', 'Formal')];
    store.unstamped.add('a');

    await renameFolderInMount(MOUNT, 'Formal', 'Evening');

    expect(projectMock).toHaveBeenCalledTimes(1);
    expect(projectMock.mock.invocationCallOrder[0]).toBeLessThan(moveFolderMock.mock.invocationCallOrder[0]);
    expect(store.items[0]).toMatchObject({ id: 'a', folder: 'Evening' });
  });

  it('refuses a name a sibling already holds, in any casing', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }, { id: 'f-1', path: 'Wardrobe/Dress' }];
    await expect(renameFolderInMount(MOUNT, 'Formal', 'dress')).rejects.toBeInstanceOf(
      WardrobeFolderConflictError,
    );
  });

  it('404s a folder that does not exist', async () => {
    await expect(renameFolderInMount(MOUNT, 'Nope', 'Dress')).rejects.toBeInstanceOf(
      WardrobeFolderNotFoundError,
    );
  });
});

describe('deleteFolderInMount', () => {
  it('sends items and subfolders up to the parent, merging, and removes only folder rows', async () => {
    store.folders = [
      { id: 'f-0', path: 'Wardrobe/Dress' },
      { id: 'f-1', path: 'Wardrobe/Dress/Evening' },
      { id: 'f-2', path: 'Wardrobe/Dress/Evening/Gala' },
      { id: 'f-3', path: 'Wardrobe/Dress/Evening/Empty' },
      { id: 'f-4', path: 'Wardrobe/Dress/Gala' },
    ];
    store.items = [
      item('a', 'Coat', 'Dress'),
      item('b', 'Gown', 'Dress/Evening'),
      item('c', 'Tiara', 'Dress/Evening/Gala', { archivedAt: '2026-02-01T00:00:00.000Z' }),
    ];

    const result = await deleteFolderInMount(MOUNT, 'dress/evening');

    expect(result).toEqual({ movedItems: 2, movedFolders: 2, parent: 'Dress' });
    expect(projectMock).toHaveBeenCalledTimes(1);
    expect(store.items.map((i) => [i.id, i.folder])).toEqual([
      ['a', 'Dress'],
      ['b', 'Dress'],
      ['c', 'Dress/Gala'],
    ]);
    expect(store.folders.map((f) => f.path).sort()).toEqual([
      'Wardrobe/Dress',
      'Wardrobe/Dress/Empty',
      'Wardrobe/Dress/Gala',
    ]);
  });

  it.each([
    ['a .txt', { relativePath: 'Wardrobe/Formal/notes.txt' }],
    ['a note with no slots', { relativePath: 'Wardrobe/Formal/notes.md', content: '# Press the tails.' }],
    ['a nested instructions.md', { relativePath: 'Wardrobe/Formal/instructions.md', content: 'Tweeds.' }],
  ])('refuses, before moving anything, a folder holding %s', async (_label, stray) => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }];
    store.items = [item('a', 'Coat', 'Formal')];
    store.strays = [stray];

    await expect(deleteFolderInMount(MOUNT, 'Formal')).rejects.toBeInstanceOf(WardrobeFolderConflictError);
    expect(projectMock).not.toHaveBeenCalled();
    expect(deleteFolderMock).not.toHaveBeenCalled();
  });

  it('refuses, before moving anything, a folder whose subfolder shares its name', async () => {
    store.folders = [{ id: 'f-0', path: 'Wardrobe/Formal' }, { id: 'f-1', path: 'Wardrobe/Formal/Formal' }];
    store.items = [item('a', 'Coat', 'Formal'), item('b', 'Gown', 'Formal/Formal')];

    await expect(deleteFolderInMount(MOUNT, 'Formal')).rejects.toBeInstanceOf(WardrobeFolderConflictError);
    expect(projectMock).not.toHaveBeenCalled();
    expect(deleteFolderMock).not.toHaveBeenCalled();
  });
});
