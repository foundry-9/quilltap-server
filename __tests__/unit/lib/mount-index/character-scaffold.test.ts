/**
 * Unit tests for lib/mount-index/character-scaffold.ts
 *
 * Tests cover the preset structure that is materialized when a
 * database-backed character store is created or flipped to 'character'.
 *
 * Strategy: Mock getRepositories, ensureFolderPath, and writeDatabaseDocument.
 * No real database.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn().mockResolvedValue({ mtime: 0 }),
}));

import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const ensureFolderPathMock = ensureFolderPath as jest.MockedFunction<typeof ensureFolderPath>;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.MockedFunction<typeof writeDatabaseDocument>;

const MOUNT_ID = 'mount-abc';

function makeRepos(overrides: {
  mountPoint?: Partial<{ mountType: string; storeType: string; name: string }> | null;
  existingDocuments?: string[];
  existingFolders?: string[];
} = {}) {
  const mp = overrides.mountPoint === null ? null : {
    id: MOUNT_ID,
    name: 'Char Store',
    mountType: 'database',
    storeType: 'character',
    ...overrides.mountPoint,
  };
  const existingDocs = new Set(overrides.existingDocuments ?? []);
  const existingFolders = new Set(overrides.existingFolders ?? []);

  return {
    docMountPoints: {
      findById: jest.fn().mockResolvedValue(mp),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn((_mountId: string, relPath: string) =>
        Promise.resolve(existingDocs.has(relPath) ? { id: `doc-${relPath}`, relativePath: relPath } : null),
      ),
    },
    docMountFolders: {
      findByMountPointAndPath: jest.fn((_mountId: string, path: string) =>
        Promise.resolve(existingFolders.has(path) ? { id: `folder-${path}`, path } : null),
      ),
    },
  };
}

describe('scaffoldCharacterMount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureFolderPathMock.mockResolvedValue('folder-id');
    writeDatabaseDocumentMock.mockResolvedValue({ mtime: 0 });
  });

  it('scaffolds the seeded files and seven folders on a fresh database-backed character mount', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 7, filesSkipped: 0, foldersCreated: 7 });
    expect(ensureFolderPathMock).toHaveBeenCalledTimes(7);
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Prompts');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Scenarios');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Wardrobe');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Outfits');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'lore');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'images');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'files');

    expect(writeDatabaseDocumentMock).toHaveBeenCalledTimes(7);
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'identity.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'description.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'personality.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'physical-description.md', '');
    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_ID, 'example-dialogues.md', '');
  });

  it('writes physical-prompts.json with null short/medium/long/complete for a fresh scaffold', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const call = writeDatabaseDocumentMock.mock.calls.find(c => c[1] === 'physical-prompts.json');
    expect(call).toBeDefined();
    const parsed = JSON.parse(call![2] as string);
    expect(parsed).toEqual({ short: null, medium: null, long: null, complete: null });
  });

  it('writes properties.json with pronouns, aliases, title, firstMessage, talkativeness', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const propertiesCall = writeDatabaseDocumentMock.mock.calls.find(c => c[1] === 'properties.json');
    expect(propertiesCall).toBeDefined();
    const parsed = JSON.parse(propertiesCall![2] as string);
    expect(parsed).toEqual({
      pronouns: null,
      aliases: [],
      title: '',
      firstMessage: '',
      talkativeness: 0.5,
    });
  });

  it('does not seed a wardrobe.json — items live in Wardrobe/, presets in Outfits/', async () => {
    const repos = makeRepos();
    getRepositoriesMock.mockReturnValue(repos);

    await scaffoldCharacterMount(MOUNT_ID);

    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(c => c[1]);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Wardrobe');
    expect(ensureFolderPathMock).toHaveBeenCalledWith(MOUNT_ID, 'Outfits');
  });

  it('no-op when mountType is not database', async () => {
    const repos = makeRepos({ mountPoint: { mountType: 'filesystem' } });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(ensureFolderPathMock).not.toHaveBeenCalled();
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('no-op when storeType is not character', async () => {
    const repos = makeRepos({ mountPoint: { storeType: 'documents' } });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(ensureFolderPathMock).not.toHaveBeenCalled();
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('no-op when mount point does not exist', async () => {
    const repos = makeRepos({ mountPoint: null });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result).toEqual({ filesCreated: 0, filesSkipped: 0, foldersCreated: 0 });
    expect(writeDatabaseDocumentMock).not.toHaveBeenCalled();
  });

  it('is idempotent — pre-existing files are skipped, missing ones are still created', async () => {
    const repos = makeRepos({
      existingDocuments: ['identity.md', 'properties.json'],
      existingFolders: ['Prompts', 'lore'],
    });
    getRepositoriesMock.mockReturnValue(repos);

    const result = await scaffoldCharacterMount(MOUNT_ID);

    expect(result.filesCreated).toBe(5);
    expect(result.filesSkipped).toBe(2);
    expect(result.foldersCreated).toBe(5);

    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(c => c[1]);
    expect(writtenPaths).not.toContain('identity.md');
    expect(writtenPaths).not.toContain('properties.json');
    expect(writtenPaths).toContain('description.md');
    expect(writtenPaths).toContain('personality.md');
    expect(writtenPaths).toContain('physical-description.md');
    expect(writtenPaths).toContain('example-dialogues.md');
    expect(writtenPaths).not.toContain('wardrobe.json');
  });
});
