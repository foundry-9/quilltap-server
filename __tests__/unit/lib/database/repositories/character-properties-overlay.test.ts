/**
 * Unit tests for lib/database/repositories/character-properties-overlay.ts
 *
 * Strategy: Mock getRepositories, readDatabaseDocument, and the logger.
 * No real database. Tests focus on overlay behavior: which characters are
 * candidates, schema validation, all-or-nothing fallback, batching, and
 * null handling.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));

import {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
  readCharacterVaultProperties,
  CharacterVaultPropertiesSchema,
} from '@/lib/database/repositories/character-properties-overlay';
import type { Character } from '@/lib/schemas/types';
import { readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readDatabaseDocumentMock = readDatabaseDocument as jest.MockedFunction<typeof readDatabaseDocument>;

// Helper to build minimal character objects. We only need the fields the
// overlay module actually looks at; the rest are defaulted to satisfy TS.
function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-default',
    userId: 'user-1',
    name: 'Default',
    title: 'db-title',
    firstMessage: 'db-first',
    talkativeness: 0.5,
    aliases: ['db-alias'],
    pronouns: { subject: 'she', object: 'her', possessive: 'her' },
    controlledBy: 'llm',
    npc: false,
    isFavorite: false,
    scenarios: [],
    systemPrompts: [],
    partnerLinks: [],
    tags: [],
    avatarOverrides: [],
    physicalDescriptions: [],
    clothingRecords: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

const VALID_VAULT_PROPS = {
  pronouns: { subject: 'they', object: 'them', possessive: 'their' },
  aliases: ['vault-alias'],
  title: 'vault-title',
  firstMessage: 'vault-first',
  talkativeness: 0.8,
};

function mockDocMountDocumentsReturn(
  documents: Array<{ mountPointId: string; content: string }>,
) {
  const findManyByMountPointsAndPath = jest.fn().mockResolvedValue(documents);
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: { findManyByMountPointsAndPath },
  });
  return findManyByMountPointsAndPath;
}

describe('applyDocumentStoreOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the input unchanged when the list is empty', async () => {
    const result = await applyDocumentStoreOverlay([]);
    expect(result).toEqual([]);
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });

  it('passes through characters with the switch off without touching the repository', async () => {
    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: false, characterDocumentMountPointId: 'mp-1' }),
      makeCharacter({ id: 'b' }), // undefined flag
    ];
    const result = await applyDocumentStoreOverlay(chars);
    expect(result).toEqual(chars);
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });

  it('passes through characters with the switch on but no linked vault', async () => {
    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: null }),
    ];
    const result = await applyDocumentStoreOverlay(chars);
    expect(result).toEqual(chars);
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });

  it('overrides the five fields when properties.json is valid', async () => {
    mockDocMountDocumentsReturn([
      { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
    ]);

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      description: 'description-unchanged',
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toEqual(VALID_VAULT_PROPS.pronouns);
    expect(result.aliases).toEqual(VALID_VAULT_PROPS.aliases);
    expect(result.title).toBe(VALID_VAULT_PROPS.title);
    expect(result.firstMessage).toBe(VALID_VAULT_PROPS.firstMessage);
    expect(result.talkativeness).toBe(VALID_VAULT_PROPS.talkativeness);
    // Non-overridden fields are preserved.
    expect(result.description).toBe('description-unchanged');
    expect(result.id).toBe('a');
  });

  it('preserves null fields from properties.json (null means null)', async () => {
    mockDocMountDocumentsReturn([
      {
        mountPointId: 'mp-1',
        content: JSON.stringify({
          ...VALID_VAULT_PROPS,
          pronouns: null,
        }),
      },
    ]);

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toBeNull();
  });

  it('falls back to DB values when properties.json is missing for this mount', async () => {
    // Return no document — overlay candidate's mount point is absent.
    mockDocMountDocumentsReturn([]);

    const dbPronouns = { subject: 'she', object: 'her', possessive: 'her' };
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
      pronouns: dbPronouns,
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
    expect(result.pronouns).toEqual(dbPronouns);
  });

  it('falls back to DB values when properties.json is malformed JSON', async () => {
    mockDocMountDocumentsReturn([
      { mountPointId: 'mp-1', content: '{ not valid json' },
    ]);

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
  });

  it('falls back to DB values when properties.json fails schema validation (all-or-nothing)', async () => {
    mockDocMountDocumentsReturn([
      {
        mountPointId: 'mp-1',
        content: JSON.stringify({
          ...VALID_VAULT_PROPS,
          talkativeness: 2.0, // out of bounds
        }),
      },
    ]);

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
      talkativeness: 0.5,
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    // All five fields revert — not just talkativeness.
    expect(result.title).toBe('db-title');
    expect(result.talkativeness).toBe(0.5);
  });

  it('batches: a single findManyByMountPointsAndPath call hydrates all candidates', async () => {
    const findMany = mockDocMountDocumentsReturn([
      {
        mountPointId: 'mp-1',
        content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-a' }),
      },
      {
        mountPointId: 'mp-2',
        content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-b' }),
      },
    ]);

    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-1' }),
      makeCharacter({ id: 'b', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-2' }),
      makeCharacter({ id: 'c', readPropertiesFromDocumentStore: false }),
    ];

    const result = await applyDocumentStoreOverlay(chars);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.arrayContaining(['mp-1', 'mp-2']), 'properties.json');
    expect(result[0].title).toBe('vault-a');
    expect(result[1].title).toBe('vault-b');
    expect(result[2].title).toBe('db-title'); // unchanged
  });

  it('deduplicates mount point ids in the IN(...) query', async () => {
    const findMany = mockDocMountDocumentsReturn([
      { mountPointId: 'mp-shared', content: JSON.stringify(VALID_VAULT_PROPS) },
    ]);

    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
      makeCharacter({ id: 'b', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
    ];

    await applyDocumentStoreOverlay(chars);
    expect(findMany).toHaveBeenCalledTimes(1);
    const mountIds = findMany.mock.calls[0][0] as string[];
    expect(mountIds).toEqual(['mp-shared']);
  });

  it('falls back gracefully when the repository throws', async () => {
    const findMany = jest.fn().mockRejectedValue(new Error('db exploded'));
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: { findManyByMountPointsAndPath: findMany },
    });

    const chars = [
      makeCharacter({
        id: 'a',
        readPropertiesFromDocumentStore: true,
        characterDocumentMountPointId: 'mp-1',
        title: 'db-title',
      }),
    ];

    const result = await applyDocumentStoreOverlay(chars);
    expect(result[0].title).toBe('db-title');
  });
});

describe('applyDocumentStoreOverlayOne', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the input is null', async () => {
    const result = await applyDocumentStoreOverlayOne(null);
    expect(result).toBeNull();
  });

  it('returns the overlaid character', async () => {
    mockDocMountDocumentsReturn([
      { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
    ]);

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });

    const result = await applyDocumentStoreOverlayOne(char);
    expect(result?.title).toBe(VALID_VAULT_PROPS.title);
  });
});

describe('readCharacterVaultProperties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed properties on a clean read', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify(VALID_VAULT_PROPS),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toEqual(VALID_VAULT_PROPS);
  });

  it('returns null when the document is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: 'not json',
      mtime: 0,
      size: 10,
    });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on schema validation failure', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ ...VALID_VAULT_PROPS, talkativeness: 5 }),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on generic read errors', async () => {
    readDatabaseDocumentMock.mockRejectedValue(new Error('io error'));
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });
});

describe('CharacterVaultPropertiesSchema', () => {
  it('rejects out-of-bounds talkativeness', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      talkativeness: 0.05,
    });
    expect(parsed.success).toBe(false);
  });

  it('requires all five fields', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({ title: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('accepts null pronouns', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      pronouns: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts null title and firstMessage (mirrors Character schema)', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      title: null,
      firstMessage: null,
    });
    expect(parsed.success).toBe(true);
  });
});
