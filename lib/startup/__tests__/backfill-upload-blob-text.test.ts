/**
 * Bug 260 — uploads stored before text extraction get it at boot.
 */
import { backfillUploadBlobText } from '../backfill-upload-blob-text';
import { getRepositories } from '@/lib/repositories/factory';
import { extractBlobText } from '@/lib/mount-index/store-file';
import { reindexSingleFile } from '@/lib/doc-edit/reindex-file';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { EXTRACTABLE_BLOB_EXTENSIONS } from '@/lib/mount-index/path-utils';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/mount-index/store-file', () => ({ extractBlobText: jest.fn() }));
jest.mock('@/lib/doc-edit/reindex-file', () => ({ reindexSingleFile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(1),
}));

const blobRow = (id: string, mountPointId: string, relativePath: string) => ({
  id, linkId: `link-${id}`, mountPointId, relativePath, extractionStatus: 'none',
});

let repos: any;

beforeEach(() => {
  jest.clearAllMocks();
  repos = {
    docMountBlobs: {
      listUnextractedByExtensions: jest.fn(),
      readData: jest.fn().mockImplementation(async (id: string) => (id === 'gone' ? null : Buffer.from(`bytes of ${id}`))),
    },
    docMountPoints: { refreshStats: jest.fn().mockResolvedValue(undefined) },
  };
  jest.mocked(getRepositories).mockReturnValue(repos);
});

describe('backfillUploadBlobText', () => {
  it('is a no-op when every text blob already has its text', async () => {
    repos.docMountBlobs.listUnextractedByExtensions.mockResolvedValue([]);

    const result = await backfillUploadBlobText();

    expect(repos.docMountBlobs.listUnextractedByExtensions).toHaveBeenCalledWith([...EXTRACTABLE_BLOB_EXTENSIONS]);
    expect(result).toEqual({ candidates: 0, extracted: 0, failed: 0, storesTouched: 0 });
    expect(extractBlobText).not.toHaveBeenCalled();
  });

  it('extracts, chunks and queues embeddings once per store', async () => {
    repos.docMountBlobs.listUnextractedByExtensions.mockResolvedValue([
      blobRow('b1', 'mp-project', 'CHANGELOG.md'),
      blobRow('b2', 'mp-project', 'inventory.md'),
      blobRow('b3', 'mp-uploads', 'chat/report.pdf'),
    ]);
    jest.mocked(extractBlobText).mockResolvedValue(true);

    const result = await backfillUploadBlobText();

    expect(extractBlobText).toHaveBeenCalledWith({
      blobId: 'b1',
      linkId: 'link-b1',
      relativePath: 'CHANGELOG.md',
      data: Buffer.from('bytes of b1'),
      mountPointId: 'mp-project',
    });
    expect(reindexSingleFile).toHaveBeenCalledTimes(3);
    expect(reindexSingleFile).toHaveBeenCalledWith('mp-project', 'CHANGELOG.md', '');
    expect(enqueueEmbeddingJobsForMountPoint).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ candidates: 3, extracted: 3, failed: 0, storesTouched: 2 });
  });

  it('counts missing bytes and failed conversions without chunking them', async () => {
    repos.docMountBlobs.listUnextractedByExtensions.mockResolvedValue([
      blobRow('gone', 'mp-project', 'lost.md'),
      blobRow('b2', 'mp-project', 'empty.txt'),
    ]);
    jest.mocked(extractBlobText).mockResolvedValue(false);

    const result = await backfillUploadBlobText();

    expect(extractBlobText).toHaveBeenCalledTimes(1);
    expect(reindexSingleFile).not.toHaveBeenCalled();
    expect(enqueueEmbeddingJobsForMountPoint).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 2, extracted: 0, failed: 2, storesTouched: 0 });
  });

  it('never throws', async () => {
    repos.docMountBlobs.listUnextractedByExtensions.mockRejectedValue(new Error('index unavailable'));
    await expect(backfillUploadBlobText()).resolves.toMatchObject({ candidates: 0 });
  });
});
