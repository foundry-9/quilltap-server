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
import { sha256OfBuffer } from '@/lib/utils/sha256';

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
      findByMountPointId: jest.fn().mockResolvedValue([]),
      findByIdWithContent: jest.fn(),
      linkBlobContent: jest.fn(),
      deleteWithGC: jest.fn(),
    },
    docMountPoints: {
      findById: jest.fn(),
      findEnabled: jest.fn().mockResolvedValue([]),
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
  };
}

const SHA = 'a'.repeat(64);
// The bytes the storage manager returns. Their real hash deliberately differs
// from baseFile.sha256 (the upload-time input hash) — the save path must dedup
// and record the *bytes* hash, not the FileEntry's input hash.
const BYTES = Buffer.from('imagebytes');
const BYTES_SHA = sha256OfBuffer(BYTES);

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
    mockDownload.mockResolvedValue(BYTES);
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

    // The re-save guard must key off the hash of the actual bytes, not the
    // FileEntry's upload-time input hash (which can diverge across a transcode).
    expect(mockLinkSummary).toHaveBeenCalledWith(BYTES_SHA, expect.anything());
    expect(mockLinkSummary).not.toHaveBeenCalledWith(SHA, expect.anything());
  });

  it('saves a new image — links blob, chunks the markdown, returns metadata', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(baseFile);
    mockLinkSummary.mockResolvedValue({ count: 0, linkers: [] });
    mockDownload.mockResolvedValue(BYTES);
    repos.docMountFileLinks.linkBlobContent.mockResolvedValue({
      link: { id: 'new-link', mountPointId: 'mp-uploads', relativePath: 'photos/x.png', sha256: BYTES_SHA },
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

    // sha256 reported and linked is the hash of the stored bytes, not the
    // FileEntry's upload-time input hash.
    expect(result).toMatchObject({
      linkId: 'new-link',
      mountPointId: 'mp-uploads',
      mountPointName: 'Quilltap Uploads',
      fileId: 'file-1',
      sha256: BYTES_SHA,
    });
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({
        mountPointId: 'mp-uploads',
        sha256: BYTES_SHA,
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

  it('returns an empty list when no enabled mount points have photos/ links', async () => {
    const repos = buildRepos();
    repos.docMountPoints.findEnabled.mockResolvedValue([{ id: 'mp-uploads' }]);
    repos.docMountFileLinks.findByMountPointId.mockResolvedValue([]);
    const result = await listUserGallery({ userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ entries: [], total: 0, hasMore: false });
  });

  const SHA_A = 'a'.repeat(64);
  const SHA_B = 'b'.repeat(64);
  const SHA_C = 'c'.repeat(64);

  function link(id: string, mountPointId: string, relativePath: string, createdAt: string, sha256: string) {
    const fileName = relativePath.split('/').pop()!;
    return { id, mountPointId, relativePath, createdAt, sha256, originalMimeType: 'image/png', fileName, fileSizeBytes: 100, extractedText: '' };
  }

  function seedThreeStores(repos: ReturnType<typeof buildRepos>) {
    const stores = {
      'mp-uploads': { id: 'mp-uploads', storeType: 'documents', enabled: true },
      'mp-project': { id: 'mp-project', storeType: 'documents', enabled: true },
      'mp-vault-charlie': { id: 'mp-vault-charlie', storeType: 'character', enabled: true },
    } as Record<string, { id: string; storeType: string; enabled: boolean }>;
    repos.docMountPoints.findEnabled.mockResolvedValue(Object.values(stores));
    repos.docMountPoints.findById.mockImplementation(async (id: string) => stores[id] ?? null);
    repos.docMountFileLinks.findByMountPointId.mockImplementation(async (id: string) => {
      if (id === 'mp-uploads') {
        return [
          link('l-old', 'mp-uploads', 'photos/a.png', '2026-05-13T00:00:00.000Z', SHA_A),
          link('l-other', 'mp-uploads', 'chat/c.png', '2026-05-14T00:00:00.000Z', SHA_B),
        ];
      }
      if (id === 'mp-project') {
        // Same sha as l-old — should dedupe with this newer link surfaced as primary.
        return [link('l-newest-dup', 'mp-project', 'photos/a-redux.png', '2026-05-15T00:00:00.000Z', SHA_A)];
      }
      if (id === 'mp-vault-charlie') {
        return [
          link('l-vault-dup', 'mp-vault-charlie', 'photos/a-again.png', '2026-05-16T00:00:00.000Z', SHA_A),
          link('l-vault-only', 'mp-vault-charlie', 'photos/d.png', '2026-05-14T12:00:00.000Z', SHA_C),
        ];
      }
      return [];
    });
    mockLinkSummary.mockResolvedValue({ count: 1, linkers: [] });
  }

  it('aggregates photos/ links across every non-character store, deduped by sha256, newest-first', async () => {
    const repos = buildRepos();
    seedThreeStores(repos);

    const result = await listUserGallery({ userId: 'user-1', repos: repos as any });

    // The vault is skipped entirely — not even its newer duplicate of SHA_A
    // is chosen as primary — and its own picture (SHA_C) is absent.
    expect(result.total).toBe(1);
    expect(result.entries.map(e => e.linkId)).toEqual(['l-newest-dup']);
    expect(repos.docMountFileLinks.findByMountPointId).not.toHaveBeenCalledWith('mp-vault-charlie');
    expect(result.hasMore).toBe(false);
  });

  it('lists one character vault when that album is chosen', async () => {
    const repos = buildRepos();
    seedThreeStores(repos);

    const result = await listUserGallery({ mountPointId: 'mp-vault-charlie', userId: 'user-1', repos: repos as any });

    expect(result.entries.map(e => e.linkId)).toEqual(['l-vault-dup', 'l-vault-only']);
    expect(repos.docMountFileLinks.findByMountPointId).toHaveBeenCalledTimes(1);
  });

  it('lists one document store when that album is chosen', async () => {
    const repos = buildRepos();
    seedThreeStores(repos);

    const result = await listUserGallery({ mountPointId: 'mp-uploads', userId: 'user-1', repos: repos as any });

    expect(result.entries.map(e => e.linkId)).toEqual(['l-old']);
  });

  it('refuses an album that does not exist or is disabled', async () => {
    const repos = buildRepos();
    seedThreeStores(repos);

    await expect(
      listUserGallery({ mountPointId: 'mp-gone', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('Album not found');
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

  it('accepts deletion of a photos/ link in any non-character store', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'l-project',
      mountPointId: 'mp-project',
      relativePath: 'photos/x.png',
    });
    repos.docMountPoints.findById.mockResolvedValue({ id: 'mp-project', storeType: 'documents' });
    repos.docMountFileLinks.deleteWithGC.mockResolvedValue({ fileId: 'file-1', fileGC: false });

    const result = await removeFromUserGallery({ linkId: 'l-project', userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ deleted: true, fileGC: false });
    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledWith('l-project');
  });

  it("refuses a character vault's photo — that album has its own door", async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'l-vault',
      mountPointId: 'mp-some-vault',
      relativePath: 'photos/x.png',
    });
    repos.docMountPoints.findById.mockResolvedValue({ id: 'mp-some-vault', storeType: 'character' });

    await expect(
      removeFromUserGallery({ linkId: 'l-vault', userId: 'user-1', repos: repos as any })
    ).rejects.toThrow('not a gallery entry');
    expect(repos.docMountFileLinks.deleteWithGC).not.toHaveBeenCalled();
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
    repos.docMountPoints.findById.mockResolvedValue({ id: 'mp-uploads', storeType: 'documents' });
    repos.docMountFileLinks.deleteWithGC.mockResolvedValue({ fileId: 'file-1', fileGC: true });

    const result = await removeFromUserGallery({ linkId: 'l-ok', userId: 'user-1', repos: repos as any });
    expect(result).toEqual({ deleted: true, fileGC: true });
    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledWith('l-ok');
  });
});
