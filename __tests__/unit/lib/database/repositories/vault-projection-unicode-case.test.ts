/**
 * #224: a case-only rename with a non-ASCII letter (`Café` → `CAFÉ`).
 *
 * The store folds ASCII only (`COLLATE NOCASE`), so writing `CAFÉ.md` mints a
 * new row beside `Café.md`. The projection must agree and sweep the old file;
 * comparing with `toLowerCase()` called them one path and left the stale
 * file behind, splitting the item across two files claiming one id.
 */

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

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

import { projectArrayIntoVaultFolder } from '@/lib/mount-index/vault-projection';

function existingDoc(relativePath: string) {
  return { id: `doc-${relativePath}`, relativePath };
}

const mapper = (item: { title: string }) => ({ fileName: `${item.title}.md`, content: item.title });

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
});

describe('projectArrayIntoVaultFolder — non-ASCII case-only rename (#224)', () => {
  it('writes CAFÉ.md and sweeps the stale Café.md (flat)', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([existingDoc('Atlas/Café.md')]);

    await projectArrayIntoVaultFolder('m-1', 'Atlas', [{ title: 'CAFÉ' }], mapper, 'char-1');

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Atlas/CAFÉ.md', 'CAFÉ');
    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Atlas/Café.md');
  });

  it('sweeps the stale file in a subfolder too (recursive)', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([existingDoc('Atlas/Places/Élan.md')]);

    await projectArrayIntoVaultFolder(
      'm-1',
      'Atlas',
      [{ title: 'Places/élan' }],
      mapper,
      'char-1',
      { recursive: { excludeSubfolders: ['images'] } },
    );

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Atlas/Places/élan.md', 'Places/élan');
    expect(deleteDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Atlas/Places/Élan.md');
  });

  it('still treats an ASCII case-only rename as the same row (no sweep)', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([existingDoc('Atlas/cafe.md')]);

    await projectArrayIntoVaultFolder('m-1', 'Atlas', [{ title: 'CAFE' }], mapper, 'char-1');

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith('m-1', 'Atlas/CAFE.md', 'CAFE');
    expect(deleteDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('gives Café and CAFÉ items their own files, as the store does', async () => {
    await projectArrayIntoVaultFolder('m-1', 'Atlas', [{ title: 'Café' }, { title: 'CAFÉ' }], mapper, 'char-1');

    expect(writeDatabaseDocumentMock.mock.calls.map((c) => c[1])).toEqual(['Atlas/Café.md', 'Atlas/CAFÉ.md']);
  });
});
