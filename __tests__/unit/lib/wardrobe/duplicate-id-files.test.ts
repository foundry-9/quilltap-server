/**
 * Two `Wardrobe/` files claiming one id (a copy made in the Scriptorium).
 *
 * The reader used to return both as items. A write then patched one copy (the
 * id → index map kept the last), re-projected both, and the unpatched twin
 * kept showing: archiving the item looked like it did nothing, every time.
 * The Inventory's rule (`chooseIdWinners`) now applies: the file at the
 * item's own name wins, the other is skipped, and a projection leaves it on
 * disk rather than sweeping or overwriting it.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const findManyByMountPointsInFolderMock = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: (...args: unknown[]) =>
        findManyByMountPointsInFolderMock(...args),
    },
  }),
}));

const writeDatabaseDocumentMock = jest.fn();
const deleteDatabaseDocumentMock = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => writeDatabaseDocumentMock(...args),
  deleteDatabaseDocument: (...args: unknown[]) => deleteDatabaseDocumentMock(...args),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }));

import { readCharacterVaultWardrobe } from '@/lib/wardrobe/vault-readers';
import { updateInMount } from '@/lib/wardrobe/vault-writes';
import { projectVaultWardrobe } from '@/lib/wardrobe/vault-sync';

const MOUNT_ID = 'm-1';
const CHAR_ID = 'char-1';
const ITEM_ID = '6be13d32-b801-40e8-91b6-17c728d4f562';

function stylusFile(extra: string, updatedAt: string): string {
  return [
    '---',
    `id: ${ITEM_ID}`,
    'title: Stylus',
    'types:',
    '  - accessories',
    extra,
    'createdAt: 2026-06-15T00:00:00.000Z',
    `updatedAt: ${updatedAt}`,
    '---',
    '',
    'A brass pen.',
  ]
    .join('\n');
}

function doc(relativePath: string, content: string) {
  return { id: `doc-${relativePath}`, relativePath, content };
}

/** The original at its own name, and an older copy beside it at `-1`. */
const ORIGINAL = doc('Wardrobe/Stylus.md', stylusFile('pronounGuidance:\n  - she', '2026-11-03T00:00:00.000Z'));
const COPY = doc('Wardrobe/Stylus-1.md', stylusFile('appropriateness: travel', '2026-11-01T00:00:00.000Z'));

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset().mockResolvedValue([COPY, ORIGINAL]);
  writeDatabaseDocumentMock.mockReset().mockResolvedValue({ mtime: 1 });
  deleteDatabaseDocumentMock.mockReset().mockResolvedValue(undefined);
});

describe('readCharacterVaultWardrobe — duplicate-id files', () => {
  it('returns one item per id, the file at its own name, and reports the copy', async () => {
    const vault = await readCharacterVaultWardrobe(MOUNT_ID, CHAR_ID);

    expect(vault!.items).toHaveLength(1);
    expect(vault!.items[0].id).toBe(ITEM_ID);
    expect(vault!.items[0].pronounGuidance).toEqual(['she']);
    expect(Array.from(vault!.duplicatePaths!)).toEqual(['Wardrobe/Stylus-1.md']);
  });

  it('prefers the newest when both files sit at their own names (different folders)', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      doc('Wardrobe/Stylus.md', stylusFile('appropriateness: old', '2026-10-01T00:00:00.000Z')),
      doc('Wardrobe/Desk/Stylus.md', stylusFile('appropriateness: new', '2026-11-01T00:00:00.000Z')),
    ]);

    const vault = await readCharacterVaultWardrobe(MOUNT_ID, CHAR_ID);

    expect(vault!.items).toHaveLength(1);
    expect(vault!.items[0].folder).toBe('Desk');
    expect(Array.from(vault!.duplicatePaths!)).toEqual(['Wardrobe/Stylus.md']);
  });
});

describe('updateInMount — archiving an item that has a twin', () => {
  it('archives the visible item and leaves the copy untouched on disk', async () => {
    const updated = await updateInMount(
      { mountPointId: MOUNT_ID, scope: 'character', characterId: CHAR_ID },
      ITEM_ID,
      { archivedAt: '2026-11-12T05:02:39.633Z' },
    );

    expect(updated!.archivedAt).toBe('2026-11-12T05:02:39.633Z');

    const writes = writeDatabaseDocumentMock.mock.calls.map((c) => [c[1], c[2]] as [string, string]);
    expect(writes.map(([path]) => path)).toEqual(['Wardrobe/Stylus.md']);
    expect(writes[0][1]).toContain('archived: true');
    expect(writes[0][1]).toContain('- she');

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(deletedPaths).not.toContain('Wardrobe/Stylus-1.md');
  });
});

describe('projectVaultWardrobe — a caller that passes no duplicate paths', () => {
  it('reads them itself and neither sweeps nor overwrites the copy', async () => {
    const vault = await readCharacterVaultWardrobe(MOUNT_ID, CHAR_ID);
    writeDatabaseDocumentMock.mockClear();

    await projectVaultWardrobe(MOUNT_ID, CHAR_ID, vault!.items);

    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(writtenPaths).toEqual(['Wardrobe/Stylus.md']);
    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map((c) => c[1]);
    expect(deletedPaths).not.toContain('Wardrobe/Stylus-1.md');
  });
});
