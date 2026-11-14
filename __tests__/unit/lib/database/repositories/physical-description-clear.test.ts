/**
 * Clear means clear (#149, D7).
 *
 * The physical-description card's Clear sends `physicalDescription: null`. The
 * write overlay used to skip the vault on null ("a DB-side concern"), `_update`
 * stripped the key, and the read overlay rebuilt the record from the untouched
 * files — nothing changed and nothing said so. Now a null empties both files,
 * keeping only `humanoid` (a setting, not generated text), and the read overlay
 * yields a record whose every text field is null.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

const vault = new Map<string, string>();

jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) { super(message); }
  }
  return {
    DatabaseStoreError,
    writeDatabaseDocument: jest.fn(async (_mp: string, relativePath: string, content: string) => {
      vault.set(relativePath, content);
      return { mtime: 0 };
    }),
    readDatabaseDocument: jest.fn(async (_mp: string, relativePath: string) => {
      if (!vault.has(relativePath)) throw new DatabaseStoreError(`not found: ${relativePath}`, 'NOT_FOUND');
      const content = vault.get(relativePath)!;
      return { content, mtime: 0, size: content.length };
    }),
    readDatabaseDocumentIfExists: jest.fn(async (_mp: string, relativePath: string) =>
      vault.has(relativePath) ? vault.get(relativePath)! : null,
    ),
    deleteDatabaseDocument: jest.fn(async () => undefined),
  };
});

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import { applyDocumentStoreWriteOverlay } from '@/lib/characters/vault/write';
import { applyDocumentStoreOverlayOne } from '@/lib/characters/vault/hydrate';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const MOUNT_POINT_ID = '22222222-2222-4222-8222-222222222222';
const ROW = { id: CHARACTER_ID, name: 'Tess', characterDocumentMountPointId: MOUNT_POINT_ID };

function docsAt(path: string) {
  return vault.has(path)
    ? [{ mountPointId: MOUNT_POINT_ID, relativePath: path, content: vault.get(path)! }]
    : [];
}

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  vault.set('properties.json', JSON.stringify({ pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0.5 }));
  vault.set('physical-description.md', 'Tall, with a lantern.');
  vault.set('physical-prompts.json', JSON.stringify({
    headAndShoulders: 'h', short: 's', medium: 'm', long: 'l', complete: 'c', humanoid: false,
  }));
  getRepositoriesMock.mockReturnValue({
    characters: { findByIdRaw: jest.fn().mockResolvedValue(ROW) },
    docMountDocuments: {
      findManyByMountPointsAndPath: jest.fn(async (_ids: string[], path: string) => docsAt(path)),
      findManyByMountPointsInFolder: jest.fn(async () => []),
    },
  });
});

describe('clearing the physical description', () => {
  it('empties both files and keeps the humanoid setting', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, { physicalDescription: null });

    expect('physicalDescription' in dbPatch).toBe(false);
    expect(vault.get('physical-description.md')).toBe('');
    expect(JSON.parse(vault.get('physical-prompts.json')!)).toEqual({
      headAndShoulders: null, short: null, medium: null, long: null, complete: null, humanoid: false,
    });
  });

  it('reads back as a record with every text field null', async () => {
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { physicalDescription: null });

    const hydrated = await applyDocumentStoreOverlayOne(ROW as any);

    expect(hydrated?.physicalDescription).toMatchObject({
      fullDescription: null,
      headAndShouldersPrompt: null,
      shortPrompt: null,
      mediumPrompt: null,
      longPrompt: null,
      completePrompt: null,
      humanoid: false,
    });
  });
});
