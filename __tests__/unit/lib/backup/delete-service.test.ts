/**
 * Unit tests for the delete service's `keepArchivedCharacterBundles` option
 * (character-archive spec §4.7).
 *
 * The default spares `files` rows of category `ARCHIVE` — archived-character
 * bundles — and their on-disk bytes from the wipe; the destructive choice is
 * the explicit one. Tombstone character rows do NOT survive, so the survivor
 * is a loose bundle: importable, not rehydratable.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));

const mockDeleteFile = jest.fn();
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { deleteFile: (...args: unknown[]) => mockDeleteFile(...args) },
}));

const mockRawQuery = jest.fn();
const mockLogEntriesDeleteAll = jest.fn();
jest.mock('@/lib/database/manager', () => ({
  rawQuery: (...args: unknown[]) => mockRawQuery(...args),
}));

jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: () => null,
  isMountIndexDegraded: () => true,
}));

const mockFilesFindAll = jest.fn();
const mockCharactersFindAllRaw = jest.fn();
const mockCharactersDelete = jest.fn();
const mockProjectsFindAllRaw = jest.fn();
const mockProjectsDelete = jest.fn();
const mockLlmLogsDeleteByUserId = jest.fn();
const mockFilesDelete = jest.fn();
const mockCharactersFindAll = jest.fn();
const mockMemoriesFindByCharacterId = jest.fn();
const mockMemoriesDelete = jest.fn();

const mockRetireMemories = jest.fn();
jest.mock('@/lib/memory/retire', () => ({
  retireMemories: (...args: unknown[]) => mockRetireMemories(...args),
}));

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: () => ({
    characters: {
      findAll: (...args: unknown[]) => mockCharactersFindAll(...args),
      delete: (...args: unknown[]) => mockCharactersDelete(...args),
    },
    chats: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    tags: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    files: {
      findAll: (...args: unknown[]) => mockFilesFindAll(...args),
      delete: (...args: unknown[]) => mockFilesDelete(...args),
    },
    connections: {
      findAll: jest.fn().mockResolvedValue([]),
      getAllApiKeys: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      deleteApiKey: jest.fn(),
    },
    imageProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    projects: { findAll: jest.fn().mockResolvedValue([]), delete: (...args: unknown[]) => mockProjectsDelete(...args) },
    groups: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    llmLogs: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    memories: {
      findByCharacterId: (...args: unknown[]) => mockMemoriesFindByCharacterId(...args),
      delete: (...args: unknown[]) => mockMemoriesDelete(...args),
    },
  }),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null), delete: jest.fn() },
    folders: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    wardrobe: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    logEntries: { deleteAll: (...args: unknown[]) => mockLogEntriesDeleteAll(...args) },
    characters: { findAllRaw: (...args: unknown[]) => mockCharactersFindAllRaw(...args) },
    projects: { findAllRaw: (...args: unknown[]) => mockProjectsFindAllRaw(...args) },
    groups: { findAllRaw: jest.fn().mockResolvedValue([]) },
    llmLogs: {
      findByUserId: jest.fn().mockResolvedValue([]),
      deleteByUserId: (...args: unknown[]) => mockLlmLogsDeleteByUserId(...args),
    },
  }),
}));

import {
  deleteUserData,
  deleteAllUserData,
  previewDeleteAllUserData,
} from '@/lib/backup/restore/delete-service';

const USER = 'user-1';

const archiveBundle = {
  id: 'file-archive',
  category: 'ARCHIVE',
  folderPath: '/archive/characters',
  originalFilename: 'Bertie.qtap',
  storageKey: 'archive/characters/Bertie.qtap',
};
const ordinaryFile = {
  id: 'file-plain',
  category: 'IMAGE',
  folderPath: '/uploads',
  originalFilename: 'photo.webp',
  storageKey: 'uploads/photo.webp',
};

describe('delete-service keepArchivedCharacterBundles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilesFindAll.mockResolvedValue([archiveBundle, ordinaryFile]);
    mockFilesDelete.mockResolvedValue(true);
    mockDeleteFile.mockResolvedValue(undefined);
    mockRawQuery.mockResolvedValue(undefined);
    mockCharactersFindAll.mockResolvedValue([]);
    mockMemoriesFindByCharacterId.mockResolvedValue([]);
    mockRetireMemories.mockResolvedValue({ retired: 0 });
    mockLogEntriesDeleteAll.mockResolvedValue(0);
    mockCharactersFindAllRaw.mockResolvedValue([]);
    mockProjectsFindAllRaw.mockResolvedValue([]);
    mockLlmLogsDeleteByUserId.mockResolvedValue(0);
  });

  it('deletes a character, project and its memories even when their store cannot be read', async () => {
    // The hydrated reads drop a row whose store is unreadable; the raw rows do not.
    mockCharactersFindAll.mockResolvedValue([]);
    mockCharactersFindAllRaw.mockResolvedValue([
      { id: 'char-broken', userId: USER },
      { id: 'char-someone-else', userId: 'user-2' },
    ]);
    mockProjectsFindAllRaw.mockResolvedValue([{ id: 'proj-broken' }]);
    mockMemoriesFindByCharacterId.mockResolvedValue([{ id: 'mem-of-broken' }]);

    await deleteUserData(USER);

    expect(mockCharactersDelete).toHaveBeenCalledWith('char-broken');
    expect(mockCharactersDelete).not.toHaveBeenCalledWith('char-someone-else');
    expect(mockProjectsDelete).toHaveBeenCalledWith('proj-broken');
    expect(mockRetireMemories).toHaveBeenCalledWith(['mem-of-broken'], { reason: 'restore-replace' });
  });

  it('deletes every LLM log, not only the newest 10,000', async () => {
    mockLlmLogsDeleteByUserId.mockResolvedValue(12_345);

    await deleteUserData(USER);

    expect(mockLlmLogsDeleteByUserId).toHaveBeenCalledWith(USER);
  });

  it('clears the Log, which the per-user deletes never reach', async () => {
    await deleteUserData(USER);

    expect(mockLogEntriesDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('routes memory deletion through the retireMemories chokepoint', async () => {
    mockCharactersFindAll.mockResolvedValue([{ id: 'char-1' }, { id: 'char-2' }]);
    mockMemoriesFindByCharacterId
      .mockResolvedValueOnce([{ id: 'mem-1' }, { id: 'mem-2' }])
      .mockResolvedValueOnce([{ id: 'mem-3' }]);

    await deleteUserData(USER);

    expect(mockRetireMemories).toHaveBeenCalledTimes(1);
    expect(mockRetireMemories).toHaveBeenCalledWith(['mem-1', 'mem-2', 'mem-3'], { reason: 'restore-replace' });
    // The repository's per-row delete must never be hit directly.
    expect(mockMemoriesDelete).not.toHaveBeenCalled();
    // Vectors live on the memory rows now: there are no vector tables to truncate.
    const sql = mockRawQuery.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).not.toMatch(/vector_entries|vector_indices/);
  });

  it('spares ARCHIVE bundles (row and bytes) by default', async () => {
    await deleteUserData(USER);

    const deletedIds = mockFilesDelete.mock.calls.map((c) => c[0]);
    expect(deletedIds).toEqual(['file-plain']);
    const storageDeleted = mockDeleteFile.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(storageDeleted).toEqual(['file-plain']);
  });

  it('wipes ARCHIVE bundles when keepArchivedCharacterBundles is false', async () => {
    await deleteUserData(USER, { keepArchivedCharacterBundles: false });

    const deletedIds = mockFilesDelete.mock.calls.map((c) => c[0]);
    expect(deletedIds).toEqual(expect.arrayContaining(['file-archive', 'file-plain']));
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
  });

  it('deleteAllUserData reports kept bundles and excludes them from the files count', async () => {
    const summary = await deleteAllUserData(USER);

    expect(summary.archiveBundles).toBe(1);
    expect(summary.archiveBundlesKept).toBe(true);
    expect(summary.files).toBe(1); // the ordinary file only
    expect(mockFilesDelete.mock.calls.map((c) => c[0])).toEqual(['file-plain']);
  });

  it('deleteAllUserData with keep=false counts every file as wiped', async () => {
    const summary = await deleteAllUserData(USER, { keepArchivedCharacterBundles: false });

    expect(summary.archiveBundles).toBe(1);
    expect(summary.archiveBundlesKept).toBe(false);
    expect(summary.files).toBe(2);
  });

  it('previewDeleteAllUserData counts bundles without deleting anything', async () => {
    const summary = await previewDeleteAllUserData(USER);

    expect(summary.archiveBundles).toBe(1);
    expect(summary.files).toBe(2);
    expect(mockFilesDelete).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});
