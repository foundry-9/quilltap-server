import {
  getPhotoLinkSummaryBySha256,
  getPhotoLinkSummaryByFileId,
} from '@/lib/photos/photo-link-summary';
import { buildKeptImageMarkdown } from '@/lib/photos/keep-image-markdown';

interface FakeRepos {
  files: {
    findById: jest.Mock;
  };
  docMountFiles: {
    findBySha256: jest.Mock;
  };
  docMountFileLinks: {
    findByFileId: jest.Mock;
  };
  docMountPoints: {
    findById: jest.Mock;
  };
}

function buildRepos(): FakeRepos {
  return {
    files: { findById: jest.fn() },
    docMountFiles: { findBySha256: jest.fn() },
    docMountFileLinks: { findByFileId: jest.fn() },
    docMountPoints: { findById: jest.fn() },
  };
}

const SHA = 'a'.repeat(64);

describe('getPhotoLinkSummaryBySha256', () => {
  it('returns the empty summary when no doc_mount_files row matches the sha', async () => {
    const repos = buildRepos();
    repos.docMountFiles.findBySha256.mockResolvedValue(null);

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);

    expect(summary).toEqual({ count: 0, linkers: [] });
    expect(repos.docMountFileLinks.findByFileId).not.toHaveBeenCalled();
  });

  it('returns the empty summary when sha is empty', async () => {
    const repos = buildRepos();
    const summary = await getPhotoLinkSummaryBySha256('', repos as any);

    expect(summary).toEqual({ count: 0, linkers: [] });
    expect(repos.docMountFiles.findBySha256).not.toHaveBeenCalled();
  });

  it('parses kept-image frontmatter for character-vault links', async () => {
    const repos = buildRepos();
    const extractedText = buildKeptImageMarkdown({
      generationPrompt: 'a copper kettle',
      generationRevisedPrompt: null,
      generationModel: 'grok-image-v2',
      sceneState: null,
      characterName: 'Friday',
      characterId: 'char-friday',
      tags: ['kitchen', 'cozy'],
      caption: 'tea was on',
      keptAt: '2026-05-14T07:22:33.000Z',
    });

    repos.docMountFiles.findBySha256.mockResolvedValue({ id: 'file-1', sha256: SHA });
    repos.docMountFileLinks.findByFileId.mockResolvedValue([
      {
        id: 'link-1',
        mountPointId: 'mp-1',
        relativePath: 'photos/2026-05-14T07-22-33.000Z-tea-was-on.webp',
        createdAt: '2026-05-14T07:22:34.000Z',
        extractedText,
      },
    ]);
    repos.docMountPoints.findById.mockResolvedValue({
      id: 'mp-1',
      name: "Friday's Vault",
      storeType: 'character',
    });

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);

    expect(summary.count).toBe(1);
    expect(summary.linkers).toEqual([
      {
        linkId: 'link-1',
        mountPointId: 'mp-1',
        mountPointName: "Friday's Vault",
        mountStoreType: 'character',
        relativePath: 'photos/2026-05-14T07-22-33.000Z-tea-was-on.webp',
        isPhotoAlbum: true,
        linkedAt: '2026-05-14T07:22:34.000Z',
        linkedBy: 'Friday',
        linkedById: 'char-friday',
        caption: 'tea was on',
        tags: ['kitchen', 'cozy'],
      },
    ]);
  });

  it('returns linkers with null identity for non-kept links (chat uploads, avatars)', async () => {
    const repos = buildRepos();
    repos.docMountFiles.findBySha256.mockResolvedValue({ id: 'file-2', sha256: SHA });
    repos.docMountFileLinks.findByFileId.mockResolvedValue([
      {
        id: 'link-2',
        mountPointId: 'mp-uploads',
        relativePath: 'chat/cat.webp',
        createdAt: '2026-05-14T08:00:00.000Z',
        extractedText: '',
      },
    ]);
    repos.docMountPoints.findById.mockResolvedValue({
      id: 'mp-uploads',
      name: 'Quilltap Uploads',
      storeType: 'documents',
    });

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);

    expect(summary.count).toBe(1);
    expect(summary.linkers[0]).toMatchObject({
      linkId: 'link-2',
      mountPointName: 'Quilltap Uploads',
      mountStoreType: 'documents',
      isPhotoAlbum: false,
      linkedBy: null,
      linkedById: null,
      caption: null,
      tags: [],
    });
  });

  it('skips link rows whose mount point row is missing', async () => {
    const repos = buildRepos();
    repos.docMountFiles.findBySha256.mockResolvedValue({ id: 'file-3', sha256: SHA });
    repos.docMountFileLinks.findByFileId.mockResolvedValue([
      {
        id: 'link-a',
        mountPointId: 'mp-gone',
        relativePath: 'photos/x.webp',
        createdAt: '2026-05-14T08:00:00.000Z',
        extractedText: '',
      },
      {
        id: 'link-b',
        mountPointId: 'mp-good',
        relativePath: 'photos/y.webp',
        createdAt: '2026-05-14T08:01:00.000Z',
        extractedText: '',
      },
    ]);
    repos.docMountPoints.findById.mockImplementation(async (id: string) =>
      id === 'mp-good' ? { id, name: 'Good', storeType: 'documents' } : null
    );

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);

    expect(summary.count).toBe(1);
    expect(summary.linkers[0].linkId).toBe('link-b');
  });

  it('caches mount point lookups across multiple links', async () => {
    const repos = buildRepos();
    repos.docMountFiles.findBySha256.mockResolvedValue({ id: 'file-4', sha256: SHA });
    repos.docMountFileLinks.findByFileId.mockResolvedValue([
      {
        id: 'link-1',
        mountPointId: 'mp-1',
        relativePath: 'photos/a.webp',
        createdAt: '2026-05-14T08:00:00.000Z',
        extractedText: '',
      },
      {
        id: 'link-2',
        mountPointId: 'mp-1',
        relativePath: 'photos/b.webp',
        createdAt: '2026-05-14T08:01:00.000Z',
        extractedText: '',
      },
    ]);
    repos.docMountPoints.findById.mockResolvedValue({ id: 'mp-1', name: 'Vault', storeType: 'character' });

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);

    expect(summary.count).toBe(2);
    expect(repos.docMountPoints.findById).toHaveBeenCalledTimes(1);
  });

  it('swallows DB errors and returns the empty summary', async () => {
    const repos = buildRepos();
    repos.docMountFiles.findBySha256.mockRejectedValue(new Error('db is sulking'));

    const summary = await getPhotoLinkSummaryBySha256(SHA, repos as any);
    expect(summary).toEqual({ count: 0, linkers: [] });
  });
});

describe('getPhotoLinkSummaryByFileId', () => {
  it('returns the empty summary when the file id is unknown', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(null);

    const summary = await getPhotoLinkSummaryByFileId('missing', repos as any);
    expect(summary).toEqual({ count: 0, linkers: [] });
  });

  it('looks up by sha256 when the file entry resolves', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue({ id: 'f1', sha256: SHA });
    repos.docMountFiles.findBySha256.mockResolvedValue(null);

    await getPhotoLinkSummaryByFileId('f1', repos as any);
    expect(repos.docMountFiles.findBySha256).toHaveBeenCalledWith(SHA);
  });
});
