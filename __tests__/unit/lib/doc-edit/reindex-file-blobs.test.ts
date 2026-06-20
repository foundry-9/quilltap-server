/**
 * Unit tests for reindexSingleFile's blob-extractedText branch.
 *
 * When a database-backed document store holds a pdf/docx file, its bytes live
 * in doc_mount_blobs (not doc_mount_documents) and its plain-text representation
 * lives in doc_mount_blobs.extractedText. reindexSingleFile must chunk that
 * extracted text — but, crucially, it must NOT re-create the file row via
 * linkFilesystemFile. That helper keys a file row by (sha256, source) and forks
 * a fresh, content-less row when none matches, repointing the link to it and
 * severing the document from its doc_mount_documents / doc_mount_blobs content
 * (the "lists but won't open" orphan). For database-backed stores the file row +
 * link already exist (written by the content writer), so reindex only refreshes
 * chunk metadata on the existing link in place.
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
const EXISTING_LINK_ID = 'link-existing';

interface Repos {
  docMountPoints: { findById: jest.Mock };
  docMountDocuments: { findByMountPointAndPath: jest.Mock };
  docMountBlobs: { findByMountPointAndPath: jest.Mock };
  docMountFiles: {
    findByMountPointAndPath: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  docMountFileLinks: {
    findByMountPointAndPath: jest.Mock;
    linkFilesystemFile: jest.Mock;
    update: jest.Mock;
  };
  docMountChunks: {
    deleteByFileId: jest.Mock;
    deleteByLinkId: jest.Mock;
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
    docMountFileLinks: {
      // The content writer (linkDocumentContent / linkBlobContent) always creates
      // the link before reindex runs, so the link lookup resolves by default.
      findByMountPointAndPath: jest.fn().mockResolvedValue({
        id: EXISTING_LINK_ID,
        fileId: 'file-existing',
        mountPointId: MOUNT_ID,
      }),
      linkFilesystemFile: jest.fn().mockImplementation(async (input) => ({
        id: 'link-mock',
        fileId: 'file-mock',
        ...input,
      })),
      update: jest.fn().mockResolvedValue(undefined),
    },
    docMountChunks: {
      deleteByFileId: jest.fn().mockResolvedValue(undefined),
      deleteByLinkId: jest.fn().mockResolvedValue(undefined),
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

  it('chunks extractedText from doc_mount_blobs and refreshes the existing link in place', async () => {
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

    await reindexSingleFile(MOUNT_ID, 'docs/report.pdf', '');

    // Regression guard: reindex must NOT re-create the file row for a
    // database-backed store — that is what orphaned the document from its
    // content row ("lists but won't open").
    expect(repos.docMountFileLinks.linkFilesystemFile).not.toHaveBeenCalled();

    // Chunk metadata is refreshed on the existing link in place.
    expect(repos.docMountChunks.deleteByLinkId).toHaveBeenCalledWith(EXISTING_LINK_ID);
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      EXISTING_LINK_ID,
      expect.objectContaining({
        conversionStatus: 'converted',
        plainTextLength: blob.extractedText.length,
        chunkCount: 1,
        lastModified: blob.updatedAt,
      })
    );

    // Chunks were written for the extracted text, keyed by the existing link id.
    expect(repos.docMountChunks.bulkInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          mountPointId: MOUNT_ID,
          linkId: EXISTING_LINK_ID,
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

    expect(repos.docMountFileLinks.linkFilesystemFile).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.update).not.toHaveBeenCalled();
    expect(repos.docMountChunks.bulkInsert).not.toHaveBeenCalled();
  });

  it('skips reindex (and never forks a file row) when the link is missing', async () => {
    // No link yet — reindex must bail rather than fabricate a content-less
    // file row, which is exactly the orphan this branch guards against.
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue(null);
    repos.docMountDocuments.findByMountPointAndPath.mockResolvedValue({
      id: 'doc-9',
      mountPointId: MOUNT_ID,
      relativePath: 'orphan.md',
      content: 'content with no link',
      contentSha256: 'a'.repeat(64),
      lastModified: '2026-04-18T00:00:00.000Z',
    });

    await reindexSingleFile(MOUNT_ID, 'orphan.md', '');

    expect(repos.docMountFileLinks.linkFilesystemFile).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.update).not.toHaveBeenCalled();
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

    await reindexSingleFile(MOUNT_ID, 'notes.md', '');

    expect(repos.docMountBlobs.findByMountPointAndPath).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.linkFilesystemFile).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.update).toHaveBeenCalledWith(
      EXISTING_LINK_ID,
      expect.objectContaining({
        plainTextLength: 'native text content'.length,
        chunkCount: 1,
      })
    );
  });
});
