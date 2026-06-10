/**
 * Unit tests for the canonical write/ingest pipeline (lib/mount-index/store-file.ts).
 *
 * Covers: native-text → document routing, binary → blob routing with transcode,
 * PDF text extraction, filesystem-mount writes, collision strategies
 * (error-if-exists / overwrite / unique-suffix), treatNativeTextAsDocument,
 * and the transcodeImages toggle.
 *
 * Strategy: mock getRepositories() and every collaborator (transcode, converter,
 * folder-ensure, reindex, fs writer). No real database or filesystem.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn((p: string, mime: string) =>
    mime === 'image/webp' && !p.toLowerCase().endsWith('.webp')
      ? p.replace(/\.[^./]+$/, '.webp')
      : p
  ),
}));
jest.mock('@/lib/mount-index/converters', () => ({ convertBufferToPlainText: jest.fn() }));
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn().mockResolvedValue('folder-1') }));
jest.mock('@/lib/mount-index/db-store-events', () => ({ emitDocumentWritten: jest.fn() }));
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  databaseDocumentExists: jest.fn().mockResolvedValue(false),
  // file-op-status.ts (transitively imported nowhere here) would need this, but
  // store-file only imports the two functions above.
  DatabaseStoreError: class DatabaseStoreError extends Error {},
}));
jest.mock('@/lib/doc-edit/reindex-file', () => ({ reindexSingleFile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(0),
}));
jest.mock('@/lib/file-storage/bridge-path-helpers', () => ({
  resolveUniqueRelativePath: jest.fn(),
}));
jest.mock('@/lib/mount-index/file-ops', () => ({
  destExists: jest.fn().mockResolvedValue(false),
  deleteAtDest: jest.fn().mockResolvedValue(undefined),
  writeFsFileBytes: jest.fn(),
}));

import { storeMountFile } from '@/lib/mount-index/store-file';
import { FileOpError } from '@/lib/mount-index/file-op-error';
import { transcodeToWebP } from '@/lib/mount-index/blob-transcode';
import { convertBufferToPlainText } from '@/lib/mount-index/converters';
import { writeDatabaseDocument, databaseDocumentExists } from '@/lib/mount-index/database-store';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';
import { destExists, deleteAtDest, writeFsFileBytes } from '@/lib/mount-index/file-ops';

const MOUNT_ID = 'mount-1';
const transcodeMock = transcodeToWebP as jest.Mock;
const convertMock = convertBufferToPlainText as jest.Mock;
const writeDocMock = writeDatabaseDocument as jest.Mock;
const dbDocExistsMock = databaseDocumentExists as jest.Mock;
const uniquePathMock = resolveUniqueRelativePath as jest.Mock;
const destExistsMock = destExists as jest.Mock;
const deleteAtDestMock = deleteAtDest as jest.Mock;
const writeFsMock = writeFsFileBytes as jest.Mock;

let repos: any;

function makeMount(mountType: 'database' | 'filesystem') {
  return { id: MOUNT_ID, name: 'Test Mount', mountType, basePath: mountType === 'filesystem' ? '/tmp/mnt' : '' };
}

beforeEach(() => {
  jest.clearAllMocks();
  dbDocExistsMock.mockResolvedValue(false);
  destExistsMock.mockResolvedValue(false);

  repos = {
    docMountPoints: {
      findById: jest.fn().mockResolvedValue(makeMount('database')),
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
    docMountFileLinks: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      linkBlobContent: jest.fn().mockResolvedValue({
        link: { id: 'link-1', fileId: 'file-1' },
        file: { id: 'file-1' },
        blobId: 'blob-1',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    docMountChunks: { deleteByLinkId: jest.fn().mockResolvedValue(undefined) },
    docMountBlobs: {
      updateExtractedText: jest.fn().mockResolvedValue(null),
      findByMountPointAndPath: jest.fn().mockResolvedValue({ id: 'blob-1' }),
    },
  };
  getRepositoriesMock.mockReturnValue(repos);
});

describe('storeMountFile — native-text documents', () => {
  it('routes .md on a database mount to writeDatabaseDocument', async () => {
    writeDocMock.mockResolvedValue({ mtime: 1700000000000 });
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue({
      id: 'link-1', fileId: 'file-1', sha256: 'abc',
    });

    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'notes/intro.md',
      data: Buffer.from('# hello', 'utf-8'),
      enqueueEmbedding: false,
    });

    expect(writeDocMock).toHaveBeenCalledWith(MOUNT_ID, 'notes/intro.md', '# hello', undefined);
    expect(transcodeMock).not.toHaveBeenCalled();
    expect(result.kind).toBe('document');
    expect(result.fileType).toBe('markdown');
    expect(result.mtime).toBe(1700000000000);
    expect(result.fileId).toBe('file-1');
  });

  it('passes expectedMtime through for optimistic concurrency', async () => {
    writeDocMock.mockResolvedValue({ mtime: 2 });
    await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'a.txt',
      data: Buffer.from('x'),
      expectedMtime: 999,
      enqueueEmbedding: false,
    });
    expect(writeDocMock).toHaveBeenCalledWith(MOUNT_ID, 'a.txt', 'x', 999);
  });

  it('throws DEST_EXISTS (error-if-exists) when the document already exists and no force', async () => {
    dbDocExistsMock.mockResolvedValue(true);
    await expect(
      storeMountFile({ mountPointId: MOUNT_ID, relativePath: 'a.md', data: Buffer.from('x') })
    ).rejects.toMatchObject({ code: 'DEST_EXISTS' });
    expect(writeDocMock).not.toHaveBeenCalled();
  });

  it('with treatNativeTextAsDocument=false stores native text as a blob', async () => {
    transcodeMock.mockResolvedValue({ data: Buffer.from('x'), storedMimeType: 'text/plain', sizeBytes: 1, sha256: 'sha-x' });
    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'notes/a.txt',
      data: Buffer.from('x'),
      treatNativeTextAsDocument: false,
      collisionStrategy: 'overwrite',
      enqueueEmbedding: false,
    });
    expect(writeDocMock).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalled();
    expect(result.kind).toBe('blob');
  });
});

describe('storeMountFile — binary blobs', () => {
  it('transcodes an image and links blob content, rewriting the extension to .webp', async () => {
    transcodeMock.mockResolvedValue({
      data: Buffer.from('webp-bytes'), storedMimeType: 'image/webp', sizeBytes: 10, sha256: 'sha-webp',
    });
    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'images/portrait.png',
      data: Buffer.from('png-bytes'),
      originalMimeType: 'image/png',
      collisionStrategy: 'overwrite',
      enqueueEmbedding: false,
    });
    expect(transcodeMock).toHaveBeenCalledWith(Buffer.from('png-bytes'), 'image/png');
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'images/portrait.webp', storedMimeType: 'image/webp' })
    );
    expect(result.kind).toBe('blob');
    expect(result.blobId).toBe('blob-1');
    expect(result.relativePath).toBe('images/portrait.webp');
  });

  it('transcodeImages=false stores bytes verbatim', async () => {
    await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'data/raw.bin',
      data: Buffer.from('rawbytes'),
      originalMimeType: 'application/octet-stream',
      transcodeImages: false,
      collisionStrategy: 'overwrite',
      enqueueEmbedding: false,
    });
    expect(transcodeMock).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({ data: Buffer.from('rawbytes') })
    );
  });

  it('extracts text from a PDF and marks the link converted', async () => {
    transcodeMock.mockResolvedValue({
      data: Buffer.from('%PDF'), storedMimeType: 'application/pdf', sizeBytes: 4, sha256: 'sha-pdf',
    });
    convertMock.mockResolvedValue('extracted pdf text');
    await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'docs/report.pdf',
      data: Buffer.from('%PDF'),
      originalMimeType: 'application/pdf',
      collisionStrategy: 'overwrite',
      enqueueEmbedding: false,
    });
    expect(convertMock).toHaveBeenCalledWith(Buffer.from('%PDF'), 'pdf');
    expect(repos.docMountBlobs.updateExtractedText).toHaveBeenCalledWith(
      'blob-1',
      expect.objectContaining({ extractionStatus: 'converted', extractedText: 'extracted pdf text' }),
      'link-1'
    );
  });

  it('uses a unique suffix path under the unique-suffix strategy', async () => {
    transcodeMock.mockResolvedValue({ data: Buffer.from('b'), storedMimeType: 'image/webp', sizeBytes: 1, sha256: 's' });
    uniquePathMock.mockResolvedValue('images/portrait (2).webp');
    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'images/portrait.webp',
      data: Buffer.from('b'),
      originalMimeType: 'image/webp',
      collisionStrategy: 'unique-suffix',
      enqueueEmbedding: false,
    });
    expect(uniquePathMock).toHaveBeenCalledWith(MOUNT_ID, 'images/portrait.webp');
    expect(result.relativePath).toBe('images/portrait (2).webp');
  });
});

describe('storeMountFile — filesystem mounts', () => {
  it('writes bytes to disk via writeFsFileBytes (auto storage)', async () => {
    repos.docMountPoints.findById.mockResolvedValue(makeMount('filesystem'));
    writeFsMock.mockResolvedValue({ sha256: 'sha-fs', sizeBytes: 7, mtime: 123 });
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue({ id: 'l', fileId: 'f', fileType: 'txt' });

    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'notes/a.txt',
      data: Buffer.from('content'),
    });
    expect(writeFsMock).toHaveBeenCalledWith(expect.objectContaining({ id: MOUNT_ID }), 'notes/a.txt', Buffer.from('content'));
    expect(writeDocMock).not.toHaveBeenCalled();
    expect(result.kind).toBe('filesystem');
    expect(result.sha256).toBe('sha-fs');
    expect(result.mtime).toBe(123);
  });

  it('assetStorage=database keeps a filesystem-mount upload in the DB blob table', async () => {
    repos.docMountPoints.findById.mockResolvedValue(makeMount('filesystem'));
    transcodeMock.mockResolvedValue({ data: Buffer.from('b'), storedMimeType: 'image/webp', sizeBytes: 1, sha256: 's' });
    const result = await storeMountFile({
      mountPointId: MOUNT_ID,
      relativePath: 'images/p.png',
      data: Buffer.from('b'),
      originalMimeType: 'image/png',
      assetStorage: 'database',
      collisionStrategy: 'overwrite',
      enqueueEmbedding: false,
    });
    expect(writeFsMock).not.toHaveBeenCalled();
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalled();
    expect(result.kind).toBe('blob');
  });

  it('error-if-exists on a filesystem mount throws when dest exists and no force', async () => {
    repos.docMountPoints.findById.mockResolvedValue(makeMount('filesystem'));
    destExistsMock.mockResolvedValue(true);
    await expect(
      storeMountFile({ mountPointId: MOUNT_ID, relativePath: 'a.txt', data: Buffer.from('x') })
    ).rejects.toBeInstanceOf(FileOpError);
    expect(writeFsMock).not.toHaveBeenCalled();
  });

  it('error-if-exists + force deletes then writes', async () => {
    repos.docMountPoints.findById.mockResolvedValue(makeMount('filesystem'));
    destExistsMock.mockResolvedValue(true);
    writeFsMock.mockResolvedValue({ sha256: 's', sizeBytes: 1, mtime: 1 });
    await storeMountFile({ mountPointId: MOUNT_ID, relativePath: 'a.txt', data: Buffer.from('x'), force: true });
    expect(deleteAtDestMock).toHaveBeenCalled();
    expect(writeFsMock).toHaveBeenCalled();
  });
});

describe('storeMountFile — guards', () => {
  it('throws MOUNT_NOT_FOUND for an unknown mount', async () => {
    repos.docMountPoints.findById.mockResolvedValue(null);
    await expect(
      storeMountFile({ mountPointId: 'nope', relativePath: 'a.md', data: Buffer.from('x') })
    ).rejects.toMatchObject({ code: 'MOUNT_NOT_FOUND' });
  });

  it('rejects path traversal', async () => {
    await expect(
      storeMountFile({ mountPointId: MOUNT_ID, relativePath: '../escape.md', data: Buffer.from('x') })
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
