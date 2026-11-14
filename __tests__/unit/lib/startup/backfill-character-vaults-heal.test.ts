/**
 * The startup heal never writes over content (#148, D1 of
 * refactor-character-repository-and-vault.md).
 *
 * The old heal read `properties.json` fail-soft — missing, unreadable and
 * schema-invalid all came back `null` — and on `null` re-projected the RAW row
 * into the vault. A raw row carries no content, so one stray comma (or
 * `talkativeness: 0`, which the schema's `min(0.1)` rejects) wrote `''` over
 * identity.md and friends and swept Prompts/ and Scenarios/ empty.
 *
 * The heal now does exactly two things to a linked vault: seed an ABSENT
 * `properties.json` with defaults, and seed an absent `metadata.json`. A
 * present-but-invalid keystone is reported and left byte-for-byte alone.
 *
 * The vault is an in-memory map behind the real strict reader and the real
 * seeders, so these tests watch every write the backfill makes.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn().mockReturnValue({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

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
    readDatabaseDocumentIfExists: jest.fn(async (_mp: string, relativePath: string) =>
      vault.has(relativePath) ? vault.get(relativePath)! : null,
    ),
    deleteDatabaseDocument: jest.fn(async (_mp: string, relativePath: string) => {
      vault.delete(relativePath);
    }),
  };
});

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn().mockResolvedValue({ mountPointId: 'mp-1', created: false }),
}));

jest.mock('@/lib/startup/progress', () => ({
  startupProgress: { setCurrent: jest.fn(), setSubProgress: jest.fn(), publish: jest.fn() },
}));

import { backfillCharacterVaults } from '@/lib/startup/backfill-character-vaults';
import { writeDatabaseDocument, deleteDatabaseDocument } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const writeMock = writeDatabaseDocument as jest.Mock;
const deleteMock = deleteDatabaseDocument as jest.Mock;

const IDENTITY = 'A lighthouse keeper of some renown.';
const PROMPT_A = '---\nname: Formal\nisDefault: true\n---\n\nYou speak formally.';
const PROMPT_B = '---\nname: Casual\n---\n\nYou speak casually.';

function seedAuthoredVault(properties: string | null) {
  vault.clear();
  vault.set('identity.md', IDENTITY);
  vault.set('Prompts/Formal.md', PROMPT_A);
  vault.set('Prompts/Casual.md', PROMPT_B);
  if (properties !== null) vault.set('properties.json', properties);
}

beforeEach(() => {
  jest.clearAllMocks();
  getRepositoriesMock.mockReturnValue({
    characters: {
      findAllRaw: jest.fn().mockResolvedValue([
        { id: 'char-1', name: 'Tess', characterDocumentMountPointId: 'mp-1' },
      ]),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(async (_mp: string, relativePath: string) =>
        vault.has(relativePath) ? { relativePath, content: vault.get(relativePath) } : null,
      ),
    },
  });
});

describe('backfillCharacterVaults — the heal never writes over content', () => {
  it('leaves an authored vault untouched when properties.json is schema-invalid', async () => {
    const invalid = JSON.stringify({ pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0 });
    seedAuthoredVault(invalid);
    vault.set('metadata.json', '{}');

    const result = await backfillCharacterVaults();

    expect(result.keystonesInvalid).toBe(1);
    expect(result.invalidKeystones[0]).toMatchObject({ characterId: 'char-1', mountPointId: 'mp-1' });
    expect(vault.get('identity.md')).toBe(IDENTITY);
    expect(vault.get('Prompts/Formal.md')).toBe(PROMPT_A);
    expect(vault.get('Prompts/Casual.md')).toBe(PROMPT_B);
    expect(vault.get('properties.json')).toBe(invalid);
    expect(writeMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('leaves the vault untouched when properties.json is not JSON at all', async () => {
    seedAuthoredVault('{ "aliases": [], }');
    vault.set('metadata.json', '{}');

    const result = await backfillCharacterVaults();

    expect(result.keystonesInvalid).toBe(1);
    expect(writeMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('seeds only properties.json and metadata.json when properties.json is absent', async () => {
    seedAuthoredVault(null);

    const result = await backfillCharacterVaults();

    expect(result.propertiesSeeded).toBe(1);
    expect(result.metadataSeeded).toBe(1);
    const writtenPaths = writeMock.mock.calls.map(([, relativePath]) => relativePath).sort();
    expect(writtenPaths).toEqual(['metadata.json', 'properties.json']);
    expect(JSON.parse(vault.get('properties.json')!)).toMatchObject({ talkativeness: 0.5, aliases: [] });
    expect(vault.get('identity.md')).toBe(IDENTITY);
    expect(vault.get('Prompts/Formal.md')).toBe(PROMPT_A);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('writes nothing to a healthy vault', async () => {
    seedAuthoredVault(JSON.stringify({ pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0.5 }));
    vault.set('metadata.json', '{}');

    const result = await backfillCharacterVaults();

    expect(result.keystonesInvalid).toBe(0);
    expect(result.propertiesSeeded).toBe(0);
    expect(writeMock).not.toHaveBeenCalled();
  });
});
