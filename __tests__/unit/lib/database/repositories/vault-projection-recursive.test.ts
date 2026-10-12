/**
 * Recursive mode of `projectArrayIntoVaultFolder` — the wardrobe's folders.
 *
 * A mapper may return `Sub/Name.md`; the projection writes nested, sweeps
 * stale `.md` at any depth, never touches `images/`, suffixes collisions per
 * folder, and keeps preserved names alive at any depth. Flat callers (no
 * `recursive` option) keep their top-level behaviour.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

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

const findManyByMountPointsInFolderMock = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: (...args: unknown[]) =>
        findManyByMountPointsInFolderMock(...args),
    },
  }),
}));

const writeDatabaseDocumentMock = jest.fn();
const deleteDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => writeDatabaseDocumentMock(...args),
  deleteDatabaseDocument: (...args: unknown[]) => deleteDatabaseDocumentMock(...args),
}));

const ensureFolderPathMock = jest.fn();
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (...args: unknown[]) => ensureFolderPathMock(...args),
}));

import { projectArrayIntoVaultFolder } from '@/lib/database/repositories/vault-overlay/vault-projection';

function existingDoc(relativePath: string) {
  return { id: `doc-${relativePath}`, relativePath };
}

const RECURSIVE = {
  preserveFileNames: ['instructions.md'],
  recursive: { excludeSubfolders: ['images'] },
};

type Item = { file: string };
const mapper = (item: Item) => ({ fileName: item.file, content: `body of ${item.file}` });

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(true);
  ensureFolderPathMock.mockReset().mockResolvedValue('folder-id');
});

describe('projectArrayIntoVaultFolder — recursive', () => {
  it('lists recursively and writes items into their folders, ensuring each folder once', async () => {
    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [{ file: 'Coat.md' }, { file: 'Formal/Evening/Gown.md' }, { file: 'Formal/Evening/Gloves.md' }],
      mapper,
      'char-1',
      RECURSIVE,
    );

    expect(findManyByMountPointsInFolderMock).toHaveBeenCalledWith(['m-1'], 'Wardrobe', '.md', {
      recursive: true,
    });
    expect(writeDatabaseDocumentMock.mock.calls.map((c) => c[1])).toEqual([
      'Wardrobe/Coat.md',
      'Wardrobe/Formal/Evening/Gown.md',
      'Wardrobe/Formal/Evening/Gloves.md',
    ]);
    expect(ensureFolderPathMock.mock.calls.map((c) => c[1]).sort()).toEqual([
      'Wardrobe',
      'Wardrobe/Formal/Evening',
    ]);
  });

  it('sweeps a stale file at any depth — a moved item leaves no copy behind', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Coat.md'),
      existingDoc('Wardrobe/Old/Hat.md'),
    ]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [{ file: 'Formal/Coat.md' }],
      mapper,
      'char-1',
      RECURSIVE,
    );

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Wardrobe/Formal/Coat.md', 'body of Formal/Coat.md');
    expect(deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]).sort()).toEqual([
      'Wardrobe/Coat.md',
      'Wardrobe/Old/Hat.md',
    ]);
  });

  it('never touches images/, and keeps instructions.md at any depth', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/images/abc/caption.md'),
      existingDoc('Wardrobe/Images/def/caption.md'),
      existingDoc('Wardrobe/instructions.md'),
      existingDoc('Wardrobe/Formal/Instructions.md'),
    ]);

    await projectArrayIntoVaultFolder('m-1', 'Wardrobe', [], mapper, 'char-1', RECURSIVE);

    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('suffixes collisions per folder, case-insensitively', async () => {
    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [
        { file: 'Formal/Coat.md' },
        { file: 'Casual/Coat.md' },
        { file: 'Formal/coat.md' },
        { file: 'Formal/instructions.md' },
      ],
      mapper,
      'char-1',
      RECURSIVE,
    );

    expect(writeDatabaseDocumentMock.mock.calls.map((c) => c[1])).toEqual([
      'Wardrobe/Formal/Coat.md',
      'Wardrobe/Casual/Coat.md',
      'Wardrobe/Formal/coat-1.md',
      'Wardrobe/Formal/instructions-1.md',
    ]);
  });

  it('ensures only folders that do not already hold a document', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Coat.md'),
      existingDoc('Wardrobe/Formal/Gown.md'),
    ]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [{ file: 'Coat.md' }, { file: 'Formal/Gown.md' }, { file: 'Rainy/Mac.md' }],
      mapper,
      'char-1',
      RECURSIVE,
    );

    expect(ensureFolderPathMock.mock.calls.map((c) => c[1])).toEqual(['Wardrobe/Rainy']);
  });

  it('sweeps only the files ownsFile claims', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      existingDoc('Wardrobe/Formal/notes.md'),
      existingDoc('Wardrobe/Formal/Old.md'),
    ]);

    await projectArrayIntoVaultFolder('m-1', 'Wardrobe', [], mapper, 'char-1', {
      ...RECURSIVE,
      ownsFile: (doc) => !doc.relativePath.endsWith('notes.md'),
    });

    expect(deleteDatabaseDocumentMock.mock.calls.map((c) => c[1])).toEqual(['Wardrobe/Formal/Old.md']);
  });

  it('does not delete a file it just wrote when only the casing differs', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([existingDoc('Wardrobe/Formal/Coat.md')]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Wardrobe',
      [{ file: 'formal/Coat.md' }],
      mapper,
      'char-1',
      RECURSIVE,
    );

    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
  });
});

describe('projectArrayIntoVaultFolder — flat callers are unchanged', () => {
  it('lists top-level only, ensures just the folder, and writes a slashless name as-is', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([existingDoc('Prompts/stale.md')]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Prompts',
      [{ file: 'Default.md' }],
      mapper,
      'char-1',
    );

    expect(findManyByMountPointsInFolderMock).toHaveBeenCalledWith(['m-1'], 'Prompts', '.md', undefined);
    expect(ensureFolderPathMock).toHaveBeenCalledTimes(1);
    expect(ensureFolderPathMock).toHaveBeenCalledWith('m-1', 'Prompts');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Prompts/Default.md', 'body of Default.md');
    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Prompts/stale.md');
  });

  it('ensures nothing for an empty projection', async () => {
    await projectArrayIntoVaultFolder('m-1', 'Prompts', [], mapper, 'char-1');
    expect(ensureFolderPathMock).not.toHaveBeenCalled();
  });
});
