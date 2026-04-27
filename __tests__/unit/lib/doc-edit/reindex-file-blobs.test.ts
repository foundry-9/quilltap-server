/**
 * Unit tests for reindexSingleFile's blob-extractedText branch.
 *
 * When a database-backed document store holds a pdf/docx file, its bytes live
 * in doc_mount_blobs (not doc_mount_documents) and its plain-text representation
 * lives in doc_mount_blobs.extractedText. reindexSingleFile must chunk that
 * extracted text and mirror sha256/size from the blob — not the text — so the
 * doc_mount_files row stays aligned with the source-of-truth bytes.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  createLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/mount-index/chunker', () => ({
  chunkDocument: jest.fn().mockReturnValue([
    { chunkIndex: 0, content: 'Hello chunk', tokenCount: 2, headingContext: null },
  ]),
}));

jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory')
  .getRepositories as jest.Mock;

import { reindexSingleFile } from '@/lib/doc-edit/reindex-file';

const MOUNT_ID = 'mount-xyz';

interface Repos {
  docMountPoints: { findById: jest.Mock };
  docMountDocuments: { findByMountPointAndPath: jest.Mock };
  docMountBlobs: { findByMountPointAndPath: jest.Mock };
  docMountFiles: {
    findByMountPointAndPath: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  docMountChunks: {
    deleteByFileId: jest.Mock;
    bulkInsert: jest.Mock;
  };
}

function createRepos(): Repos {
  return {
    docMountPoints: {
      findById: jest.fn().mockResolvedValue({
        id: MOUNT_ID,
        mountType: 'database',
      }),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    docMountBlobs: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    docMountFiles: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    },
    docMountChunks: {
      deleteByFileId: jest.fn().mockResolvedValue(undefined),
      bulkInsert: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('reindexSingleFile (blob extractedText branch)', () => {
  let repos: Repos;

  beforeEach(() => {
    jest.clearAllMocks();
    repos = createRepos();
    getRepositoriesMock.mockReturnValue(repos);
  });

  it('chunks extractedText from doc_mount_blobs when no document row exists', async () => {
    const blob = {
      id: 'blob-1',
      mountPointId: MOUNT_ID,
      relativePath: 'docs/report.pdf',
      sizeBytes: 54321,
      sha256: 'b'.repeat(64),
      extractedText: 'Extracted body text from the PDF',
      extractedTextSha256: 'c'.repeat(64),
      extractionStatus: 'converted',
      updatedAt: '2026-04-18T00:00:00.000Z',
    };
    repos.docMountBlobs.findByMountPointAndPath.mockResolvedValue(blob);

    // After create, the file record exists for the chunk-insert lookup.
    const fileRecord = {
      id: 'file-1',
      mountPointId: MOUNT_ID,
      relativePath: 'docs/report.pdf',
      fileName: 'report.pdf',
      fileType: 'pdf',
      sha256: blob.sha256,
      fileSizeBytes: blob.sizeBytes,
    };
    repos.docMountFiles.findByMountPointAndPath.mockImplementation(async () => {
      // First call (before create): no record. Subsequent calls: return it.
      if (repos.docMountFiles.create.mock.calls.length === 0) return null;
      return fileRecord;
    });

    await reindexSingleFile(MOUNT_ID, 'docs/report.pdf', '');

    // A new file-mirror row should be created using the blob's sha256 and
    // sizeBytes — NOT the length of the extracted text.
    expect(repos.docMountFiles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mountPointId: MOUNT_ID,
        relativePath: 'docs/report.pdf',
        fileType: 'pdf',
        sha256: blob.sha256,
        fileSizeBytes: blob.sizeBytes,
        source: 'database',
        conversionStatus: 'converted',
        plainTextLength: blob.extractedText.length,
        chunkCount: 1,
      })
    );

    // Chunks were written for the extracted text.
    expect(repos.docMountChunks.bulkInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          mountPointId: MOUNT_ID,
          fileId: 'file-1',
          content: 'Hello chunk',
        }),
      ])
    );
  });

  it('skips reindex when blob has no extractedText', async () => {
    repos.docMountBlobs.findByMountPointAndPath.mockResolvedValue({
      id: 'blob-2',
      mountPointId: MOUNT_ID,
      relativePath: 'binaries/mystery.bin',
      sizeBytes: 100,
      sha256: 'd'.repeat(64),
      extractedText: null,
      extractionStatus: 'none',
      updatedAt: '2026-04-18T00:00:00.000Z',
    });

    await reindexSingleFile(MOUNT_ID, 'binaries/mystery.bin', '');

    expect(repos.docMountFiles.create).not.toHaveBeenCalled();
    expect(repos.docMountFiles.update).not.toHaveBeenCalled();
    expect(repos.docMountChunks.bulkInsert).not.toHaveBeenCalled();
  });

  it('prefers doc_mount_documents over blob when both exist', async () => {
    repos.docMountDocuments.findByMountPointAndPath.mockResolvedValue({
      id: 'doc-1',
      mountPointId: MOUNT_ID,
      relativePath: 'notes.md',
      content: 'native text content',
      contentSha256: 'e'.repeat(64),
      lastModified: '2026-04-18T00:00:00.000Z',
    });
    // A stray blob at the same path: reindex should never consult it.
    repos.docMountBlobs.findByMountPointAndPath.mockResolvedValue({
      id: 'blob-ghost',
      sha256: 'f'.repeat(64),
      sizeBytes: 999,
      extractedText: 'should not be used',
      extractionStatus: 'converted',
      updatedAt: '2026-04-18T00:00:00.000Z',
    });

    repos.docMountFiles.findByMountPointAndPath.mockImplementation(async () => {
      if (repos.docMountFiles.create.mock.calls.length === 0) return null;
      return { id: 'file-md', mountPointId: MOUNT_ID, relativePath: 'notes.md' };
    });

    await reindexSingleFile(MOUNT_ID, 'notes.md', '');

    expect(repos.docMountBlobs.findByMountPointAndPath).not.toHaveBeenCalled();
    expect(repos.docMountFiles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sha256: 'e'.repeat(64),
      })
    );
  });
});
