/**
 * Regression tests for FoldersRepository path-rename operations.
 *
 * Previously, `updatePathPrefix` and `findDescendants` used an anchored
 * `$regex` pattern against SQLite. The query translator wraps all patterns in
 * %…% and cannot express anchors, so those queries always matched zero rows —
 * descendant folders kept their old paths after a parent rename. Both methods
 * were rewritten to fetch the full project slice with `findAllInProject` and
 * filter in JS with `startsWith`.
 *
 * These tests verify the corrected behaviour without a real database by
 * spying on `findAllInProject` and `update` on a real repository instance
 * (DB access is intercepted before it is reached).
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock the logger to suppress output in tests
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the database manager — prevents any real DB access
jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn().mockResolvedValue({
    getCollection: jest.fn().mockReturnValue({
      findMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue(null),
      deleteOne: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(0),
    }),
  }),
  ensureCollection: jest.fn().mockResolvedValue(undefined),
}));

import { FoldersRepository } from '@/lib/database/repositories/folders.repository';
import { FilesRepository } from '@/lib/database/repositories/files.repository';
import type { Folder, FileEntry } from '@/lib/schemas/types';

// ============================================================================
// Helpers
// ============================================================================

function makeFolder(overrides: Partial<Folder> & Pick<Folder, 'id' | 'path'>): Folder {
  return {
    userId: 'user-1',
    projectId: 'proj-1',
    name: overrides.path.split('/').filter(Boolean).pop() ?? 'folder',
    parentFolderId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Folder;
}

// ============================================================================
// updatePathPrefix — regression for descendant folder rename
// ============================================================================

describe('FoldersRepository.updatePathPrefix', () => {
  let repo: FoldersRepository;
  let findAllInProjectSpy: jest.SpiedFunction<FoldersRepository['findAllInProject']>;
  let updateSpy: jest.SpiedFunction<FoldersRepository['update']>;

  beforeEach(() => {
    repo = new FoldersRepository();

    // Stub `update` to simulate success without touching the DB
    updateSpy = jest.spyOn(repo, 'update').mockImplementation(async (id, data) => {
      return makeFolder({ id, path: (data as { path: string }).path });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renames the renamed folder itself', async () => {
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-1', path: 'Documents/' }),
    ]);

    const count = await repo.updatePathPrefix('user-1', 'Documents/', 'Archive/', 'proj-1');

    expect(count).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith('f-1', { path: 'Archive/' });
  });

  it('renames all descendant folder rows — regression for anchored-$regex bug', async () => {
    // Before the fix, an anchored $regex matched zero rows, so only the
    // root folder was renamed but descendants were not.
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-root', path: 'Projects/' }),
      makeFolder({ id: 'f-sub1', path: 'Projects/Alpha/' }),
      makeFolder({ id: 'f-sub2', path: 'Projects/Beta/' }),
      makeFolder({ id: 'f-sub3', path: 'Projects/Alpha/Assets/' }),
      makeFolder({ id: 'f-unrelated', path: 'Documents/' }),
    ]);

    const count = await repo.updatePathPrefix('user-1', 'Projects/', 'Work/', 'proj-1');

    expect(count).toBe(4); // root + 3 descendants, not the unrelated folder

    // Root renamed
    expect(updateSpy).toHaveBeenCalledWith('f-root', { path: 'Work/' });
    // Direct children renamed
    expect(updateSpy).toHaveBeenCalledWith('f-sub1', { path: 'Work/Alpha/' });
    expect(updateSpy).toHaveBeenCalledWith('f-sub2', { path: 'Work/Beta/' });
    // Deeper descendant renamed
    expect(updateSpy).toHaveBeenCalledWith('f-sub3', { path: 'Work/Alpha/Assets/' });
    // Unrelated folder NOT renamed
    expect(updateSpy).not.toHaveBeenCalledWith('f-unrelated', expect.anything());
  });

  it('returns 0 and calls no updates when no folders match the prefix', async () => {
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-1', path: 'Other/' }),
      makeFolder({ id: 'f-2', path: 'Different/' }),
    ]);

    const count = await repo.updatePathPrefix('user-1', 'NonExistent/', 'NewName/', 'proj-1');

    expect(count).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not accidentally match a folder whose path begins with the same letters but is a different folder', async () => {
    // e.g. renaming "Doc/" should not match "Documents/"
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-doc', path: 'Doc/' }),
      makeFolder({ id: 'f-docs', path: 'Documents/' }),
      makeFolder({ id: 'f-docs-sub', path: 'Documents/Sub/' }),
    ]);

    const count = await repo.updatePathPrefix('user-1', 'Doc/', 'D/', 'proj-1');

    expect(count).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith('f-doc', { path: 'D/' });
    expect(updateSpy).not.toHaveBeenCalledWith('f-docs', expect.anything());
    expect(updateSpy).not.toHaveBeenCalledWith('f-docs-sub', expect.anything());
  });

  it('handles null projectId (general files)', async () => {
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-1', path: 'Shared/', projectId: undefined as unknown as string }),
    ]);

    const count = await repo.updatePathPrefix('user-1', 'Shared/', 'Common/', null);

    expect(count).toBe(1);
    expect(findAllInProjectSpy).toHaveBeenCalledWith('user-1', null);
  });
});

// ============================================================================
// findDescendants — regression for same anchored-$regex bug
// ============================================================================

describe('FoldersRepository.findDescendants', () => {
  let repo: FoldersRepository;
  let findAllInProjectSpy: jest.SpiedFunction<FoldersRepository['findAllInProject']>;

  beforeEach(() => {
    repo = new FoldersRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns all folders whose path starts with the parent path, excluding the parent itself', async () => {
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-parent', path: 'Projects/' }),
      makeFolder({ id: 'f-child1', path: 'Projects/Alpha/' }),
      makeFolder({ id: 'f-child2', path: 'Projects/Beta/' }),
      makeFolder({ id: 'f-grandchild', path: 'Projects/Alpha/Assets/' }),
      makeFolder({ id: 'f-other', path: 'Documents/' }),
    ]);

    const descendants = await repo.findDescendants('user-1', 'Projects/', 'proj-1');

    const ids = descendants.map((f) => f.id);
    expect(ids).toContain('f-child1');
    expect(ids).toContain('f-child2');
    expect(ids).toContain('f-grandchild');
    // Parent itself is excluded
    expect(ids).not.toContain('f-parent');
    // Unrelated folders are excluded
    expect(ids).not.toContain('f-other');
  });

  it('returns an empty array when no descendants exist', async () => {
    findAllInProjectSpy = jest.spyOn(repo, 'findAllInProject').mockResolvedValue([
      makeFolder({ id: 'f-leaf', path: 'Leaf/' }),
    ]);

    const descendants = await repo.findDescendants('user-1', 'Leaf/', 'proj-1');
    expect(descendants).toEqual([]);
  });
});
// ============================================================================
// FilesRepository.findInFolderRecursive — same anchored-$regex regression
// ============================================================================

function makeFileEntry(overrides: Partial<FileEntry> & Pick<FileEntry, 'id' | 'folderPath'>): FileEntry {
  return {
    userId: 'user-1',
    projectId: 'proj-1',
    category: 'image' as const,
    source: 'upload' as const,
    originalFilename: 'test.png',
    mimeType: 'image/png',
    storageKey: `files/${overrides.id}.png`,
    size: 1024,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    ...overrides,
  } as FileEntry;
}

describe('FilesRepository.findInFolderRecursive', () => {
  let repo: FilesRepository;
  let findByFilterSpy: jest.SpiedFunction<FilesRepository['findByFilter']>;

  beforeEach(() => {
    repo = new FilesRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns all files under the given folder path — regression for anchored-$regex bug', async () => {
    // Before the fix, `findInFolderRecursive` used an anchored `$regex`
    // pattern which always matched nothing in the SQLite translator.
    const allFiles = [
      makeFileEntry({ id: 'f1', folderPath: 'Projects/' }),
      makeFileEntry({ id: 'f2', folderPath: 'Projects/Alpha/' }),
      makeFileEntry({ id: 'f3', folderPath: 'Projects/Alpha/Assets/' }),
      makeFileEntry({ id: 'f4', folderPath: 'Documents/' }),
      makeFileEntry({ id: 'f5', folderPath: null as unknown as string }),
    ];

    // `findInFolderRecursive` calls `findByFilter` once then filters in JS
    findByFilterSpy = jest.spyOn(repo as any, 'findByFilter').mockResolvedValue(allFiles);

    const result = await repo.findInFolderRecursive('user-1', 'proj-1', 'Projects/');

    const ids = result.map((f) => f.id);
    expect(ids).toContain('f1');
    expect(ids).toContain('f2');
    expect(ids).toContain('f3');
    expect(ids).not.toContain('f4');
    expect(ids).not.toContain('f5');
  });

  it('returns all files for the root path "/"', async () => {
    const allFiles = [
      makeFileEntry({ id: 'fa', folderPath: 'Projects/' }),
      makeFileEntry({ id: 'fb', folderPath: 'Documents/' }),
      makeFileEntry({ id: 'fc', folderPath: null as unknown as string }),
    ];

    findByFilterSpy = jest.spyOn(repo as any, 'findByFilter').mockResolvedValue(allFiles);

    const result = await repo.findInFolderRecursive('user-1', 'proj-1', '/');
    expect(result).toHaveLength(3);
  });

  it('returns empty array when no files match the given folder', async () => {
    findByFilterSpy = jest.spyOn(repo as any, 'findByFilter').mockResolvedValue([
      makeFileEntry({ id: 'f1', folderPath: 'Other/' }),
    ]);

    const result = await repo.findInFolderRecursive('user-1', 'proj-1', 'NonExistent/');
    expect(result).toEqual([]);
  });
});