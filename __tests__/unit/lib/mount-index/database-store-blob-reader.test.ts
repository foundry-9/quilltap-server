/**
 * #134 — one reader for an uploaded blob where a document was expected.
 *
 * Document Mode read a native-text upload's raw bytes; `doc_read_file` read
 * the blob's `extractedText`. `readDatabaseBlobForDocument` is now the one
 * reader both use: raw bytes for a native-text kind, the converted text for
 * any other kind.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { logger };
});
jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));
jest.mock('@/lib/doc-edit/reindex-file', () => ({ reindexSingleFile: jest.fn() }));
jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

import { readDatabaseBlobForDocument } from '@/lib/mount-index/database-store';

const T = '2026-11-01T00:00:00.000Z';

function blob(fields: Record<string, unknown>) {
  return {
    id: 'blob-1',
    sizeBytes: 12,
    storedMimeType: 'text/markdown',
    lastModified: T,
    updatedAt: T,
    extractionStatus: 'converted',
    extractedText: 'EXTRACTED',
    ...fields,
  };
}

let findBlob: jest.Mock;
let readData: jest.Mock;

beforeEach(() => {
  findBlob = jest.fn();
  readData = jest.fn();
  getRepositoriesMock.mockReturnValue({
    docMountBlobs: { findByMountPointAndPath: findBlob, readData },
  });
});

describe('readDatabaseBlobForDocument', () => {
  it('reads a native-text upload as its own bytes', async () => {
    findBlob.mockResolvedValue(blob({}));
    readData.mockResolvedValue(Buffer.from('# The bytes', 'utf-8'));

    const read = await readDatabaseBlobForDocument('mp-1', 'notes.md');

    expect(read).toMatchObject({ content: '# The bytes', source: 'blob-bytes' });
  });

  it('reads a converted kind as its extracted text', async () => {
    findBlob.mockResolvedValue(blob({ storedMimeType: 'application/pdf' }));

    const read = await readDatabaseBlobForDocument('mp-1', 'scan.pdf');

    expect(read).toMatchObject({ content: 'EXTRACTED', source: 'blob-text', storedMimeType: 'application/pdf' });
    expect(readData).not.toHaveBeenCalled();
  });

  it('is null when there is no blob', async () => {
    findBlob.mockResolvedValue(null);

    await expect(readDatabaseBlobForDocument('mp-1', 'missing.md')).resolves.toBeNull();
  });

  it('is null for an unconverted blob of a converted kind', async () => {
    findBlob.mockResolvedValue(blob({ storedMimeType: 'application/pdf', extractionStatus: 'pending', extractedText: null }));

    await expect(readDatabaseBlobForDocument('mp-1', 'scan.pdf')).resolves.toBeNull();
  });
});
