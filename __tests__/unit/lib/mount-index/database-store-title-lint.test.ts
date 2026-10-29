/**
 * The database store calls the Inventory title lint before it writes,
 * deletes or moves an `Inventory/` or `Tools/` file, and writes the lint's
 * rows only once the change has landed. A refusal leaves the store untouched;
 * any other path never loads the lint.
 *
 * Strategy: mock getRepositories() and the lint module; no real database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('@/lib/logger', () => ({
  logger: { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));
jest.mock('@/lib/mount-index/post-write-reindex', () => ({ reindexAfterDatabaseWrite: jest.fn(async () => undefined) }));
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn(async () => 'folder-1') }));
jest.mock('@/lib/inventory/title-lint-documents', () => ({ lintInventoryDocumentChange: jest.fn() }));
jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const lintMock = jest.requireMock('@/lib/inventory/title-lint-documents').lintInventoryDocumentChange as jest.Mock;

import { deleteDatabaseDocument, moveDatabaseDocument, writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { withInventoryWritesLinted } from '@/lib/inventory/lint-scope';

const MOUNT = 'mp-1';
const order: string[] = [];
const linkDocumentContent = jest.fn(async () => {
  order.push('write');
});
const deleteWithGC = jest.fn(async () => {
  order.push('delete');
});
const updateLink = jest.fn(async () => {
  order.push('move');
});

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  lintMock.mockImplementation(async () => {
    order.push('lint');
    return () => order.push('rows');
  });
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(async (_mp: string, path: string) => (path.startsWith('Inventory/old') ? { content: '{}' } : null)),
    },
    docMountFileLinks: {
      linkDocumentContent,
      findByMountPointAndPath: jest.fn(async () => ({ id: 'link-1', fileId: 'file-1', fileType: 'json' })),
      deleteWithGC,
      update: updateLink,
    },
    docMountFiles: { update: jest.fn() },
  });
});

describe('the store and the title lint', () => {
  it('lints an Inventory write before it lands and writes the rows after', async () => {
    await writeDatabaseDocument(MOUNT, 'Inventory/tape.json', '{}');
    expect(lintMock).toHaveBeenCalledWith({ kind: 'write', mountPointId: MOUNT, relativePath: 'Inventory/tape.json', content: '{}' });
    expect(order).toEqual(['lint', 'write', 'rows']);
  });

  it('a refusal leaves the store untouched', async () => {
    lintMock.mockRejectedValueOnce(new Error('title rejected: "Ruler"'));
    await expect(writeDatabaseDocument(MOUNT, 'Inventory/tape.json', '{}')).rejects.toThrow('title rejected');
    expect(linkDocumentContent).not.toHaveBeenCalled();
  });

  it('lints deletes and moves the same way', async () => {
    await deleteDatabaseDocument(MOUNT, 'Inventory/tape.json');
    expect(order).toEqual(['lint', 'delete', 'rows']);
    order.length = 0;
    await moveDatabaseDocument(MOUNT, 'Inventory/old.json', 'Attic/old.json');
    expect(lintMock).toHaveBeenLastCalledWith({ kind: 'move', mountPointId: MOUNT, fromPath: 'Inventory/old.json', toPath: 'Attic/old.json' });
    expect(order).toEqual(['lint', 'move', 'rows']);
  });

  it('never loads the lint for any other path, or for the Inventory mutations’ own writes', async () => {
    await writeDatabaseDocument(MOUNT, 'metadata.json', '{}');
    await withInventoryWritesLinted(() => writeDatabaseDocument(MOUNT, 'Inventory/tape.json', '{}'));
    expect(lintMock).not.toHaveBeenCalled();
    expect(linkDocumentContent).toHaveBeenCalledTimes(2);
  });
});
