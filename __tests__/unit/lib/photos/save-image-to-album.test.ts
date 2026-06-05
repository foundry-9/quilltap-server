/**
 * saveImageToAlbum — content-hash dedup regression.
 *
 * The save path must hash the *actual stored bytes* and use that hash for both
 * the re-save dedup guard and the linkBlobContent write — not the FileEntry's
 * upload-time input sha256, which can diverge from the stored bytes across a
 * transcode. Keying off the input hash would let duplicates slip through and
 * record a sha that won't match the servable bytes.
 */

jest.mock('@/lib/images-v2', () => ({
  getImageById: jest.fn(),
  readImageBuffer: jest.fn(),
  ingestImageBuffer: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
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

import { saveImageToAlbum, SaveImageToAlbumError } from '@/lib/photos/save-image-to-album';
import { getImageById, readImageBuffer } from '@/lib/images-v2';
import { getRepositories } from '@/lib/repositories/factory';
import { sha256OfBuffer } from '@/lib/utils/sha256';

const mockGetImageById = getImageById as jest.MockedFunction<typeof getImageById>;
const mockReadImageBuffer = readImageBuffer as jest.MockedFunction<typeof readImageBuffer>;
const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;

const INPUT_SHA = 'a'.repeat(64);
const BYTES = Buffer.from('the-real-stored-bytes');
const BYTES_SHA = sha256OfBuffer(BYTES);

const fileEntry = {
  id: 'file-1',
  category: 'IMAGE' as const,
  sha256: INPUT_SHA,
  originalFilename: 'kettle.webp',
  mimeType: 'image/webp',
  generationPrompt: 'a copper kettle',
  generationRevisedPrompt: null,
  generationModel: 'grok-image-v2',
};

const attribution = { name: 'You', id: 'user-1', role: 'user' as const };

function buildRepos(photoLinks: Array<{ sha256: string; relativePath: string; id: string; createdAt: string }> = []) {
  return {
    docMountPoints: {
      findById: jest.fn().mockResolvedValue({ id: 'mp-1', name: 'Quilltap General' }),
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue(photoLinks),
      findByIdWithContent: jest.fn(),
      linkBlobContent: jest.fn().mockResolvedValue({ link: { id: 'new-link' } }),
    },
    docMountBlobs: { readDataByFileId: jest.fn() },
    files: { findBySha256: jest.fn() },
    chats: { findById: jest.fn() },
  };
}

describe('saveImageToAlbum content-hash dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetImageById.mockResolvedValue(fileEntry as any);
    mockReadImageBuffer.mockResolvedValue(BYTES);
  });

  it('records and returns the hash of the stored bytes, not the FileEntry input hash', async () => {
    const repos = buildRepos();
    mockGetRepositories.mockReturnValue(repos as any);

    const result = await saveImageToAlbum({ mountPointId: 'mp-1', fileId: 'file-1', attribution });

    expect(BYTES_SHA).not.toBe(INPUT_SHA);
    expect(result.sha256).toBe(BYTES_SHA);
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({ mountPointId: 'mp-1', sha256: BYTES_SHA, data: BYTES })
    );
  });

  it('treats a prior photos/ link with the same stored-bytes hash as a duplicate', async () => {
    const repos = buildRepos([
      { id: 'existing', sha256: BYTES_SHA, relativePath: 'photos/old.webp', createdAt: '2026-05-15T00:00:00.000Z' },
    ]);
    mockGetRepositories.mockReturnValue(repos as any);

    await expect(
      saveImageToAlbum({ mountPointId: 'mp-1', fileId: 'file-1', attribution })
    ).rejects.toMatchObject({ code: 'ALREADY_SAVED' } as Partial<SaveImageToAlbumError>);
    expect(repos.docMountFileLinks.linkBlobContent).not.toHaveBeenCalled();
  });

  it('does NOT treat a prior link carrying only the old input hash as a duplicate', async () => {
    // A pre-fix link whose recorded sha is the input hash must no longer block a
    // save — dedup keys on the bytes hash now.
    const repos = buildRepos([
      { id: 'stale', sha256: INPUT_SHA, relativePath: 'photos/old.webp', createdAt: '2026-05-15T00:00:00.000Z' },
    ]);
    mockGetRepositories.mockReturnValue(repos as any);

    const result = await saveImageToAlbum({ mountPointId: 'mp-1', fileId: 'file-1', attribution });
    expect(result.linkId).toBe('new-link');
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledTimes(1);
  });
});
