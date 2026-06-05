/**
 * Round-trip regression test for "manifesto is nullable" through the character
 * vault write/read overlay.
 *
 * Post-4.6 cutover, manifesto is NOT a DB column — it lives in the character
 * vault as `manifesto.md`. The 12811c18 bug treated it as required; these tests
 * lock the storage-path behaviour that makes null-manifesto a first-class state:
 *
 *   - applyDocumentStoreWriteOverlay routes a `manifesto` patch to manifesto.md
 *     (null → empty file) and strips it from the DB-bound patch.
 *   - a patch with no manifesto leaves manifesto.md untouched (the "only write
 *     it when the patch carries the field" behaviour).
 *   - what the write overlay stores, read back through the overlay's own
 *     empty→null collapse (markdownToNullable), reproduces the original value:
 *     null → '' → null, and 'text' → 'text' → 'text'.
 *
 * The database-store is mocked with an in-memory Map acting as the vault, so the
 * real write-overlay code and the real read transform run against a shared
 * store — a genuine write→store→read cycle without the full mount-index DB.
 * Mirrors the mock set of character-properties-overlay.test.ts.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

// In-memory vault: relativePath -> content. Shared by the mocked read/write.
const vault = new Map<string, string>();

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mountPointId: string, relativePath: string, content: string) => {
    vault.set(relativePath, content);
    return { mtime: 0 };
  }),
  readDatabaseDocument: jest.fn(async (_mountPointId: string, relativePath: string) => {
    if (!vault.has(relativePath)) {
      throw new (class extends Error {})(`not found: ${relativePath}`);
    }
    const content = vault.get(relativePath)!;
    return { content, mtime: 0, size: content.length };
  }),
  deleteDatabaseDocument: jest.fn(async () => undefined),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) { super(message); }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyDocumentStoreWriteOverlay,
} from '@/lib/database/repositories/character-properties-overlay';
import { markdownToNullable } from '@/lib/database/repositories/vault-overlay/parsers';
import { writeDatabaseDocument, readDatabaseDocument } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const MOUNT_POINT_ID = '22222222-2222-4222-8222-222222222222';
const MANIFESTO_PATH = 'manifesto.md';

function wireCharacterWithVault() {
  getRepositoriesMock.mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({
        id: CHARACTER_ID,
        name: 'Tess',
        characterDocumentMountPointId: MOUNT_POINT_ID, // → hasLinkedVault() === true
      }),
    },
  });
}

// Read the stored manifesto back through the overlay's own empty→null transform.
async function readManifestoThroughOverlay(): Promise<string | null> {
  const { content } = await readDatabaseDocument(MOUNT_POINT_ID, MANIFESTO_PATH);
  return markdownToNullable(content);
}

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  wireCharacterWithVault();
});

describe('manifesto vault round-trip — applyDocumentStoreWriteOverlay', () => {
  it('routes a null manifesto to an empty vault file and strips it from the DB patch', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, { manifesto: null });

    expect(writeDatabaseDocumentMock).toHaveBeenCalledWith(MOUNT_POINT_ID, MANIFESTO_PATH, '');
    expect(vault.get(MANIFESTO_PATH)).toBe('');
    // Vault owns manifesto post-cutover; it must not leak back into the DB patch.
    expect('manifesto' in dbPatch).toBe(false);
  });

  it('routes a string manifesto to the vault file verbatim', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, {
      manifesto: 'I exist to keep the lighthouse lit.',
    });

    expect(vault.get(MANIFESTO_PATH)).toBe('I exist to keep the lighthouse lit.');
    expect('manifesto' in dbPatch).toBe(false);
  });

  it('leaves manifesto.md untouched when the patch does not carry manifesto', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, { name: 'Renamed' } as any);

    const manifestoWrites = writeDatabaseDocumentMock.mock.calls.filter(
      ([, relPath]) => relPath === MANIFESTO_PATH
    );
    expect(manifestoWrites).toHaveLength(0);
    expect(vault.has(MANIFESTO_PATH)).toBe(false);
    // Unmanaged field flows through to the DB patch unchanged.
    expect((dbPatch as any).name).toBe('Renamed');
  });

  it('round-trips a null manifesto: null → empty file → null', async () => {
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { manifesto: null });
    expect(await readManifestoThroughOverlay()).toBeNull();
  });

  it('round-trips a populated manifesto: text → file → text', async () => {
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { manifesto: 'The load-bearing truth.' });
    expect(await readManifestoThroughOverlay()).toBe('The load-bearing truth.');
  });
});
