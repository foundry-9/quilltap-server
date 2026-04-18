/**
 * Unit tests for folder operations in lib/mount-index/database-store.ts
 *
 * Tests cover:
 * - createDatabaseFolder: idempotent folder creation
 * - deleteDatabaseFolder: empty folder deletion with NOT_EMPTY errors
 * - moveDatabaseFolder: folder relocation with descendant path updates
 * - writeDatabaseDocument: auto-creates parent folders
 * - backfillFolderRowsForMountPoint: creates folders from existing documents/files
 *
 * Strategy: Mock getRepositories() to control folder/document/file state.
 * Track event emissions via mock. No real database or filesystem.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Mock logger
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
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

// Mock event emitters
jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));

// Mock getRepositories - must be declared before usage
jest.mock('@/lib/repositories/factory');
const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

import {
  createDatabaseFolder,
  deleteDatabaseFolder,
  moveDatabaseFolder,
  writeDatabaseDocument,
  backfillFolderRowsForMountPoint,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import {
  emitDocumentWritten,
  emitDocumentMoved,
} from '@/lib/mount-index/db-store-events';

const MOUNT_ID = 'mount-001';

interface MockRepos {
  docMountFolders: {
    findByMountPointAndPath: jest.Mock;
    findChildren: jest.Mock;
    findByMountPointId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  docMountDocuments: {
    findByMountPointAndPath: jest.Mock;
    findByMountPointId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  docMountFiles: {
    findByMountPointAndPath: jest.Mock;
    findByMountPointId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  docMountChunks: {
    deleteByFileId: jest.Mock;
  };
  docMountBlobs: {
    listByMountPoint: jest.Mock;
    updatePath: jest.Mock;
  };
}

function createMockRepos(): MockRepos {
  return {
    docMountFolders: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findChildren: jest.fn().mockResolvedValue([]),
      findByMountPointId: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findByMountPointId: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    docMountFiles: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findByMountPointId: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    docMountChunks: {
      deleteByFileId: jest.fn(),
    },
    docMountBlobs: {
      listByMountPoint: jest.fn().mockResolvedValue([]),
      updatePath: jest.fn().mockResolvedValue(true),
    },
  };
}

describe('database-store folder operations', () => {
  let repos: MockRepos;

  beforeEach(() => {
    jest.clearAllMocks();
    repos = createMockRepos();
    getRepositoriesMock.mockReturnValue(repos);
  });

  // =========================================================================
  // createDatabaseFolder
  // =========================================================================

  describe('createDatabaseFolder', () => {
    it('creates a folder with nested path', async () => {
      let folderCounter = 0;

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);

      repos.docMountFolders.create.mockImplementation(async (data) => {
        folderCounter++;
        return {
          id: `folder-${folderCounter}`,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      const result = await createDatabaseFolder(MOUNT_ID, 'a/b/c');

      expect(result.path).toBe('a/b/c');
      expect(result.folderId).toBeDefined();
      expect(repos.docMountFolders.create).toHaveBeenCalledTimes(3);
    });

    it('is idempotent on repeated calls', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'a/b',
        mountPointId: MOUNT_ID,
        parentId: 'folder-a',
        name: 'b',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);

      const result1 = await createDatabaseFolder(MOUNT_ID, 'a/b');
      const result2 = await createDatabaseFolder(MOUNT_ID, 'a/b');

      expect(result1.path).toBe('a/b');
      expect(result2.path).toBe('a/b');
      expect(repos.docMountFolders.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deleteDatabaseFolder
  // =========================================================================

  describe('deleteDatabaseFolder', () => {
    it('deletes an empty folder', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'temp',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'temp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountFolders.delete.mockResolvedValue(true);

      const result = await deleteDatabaseFolder(MOUNT_ID, 'temp');

      expect(result.deleted).toBe(true);
      expect(repos.docMountFolders.delete).toHaveBeenCalledWith('folder-001');
    });

    it('rejects deletion of non-empty folder', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'data',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'data',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const childFolder = {
        id: 'folder-002',
        path: 'data/subdir',
        mountPointId: MOUNT_ID,
        parentId: 'folder-001',
        name: 'subdir',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);
      repos.docMountFolders.findChildren.mockResolvedValue([childFolder]);

      const error = await deleteDatabaseFolder(MOUNT_ID, 'data').catch(e => e);
      expect(error).toBeInstanceOf(DatabaseStoreError);
      expect(error.code).toBe('NOT_EMPTY');
      expect(repos.docMountFolders.delete).not.toHaveBeenCalled();
    });

    it('rejects deletion when folder contains documents', async () => {
      const mockFolder = {
        id: 'folder-001',
        path: 'data',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'data',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(mockFolder);
      repos.docMountFolders.findChildren.mockResolvedValue([]);
      repos.docMountDocuments.findByMountPointId.mockResolvedValue([
        {
          id: 'doc-001',
          folderId: 'folder-001',
          relativePath: 'data/note.md',
          mountPointId: MOUNT_ID,
          content: 'test',
          contentSha256: 'abc',
          plainTextLength: 4,
          lastModified: new Date().toISOString(),
          fileName: 'note.md',
          fileType: 'markdown',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);

      const error = await deleteDatabaseFolder(MOUNT_ID, 'data').catch(e => e);
      expect(error).toBeInstanceOf(DatabaseStoreError);
      expect(error.code).toBe('NOT_EMPTY');
    });

    it('throws NOT_FOUND when folder does not exist', async () => {
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);

      await expect(deleteDatabaseFolder(MOUNT_ID, 'missing')).rejects.toThrow(
        /Folder not found/
      );
    });
  });

  // =========================================================================
  // moveDatabaseFolder
  // =========================================================================

  describe('moveDatabaseFolder', () => {
    it('moves a folder and updates descendant paths', async () => {
      const sourceFolder = {
        id: 'folder-a',
        path: 'old',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'old',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const destParentFolder = {
        id: 'folder-parent',
        path: 'parent',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'parent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const descendantFolder = {
        id: 'folder-desc',
        path: 'old/subdir',
        mountPointId: MOUNT_ID,
        parentId: 'folder-a',
        name: 'subdir',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(
        async (mpId, path) => {
          if (path === 'old') return sourceFolder;
          if (path === 'parent') return destParentFolder;
          if (path === 'new') return null;
          return null;
        }
      );

      repos.docMountFolders.findByMountPointId.mockResolvedValue([
        sourceFolder,
        descendantFolder,
      ]);

      repos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountBlobs.listByMountPoint.mockResolvedValue([]);

      await moveDatabaseFolder(MOUNT_ID, 'old', 'parent/new');

      // Verify source folder was updated
      expect(repos.docMountFolders.update).toHaveBeenCalledWith(
        'folder-a',
        expect.objectContaining({
          name: 'new',
          path: 'parent/new',
        })
      );

      // Verify descendant path was updated
      expect(repos.docMountFolders.update).toHaveBeenCalledWith(
        'folder-desc',
        expect.objectContaining({
          path: 'parent/new/subdir',
        })
      );
    });

    it('updates document paths when folder is moved', async () => {
      const sourceFolder = {
        id: 'folder-src',
        path: 'old',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'old',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const document = {
        id: 'doc-001',
        folderId: 'folder-src',
        relativePath: 'old/note.md',
        mountPointId: MOUNT_ID,
        content: 'test',
        contentSha256: 'abc',
        plainTextLength: 4,
        lastModified: new Date().toISOString(),
        fileName: 'note.md',
        fileType: 'markdown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(
        async (mpId, path) => {
          if (path === 'old') return sourceFolder;
          if (path === 'new') return null;
          return null;
        }
      );

      repos.docMountFolders.findByMountPointId.mockResolvedValue([sourceFolder]);
      repos.docMountDocuments.findByMountPointId.mockResolvedValue([document]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountBlobs.listByMountPoint.mockResolvedValue([]);

      await moveDatabaseFolder(MOUNT_ID, 'old', 'new');

      // Verify document was updated
      expect(repos.docMountDocuments.update).toHaveBeenCalledWith(
        'doc-001',
        expect.objectContaining({
          relativePath: 'new/note.md',
          folderId: null,
        })
      );

      // Verify event was emitted
      expect(emitDocumentMoved).toHaveBeenCalledWith(
        expect.objectContaining({
          mountPointId: MOUNT_ID,
          fromRelativePath: 'old/note.md',
          toRelativePath: 'new/note.md',
        })
      );
    });

    it('renames contained blob paths when folder is moved', async () => {
      const sourceFolder = {
        id: 'folder-src',
        path: 'uploads',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'uploads',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const blob = {
        id: 'blob-001',
        mountPointId: MOUNT_ID,
        relativePath: 'uploads/portrait.webp',
        originalFileName: 'portrait.png',
        originalMimeType: 'image/png',
        storedMimeType: 'image/webp',
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
        description: '',
        descriptionUpdatedAt: null,
        extractedText: null,
        extractedTextSha256: null,
        extractionStatus: 'none' as const,
        extractionError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(
        async (_mpId, folderPath) => {
          if (folderPath === 'uploads') return sourceFolder;
          if (folderPath === 'archive') return null;
          return null;
        }
      );

      repos.docMountFolders.findByMountPointId.mockResolvedValue([sourceFolder]);
      repos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountBlobs.listByMountPoint.mockResolvedValue([blob]);

      await moveDatabaseFolder(MOUNT_ID, 'uploads', 'archive');

      expect(repos.docMountBlobs.updatePath).toHaveBeenCalledWith(
        'blob-001',
        'archive/portrait.webp'
      );
    });

    it('rejects move with CONFLICT when destination exists', async () => {
      const sourceFolder = {
        id: 'folder-src',
        path: 'src',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'src',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const destFolder = {
        id: 'folder-dest',
        path: 'dest',
        mountPointId: MOUNT_ID,
        parentId: null,
        name: 'dest',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountFolders.findByMountPointAndPath.mockImplementation(
        async (mpId, path) => {
          if (path === 'src') return sourceFolder;
          if (path === 'dest') return destFolder;
          return null;
        }
      );

      await expect(moveDatabaseFolder(MOUNT_ID, 'src', 'dest')).rejects.toThrow(
        DatabaseStoreError
      );
    });

    it('throws NOT_FOUND when source folder does not exist', async () => {
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);

      await expect(moveDatabaseFolder(MOUNT_ID, 'missing', 'new')).rejects.toThrow(
        /Source folder not found/
      );
    });
  });

  // =========================================================================
  // writeDatabaseDocument (folder auto-creation)
  // =========================================================================

  describe('writeDatabaseDocument', () => {
    it('auto-creates parent folders when writing', async () => {
      repos.docMountDocuments.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountFiles.findByMountPointAndPath.mockResolvedValue(null);

      let folderCreateCount = 0;
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountFolders.create.mockImplementation(async (data) => {
        folderCreateCount++;
        return {
          id: `folder-${folderCreateCount}`,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      repos.docMountDocuments.create.mockResolvedValue(undefined);
      repos.docMountFiles.create.mockResolvedValue(undefined);

      await writeDatabaseDocument(MOUNT_ID, 'a/b/note.md', 'hello');

      // Should have created 'a' and 'a/b' folders
      expect(repos.docMountFolders.create).toHaveBeenCalledTimes(2);

      // Should have created the document
      expect(repos.docMountDocuments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          relativePath: 'a/b/note.md',
          folderId: 'folder-2',
        })
      );
    });

    it('sets folderId to null for root-level documents', async () => {
      repos.docMountDocuments.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountFiles.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountDocuments.create.mockResolvedValue(undefined);
      repos.docMountFiles.create.mockResolvedValue(undefined);

      await writeDatabaseDocument(MOUNT_ID, 'note.md', 'hello');

      expect(repos.docMountDocuments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          relativePath: 'note.md',
          folderId: null,
        })
      );
    });
  });

  // =========================================================================
  // backfillFolderRowsForMountPoint
  // =========================================================================

  describe('backfillFolderRowsForMountPoint', () => {
    it('creates folder rows from existing documents', async () => {
      const document = {
        id: 'doc-001',
        folderId: null,
        relativePath: 'a/b/note.md',
        mountPointId: MOUNT_ID,
        content: 'test',
        contentSha256: 'abc',
        plainTextLength: 4,
        lastModified: new Date().toISOString(),
        fileName: 'note.md',
        fileType: 'markdown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      repos.docMountDocuments.findByMountPointId.mockResolvedValue([document]);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountBlobs.listByMountPoint.mockResolvedValue([]);

      let folderCreateCount = 0;
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountFolders.create.mockImplementation(async (data) => {
        folderCreateCount++;
        return {
          id: `folder-${folderCreateCount}`,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      const result = await backfillFolderRowsForMountPoint(MOUNT_ID);

      expect(result.foldersCreated).toBeGreaterThan(0);
      expect(result.filesUpdated).toBe(1);
      expect(repos.docMountDocuments.update).toHaveBeenCalledWith(
        'doc-001',
        expect.objectContaining({
          folderId: expect.any(String),
        })
      );
    });

    it('creates multiple folder levels for nested documents', async () => {
      const docs = [
        {
          id: 'doc-1',
          folderId: null,
          relativePath: 'x/y/z/file1.md',
          mountPointId: MOUNT_ID,
          content: 'test',
          contentSha256: 'abc',
          plainTextLength: 4,
          lastModified: new Date().toISOString(),
          fileName: 'file1.md',
          fileType: 'markdown',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'doc-2',
          folderId: null,
          relativePath: 'x/y/file2.md',
          mountPointId: MOUNT_ID,
          content: 'test',
          contentSha256: 'def',
          plainTextLength: 4,
          lastModified: new Date().toISOString(),
          fileName: 'file2.md',
          fileType: 'markdown',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      repos.docMountDocuments.findByMountPointId.mockResolvedValue(docs);
      repos.docMountFiles.findByMountPointId.mockResolvedValue([]);
      repos.docMountBlobs.listByMountPoint.mockResolvedValue([]);

      let folderCounter = 0;
      repos.docMountFolders.findByMountPointAndPath.mockResolvedValue(null);
      repos.docMountFolders.create.mockImplementation(async (data) => {
        folderCounter++;
        return {
          id: `folder-${folderCounter}`,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      const result = await backfillFolderRowsForMountPoint(MOUNT_ID);

      // Creates 'x' and 'x/y' (ensureFolderPath is called for both)
      // 'x/y/z' is created for the first doc, then 'x/y' is shared for the second doc
      expect(result.foldersCreated).toBeGreaterThanOrEqual(2);
      expect(result.filesUpdated).toBe(2);
    });
  });
});
