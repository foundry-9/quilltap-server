jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  getUserUploadsStore: jest.fn(),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    downloadFile: jest.fn(),
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
}));

jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: jest.fn(),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/lib/file-storage/bridge-path-helpers', () => ({
  resolveUniqueRelativePath: jest.fn().mockImplementation(async (_mp: string, p: string) => p),
}));

jest.mock('@/lib/photos/chunk-extracted-text', () => ({
  chunkAndInsertExtractedText: jest.fn().mockResolvedValue({ chunksCreated: 1, plainTextLength: 10 }),
}));

jest.mock('@/lib/photos/photo-link-summary', () => ({
  getPhotoLinkSummaryBySha256: jest.fn(),
}));

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: jest.fn(),
}));

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}));

import {
  saveToUserGallery,
  listUserGallery,
  removeFromUserGallery,
} from '@/lib/photos/user-gallery-service';
import { getUserUploadsStore } from '@/lib/file-storage/user-uploads-bridge';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary';

const mockGetStore = getUserUploadsStore as jest.MockedFunction<typeof getUserUploadsStore>;
const mockDownload = fileStorageManager.downloadFile as jest.MockedFunction<typeof fileStorageManager.downloadFile>;
const mockLinkSummary = getPhotoLinkSummaryBySha256 as jest.MockedFunction<typeof getPhotoLinkSummaryBySha256>;

function buildRepos() {
  return {
    files: {
      findById: jest.fn(),
    },
    chats: {
      findById: jest.fn(),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn(),
      findByIdWithContent: jest.fn(),
      linkBlobContent: jest.fn(),
      deleteWithGC: jest.fn(),
    },
    docMountPoints: {
      findById: jest.fn(),
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const SHA = 'a'.repeat(64);

const baseFile = {
  id: 'file-1',
  userId: 'user-1',
  mimeType: 'image/png',
  sha256: SHA,
  category: 'IMAGE' as const,
  originalFilename: 'kettle.png',
  generationPrompt: 'a copper kettle',
  generationRevisedPrompt: null,
  generationModel: 'grok-image-v2',
};

describe('saveToUserGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStore.mockResolvedValue({ mountPointId: 'mp-uploads' });
  });

  it('throws when the user-uploads mount is unprovisioned', async () => {
    mockGetStore.mockResolvedValue(null);
    const repos = buildRepos();

    await expect(
      saveToUserGallery({
        fileId: 'file-1',
        userId: 'user-1',
        repos: repos as any,
      })
    ).rejects.toThrow('not been provisioned');
  });

  it('rejects non-image FileEntries', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue({ ...baseFile, category: 'ATTACHMENT', mimeType: 'application/pdf' });
    await expect(
      saveToUserGallery({ fileId: 'file-1', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('not an image');
  });

  it('rejects files owned by another user', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue({ ...baseFile, userId: 'someone-else' });
    await expect(
      saveToUserGallery({ fileId: 'file-1', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('not owned');
  });

  it('refuses a second save of the same image into the gallery', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(baseFile);
    mockLinkSummary.mockResolvedValue({
      count: 1,
      linkers: [{
        linkId: 'link-existing',
        mountPointId: 'mp-uploads',
        mountPointName: 'Quilltap Uploads',
        mountStoreType: 'documents',
        relativePath: 'photos/2026-05-15T00-00-00.000Z-kettle.png',
        isPhotoAlbum: true,
        linkedAt: '2026-05-15T00:00:00.000Z',
        linkedBy: 'You',
        linkedById: 'user-1',
        caption: null,
        tags: [],
      }],
    });

    await expect(
      saveToUserGallery({ fileId: 'file-1', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('already saved');
  });

  it('saves a new image — links blob, chunks the markdown, returns metadata', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(baseFile);
    mockLinkSummary.mockResolvedValue({ count: 0, linkers: [] });
    mockDownload.mockResolvedValue(Buffer.from('imagebytes'));
    repos.docMountFileLinks.linkBlobContent.mockResolvedValue({
      link: { id: 'new-link', mountPointId: 'mp-uploads', relativePath: 'photos/x.png', sha256: SHA },
      file: { id: 'new-file' },
      blobId: 'new-blob',
    });
    repos.docMountPoints.findById.mockResolvedValue({ id: 'mp-uploads', name: 'Quilltap Uploads' });

    const result = await saveToUserGallery({
      fileId: 'file-1',
      caption: 'sunday morning',
      tags: ['cozy'],
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result).toMatchObject({
      linkId: 'new-link',
      mountPointId: 'mp-uploads',
      mountPointName: 'Quilltap Uploads',
      fileId: 'file-1',
      sha256: SHA,
    });
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({
        mountPointId: 'mp-uploads',
        sha256: SHA,
        description: 'sunday morning',
        extractionStatus: 'converted',
      })
    );
  });
});

describe('listUserGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStore.mockResolvedValue({ mountPointId: 'mp-uploads' });
  });

  it('returns an empty list when the user-uploads mount is unprovisioned', async () => {
    mockGetStore.mockResolvedValue(null);
    const repos = buildRepos();
    const result = await listUserGallery({ userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ entries: [], total: 0, hasMore: false });
  });

  it('returns photos/ links sorted newest-first when no query is supplied', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByMountPointId.mockResolvedValue([
      { id: 'l-old', relativePath: 'photos/a.png', createdAt: '2026-05-13T00:00:00.000Z', sha256: SHA, originalMimeType: 'image/png', fileName: 'a.png', fileSizeBytes: 100, extractedText: '' },
      { id: 'l-new', relativePath: 'photos/b.png', createdAt: '2026-05-15T00:00:00.000Z', sha256: SHA, originalMimeType: 'image/png', fileName: 'b.png', fileSizeBytes: 100, extractedText: '' },
      { id: 'l-other', relativePath: 'chat/c.png', createdAt: '2026-05-14T00:00:00.000Z', sha256: SHA, originalMimeType: 'image/png', fileName: 'c.png', fileSizeBytes: 100, extractedText: '' },
    ]);
    mockLinkSummary.mockResolvedValue({ count: 1, linkers: [] });

    const result = await listUserGallery({ userId: 'user-1', repos: repos as any });

    expect(result.total).toBe(2);
    expect(result.entries.map(e => e.linkId)).toEqual(['l-new', 'l-old']);
    expect(result.hasMore).toBe(false);
  });
});

describe('removeFromUserGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStore.mockResolvedValue({ mountPointId: 'mp-uploads' });
  });

  it('returns deleted: false when the link is unknown', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);
    const result = await removeFromUserGallery({ linkId: 'missing', userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ deleted: false, fileGC: false });
  });

  it('refuses to delete a link outside the user-uploads mount', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'l-vault',
      mountPointId: 'mp-some-vault',
      relativePath: 'photos/x.png',
    });
    await expect(
      removeFromUserGallery({ linkId: 'l-vault', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('not in the user gallery');
  });

  it('refuses to delete a link outside photos/', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'l-chat',
      mountPointId: 'mp-uploads',
      relativePath: 'chat/x.png',
    });
    await expect(
      removeFromUserGallery({ linkId: 'l-chat', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('not a gallery entry');
  });

  it('deletes a valid gallery entry via deleteWithGC', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'l-ok',
      mountPointId: 'mp-uploads',
      relativePath: 'photos/ok.png',
    });
    repos.docMountFileLinks.deleteWithGC.mockResolvedValue({ fileId: 'file-1', fileGC: true });

    const result = await removeFromUserGallery({ linkId: 'l-ok', userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ deleted: true, fileGC: true });
    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledWith('l-ok');
  });
});
