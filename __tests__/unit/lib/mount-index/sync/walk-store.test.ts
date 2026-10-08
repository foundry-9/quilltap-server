import { walkStore, hasDotSegment } from '@/lib/mount-index/sync/walk-store';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

jest.mock('@/lib/repositories/factory');

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const mountPoint = { id: 'mp-1', name: 'Store' } as DocMountPoint;

function link(over: Record<string, unknown>) {
  return {
    id: 'link-x',
    fileId: 'file-x',
    relativePath: 'x.md',
    sha256: 'abc',
    fileSizeBytes: 3,
    lastModified: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    fileType: 'markdown',
    ...over,
  };
}

describe('hasDotSegment', () => {
  it.each([
    ['a.md', false],
    ['dir/a.md', false],
    ['.hidden', true],
    ['dir/.hidden/a.md', true],
    ['dir/.DS_Store', true],
    ['dir/file.with.dots', false],
    ['', false],
  ])('%s -> %s', (p, expected) => {
    expect(hasDotSegment(p)).toBe(expected);
  });
});

describe('walkStore', () => {
  let folders: jest.Mock;
  let links: jest.Mock;

  beforeEach(() => {
    folders = jest.fn().mockResolvedValue([]);
    links = jest.fn().mockResolvedValue([]);
    getRepositoriesMock.mockReturnValue({
      docMountFolders: { findByMountPointId: folders },
      docMountFileLinks: { findByMountPointId: links },
    });
  });

  it('returns empty results for an empty store', async () => {
    const result = await walkStore(mountPoint);
    expect(result.entries.size).toBe(0);
    expect(result.reservedPaths).toEqual([]);
    expect(folders).toHaveBeenCalledWith('mp-1');
    expect(links).toHaveBeenCalledWith('mp-1');
  });

  it('maps folders and links to lower-cased keyed entries, skipping the root folder', async () => {
    folders.mockResolvedValue([
      { id: 'f-root', path: '', updatedAt: 'u', createdAt: 'c' },
      { id: 'f-1', path: 'Lore', updatedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    links.mockResolvedValue([
      link({
        id: 'l-1', fileId: 'fi-1', relativePath: 'Lore/Harbour.png', fileType: 'blob',
        description: 'foggy', descriptionUpdatedAt: '2026-03-01T00:00:00.000Z',
        linkGroupId: 'g-1', folderId: 'f-1',
      }),
    ]);

    const { entries } = await walkStore(mountPoint);
    expect([...entries.keys()].sort()).toEqual(['lore', 'lore/harbour.png']);
    expect(entries.get('lore')).toEqual({
      relativePath: 'Lore',
      kind: 'folder',
      lastModified: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      folderId: 'f-1',
    });
    expect(entries.get('lore/harbour.png')).toEqual({
      relativePath: 'Lore/Harbour.png',
      kind: 'file',
      sha256: 'abc',
      sizeBytes: 3,
      lastModified: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      description: 'foggy',
      descriptionUpdatedAt: '2026-03-01T00:00:00.000Z',
      linkId: 'l-1',
      fileId: 'fi-1',
      linkGroupId: 'g-1',
      fileType: 'blob',
      folderId: 'f-1',
    });
  });

  it('defaults missing description / group / folder fields', async () => {
    links.mockResolvedValue([link({ relativePath: 'a.md' })]);
    const { entries } = await walkStore(mountPoint);
    const e = entries.get('a.md')!;
    expect(e.description).toBe('');
    expect(e.descriptionUpdatedAt).toBeNull();
    expect(e.linkGroupId).toBeNull();
    expect(e.folderId).toBeNull();
  });

  it('drops dot-path folders and links entirely', async () => {
    folders.mockResolvedValue([
      { id: 'f-1', path: '.git', updatedAt: 'u', createdAt: 'c' },
      { id: 'f-2', path: 'ok/.cache', updatedAt: 'u', createdAt: 'c' },
    ]);
    links.mockResolvedValue([
      link({ relativePath: '.hidden.md' }),
      link({ relativePath: 'ok/.cache/x.md' }),
      link({ relativePath: 'visible.md' }),
    ]);
    const { entries, reservedPaths } = await walkStore(mountPoint);
    expect([...entries.keys()]).toEqual(['visible.md']);
    expect(reservedPaths).toEqual([]);
  });

  it('reports sidecar-suffixed store paths as reserved and leaves them out of entries', async () => {
    links.mockResolvedValue([
      link({ relativePath: 'pic.png.description.md' }),
      link({ relativePath: 'Pic2.PNG.Description.MD' }),
      link({ relativePath: 'pic.png' }),
    ]);
    const { entries, reservedPaths } = await walkStore(mountPoint);
    expect([...entries.keys()]).toEqual(['pic.png']);
    expect(reservedPaths).toEqual(['pic.png.description.md', 'Pic2.PNG.Description.MD']);
  });
});
