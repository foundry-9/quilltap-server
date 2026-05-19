jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    downloadFile: jest.fn(),
  },
}));

jest.mock('@/lib/chat/file-attachment-fallback', () => ({
  generateImageDescription: jest.fn(),
}));

jest.mock('@/lib/photos/chunk-extracted-text', () => ({
  chunkAndInsertExtractedText: jest.fn(),
}));

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}));

import { autoDescribeChatImageAttachment } from '@/lib/photos/auto-describe-attachment';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { generateImageDescription } from '@/lib/chat/file-attachment-fallback';
import { chunkAndInsertExtractedText } from '@/lib/photos/chunk-extracted-text';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';

const mockDownload = fileStorageManager.downloadFile as jest.MockedFunction<
  typeof fileStorageManager.downloadFile
>;
const mockGenerate = generateImageDescription as jest.MockedFunction<typeof generateImageDescription>;
const mockChunk = chunkAndInsertExtractedText as jest.MockedFunction<typeof chunkAndInsertExtractedText>;
const mockEnqueueEmbedding = enqueueEmbeddingJobsForMountPoint as jest.MockedFunction<
  typeof enqueueEmbeddingJobsForMountPoint
>;

function buildRepos() {
  return {
    files: {
      findById: jest.fn(),
      update: jest.fn(),
    },
    docMountFiles: {
      findBySha256: jest.fn(),
    },
    docMountFileLinks: {
      findByFileId: jest.fn(),
      update: jest.fn(),
    },
  };
}

const baseEntry = {
  id: 'file-1',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  description: null,
  originalFilename: 'snap.png',
  size: 100,
};

describe('autoDescribeChatImageAttachment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when the file entry is missing', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(null);

    const result = await autoDescribeChatImageAttachment({
      fileEntryId: 'missing',
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result.skipReason).toBe('not-found');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('skips non-image MIME types', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue({ ...baseEntry, mimeType: 'application/pdf' });

    const result = await autoDescribeChatImageAttachment({
      fileEntryId: baseEntry.id,
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result.skipReason).toBe('not-image');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('skips files that already carry a description', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue({ ...baseEntry, description: 'already done' });

    const result = await autoDescribeChatImageAttachment({
      fileEntryId: baseEntry.id,
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result.skipReason).toBe('already-described');
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('describes the image and updates blank links + queues embeddings', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(baseEntry);
    repos.files.update.mockResolvedValue({ ...baseEntry, description: 'A nice photo.' });
    repos.docMountFiles.findBySha256.mockResolvedValue({ id: 'mfile-1', sha256: baseEntry.sha256 });
    repos.docMountFileLinks.findByFileId.mockResolvedValue([
      // Chat upload link — blank extractedText. Should be updated.
      { id: 'link-chat', mountPointId: 'mp-uploads', extractedText: '' },
      // Kept-image link — has Markdown extractedText. Should be left alone.
      { id: 'link-kept', mountPointId: 'mp-vault', extractedText: '---\ntags: []\n---\nhello' },
    ]);
    repos.docMountFileLinks.update.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue(Buffer.from('imagebytes'));
    mockGenerate.mockResolvedValue({
      type: 'image_description',
      imageDescription: 'A nice photo.',
      processingMetadata: {
        usedImageDescriptionLLM: true,
        usedUncensoredFallback: false,
        originalFilename: baseEntry.originalFilename,
        originalMimeType: baseEntry.mimeType,
      },
    });
    mockChunk.mockResolvedValue({ chunksCreated: 1, plainTextLength: 12 });
    mockEnqueueEmbedding.mockResolvedValue(1);

    const result = await autoDescribeChatImageAttachment({
      fileEntryId: baseEntry.id,
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result.describedFileEntry).toBe(true);
    expect(result.linksUpdated).toBe(1);
    expect(result.description).toBe('A nice photo.');
    expect(repos.files.update).toHaveBeenCalledWith(baseEntry.id, { description: 'A nice photo.' });
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      'link-chat',
      expect.objectContaining({
        description: 'A nice photo.',
        extractedText: 'A nice photo.',
        extractionStatus: 'converted',
      })
    );
    expect(repos.docMountFileLinks.update).not.toHaveBeenCalledWith('link-kept', expect.anything());
    expect(mockChunk).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEmbedding).toHaveBeenCalledWith('mp-uploads');
  });

  it('returns describe-failed when the vision LLM cannot produce a description', async () => {
    const repos = buildRepos();
    repos.files.findById.mockResolvedValue(baseEntry);
    mockDownload.mockResolvedValue(Buffer.from('imagebytes'));
    mockGenerate.mockResolvedValue({
      type: 'unsupported',
      error: 'No vision profile configured',
    });

    const result = await autoDescribeChatImageAttachment({
      fileEntryId: baseEntry.id,
      userId: 'user-1',
      repos: repos as any,
    });

    expect(result.skipReason).toBe('describe-failed');
    expect(repos.files.update).not.toHaveBeenCalled();
  });
});
