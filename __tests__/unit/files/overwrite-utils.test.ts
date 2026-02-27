/**
 * Tests for file overwrite utilities
 *
 * Verifies that findAndPrepareOverwrite correctly detects duplicate filenames
 * within a scope and prepares for overwrite by cleaning up old storage.
 */

import { findAndPrepareOverwrite, OverwriteRepos } from '@/lib/files/overwrite-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { cleanupThumbnails } from '@/lib/files/thumbnail-utils';
import type { FileEntry } from '@/lib/schemas/file.types';

// Mock dependencies
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    deleteFile: jest.fn(),
  },
}));

jest.mock('@/lib/files/thumbnail-utils', () => ({
  canGenerateThumbnail: jest.fn((mimeType: string) => mimeType.startsWith('image/')),
  cleanupThumbnails: jest.fn(),
}));

jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'file-001',
    userId: 'user-001',
    originalFilename: 'notes.txt',
    mimeType: 'text/plain',
    size: 100,
    sha256: 'abc123',
    source: 'UPLOADED',
    category: 'DOCUMENT',
    storageKey: 'users/user-001/files/file-001/notes.txt',
    projectId: 'proj-001',
    folderPath: '/',
    linkedTo: [],
    tags: [],
    description: null,
    generationPrompt: null,
    generationModel: null,
    generationRevisedPrompt: null,
    width: null,
    height: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as FileEntry;
}

function makeRepos(files: FileEntry[] = []): OverwriteRepos {
  return {
    files: {
      findByFilenameInScope: jest.fn().mockResolvedValue(files),
    },
  };
}

describe('findAndPrepareOverwrite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no duplicate exists', async () => {
    const repos = makeRepos([]);

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(result).toBeNull();
    expect(repos.files.findByFilenameInScope).toHaveBeenCalledWith(
      'user-001', 'proj-001', '/', 'notes.txt'
    );
    expect(fileStorageManager.deleteFile).not.toHaveBeenCalled();
  });

  it('returns existing fileId and cleans up old file when duplicate found', async () => {
    const existingFile = makeFileEntry();
    const repos = makeRepos([existingFile]);

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-001');
    expect(result!.existingFile).toBe(existingFile);
    expect(fileStorageManager.deleteFile).toHaveBeenCalledWith(existingFile);
  });

  it('cleans up thumbnails for image files', async () => {
    const existingImage = makeFileEntry({
      id: 'img-001',
      mimeType: 'image/png',
      originalFilename: 'photo.png',
    });
    const repos = makeRepos([existingImage]);

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'photo.png',
    });

    expect(result).not.toBeNull();
    expect(cleanupThumbnails).toHaveBeenCalledWith(existingImage);
  });

  it('does not clean up thumbnails for non-image files', async () => {
    const existingFile = makeFileEntry({
      mimeType: 'text/plain',
    });
    const repos = makeRepos([existingFile]);

    await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(cleanupThumbnails).not.toHaveBeenCalled();
  });

  it('continues gracefully when storage deletion fails', async () => {
    const existingFile = makeFileEntry();
    const repos = makeRepos([existingFile]);
    (fileStorageManager.deleteFile as jest.Mock).mockRejectedValue(new Error('disk error'));

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'notes.txt',
    });

    // Should still return the overwrite result despite the deletion failure
    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-001');
  });

  it('continues gracefully when thumbnail cleanup fails', async () => {
    const existingImage = makeFileEntry({
      mimeType: 'image/jpeg',
      originalFilename: 'photo.jpg',
    });
    const repos = makeRepos([existingImage]);
    (cleanupThumbnails as jest.Mock).mockRejectedValue(new Error('thumbnail error'));

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'photo.jpg',
    });

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe(existingImage.id);
  });

  it('isolates by folder — same name in different folders produces no collision', async () => {
    const repos = makeRepos([]); // No match in target folder

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/subfolder/',
      filename: 'notes.txt',
    });

    expect(result).toBeNull();
    expect(repos.files.findByFilenameInScope).toHaveBeenCalledWith(
      'user-001', 'proj-001', '/subfolder/', 'notes.txt'
    );
  });

  it('isolates by project — same name in different projects produces no collision', async () => {
    const repos = makeRepos([]); // No match in target project

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-002',
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(result).toBeNull();
    expect(repos.files.findByFilenameInScope).toHaveBeenCalledWith(
      'user-001', 'proj-002', '/', 'notes.txt'
    );
  });

  it('handles null projectId (general files) correctly', async () => {
    const generalFile = makeFileEntry({
      projectId: null,
    });
    const repos = makeRepos([generalFile]);

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: null,
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-001');
    expect(repos.files.findByFilenameInScope).toHaveBeenCalledWith(
      'user-001', null, '/', 'notes.txt'
    );
  });

  it('uses the first match when multiple duplicates exist', async () => {
    const first = makeFileEntry({ id: 'file-first' });
    const second = makeFileEntry({ id: 'file-second' });
    const repos = makeRepos([first, second]);

    const result = await findAndPrepareOverwrite(repos, {
      userId: 'user-001',
      projectId: 'proj-001',
      folderPath: '/',
      filename: 'notes.txt',
    });

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-first');
  });
});
