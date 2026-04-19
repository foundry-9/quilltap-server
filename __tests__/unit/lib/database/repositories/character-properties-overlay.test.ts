/**
 * Unit tests for lib/database/repositories/character-properties-overlay.ts
 *
 * Strategy: Mock getRepositories, readDatabaseDocument, and the logger.
 * No real database. Tests cover per-file overlay behavior across all five
 * vault files (properties.json, description.md, personality.md,
 * physical-description.md, physical-prompts.json), per-file fallback semantics,
 * and batching.
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
  readCharacterVaultDescription,
  readCharacterVaultPersonality,
  readCharacterVaultPhysicalDescription,
  readCharacterVaultPhysicalPrompts,
  CharacterVaultPropertiesSchema,
  CharacterVaultPhysicalPromptsSchema,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
} from '@/lib/database/repositories/character-properties-overlay';
import type { Character, PhysicalDescription } from '@/lib/schemas/types';
import { readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readDatabaseDocumentMock = readDatabaseDocument as jest.MockedFunction<typeof readDatabaseDocument>;

function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-default',
    userId: 'user-1',
    name: 'Default',
    title: 'db-title',
    description: 'db-description',
    personality: 'db-personality',
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

function makePhysicalDescription(
  overrides: Partial<PhysicalDescription> = {},
): PhysicalDescription {
  return {
    id: 'pd-default',
    name: 'default',
    usageContext: null,
    shortPrompt: 'db-short',
    mediumPrompt: 'db-medium',
    longPrompt: 'db-long',
    completePrompt: 'db-complete',
    fullDescription: 'db-full',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_VAULT_PROPS = {
  pronouns: { subject: 'they', object: 'them', possessive: 'their' },
  aliases: ['vault-alias'],
  title: 'vault-title',
  firstMessage: 'vault-first',
  talkativeness: 0.8,
};

const VALID_VAULT_PHYSICAL_PROMPTS = {
  short: 'vault-short',
  medium: 'vault-medium',
  long: 'vault-long',
  complete: 'vault-complete',
};

type Doc = { mountPointId: string; content: string };

/**
 * Mock repos with per-path documents. Keys map a vault path to the docs that
 * findManyByMountPointsAndPath should return for that path. Paths not present
 * resolve to [].
 */
function mockRepoPaths(docsByPath: Record<string, Doc[]>) {
  const findManyByMountPointsAndPath = jest
    .fn()
    .mockImplementation((_ids: string[], path: string) =>
      Promise.resolve(docsByPath[path] ?? []),
    );
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: { findManyByMountPointsAndPath },
  });
  return findManyByMountPointsAndPath;
}

describe('applyDocumentStoreOverlay — basic candidate filtering', () => {
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
      makeCharacter({ id: 'b' }),
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
});

describe('applyDocumentStoreOverlay — properties.json overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides the five properties.json fields when valid', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });

    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toEqual(VALID_VAULT_PROPS.pronouns);
    expect(result.aliases).toEqual(VALID_VAULT_PROPS.aliases);
    expect(result.title).toBe(VALID_VAULT_PROPS.title);
    expect(result.firstMessage).toBe(VALID_VAULT_PROPS.firstMessage);
    expect(result.talkativeness).toBe(VALID_VAULT_PROPS.talkativeness);
  });

  it('preserves null pronouns in properties.json (null means null)', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ ...VALID_VAULT_PROPS, pronouns: null }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toBeNull();
  });

  it('falls back to DB for all five fields when properties.json is missing', async () => {
    mockRepoPaths({}); // no docs anywhere
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
  });

  it('falls back to DB for all five fields when properties.json is malformed', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ not valid json' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
  });

  it('falls back to DB for all five fields on schema validation failure', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ ...VALID_VAULT_PROPS, talkativeness: 2.0 }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
      talkativeness: 0.5,
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
    expect(result.talkativeness).toBe(0.5);
  });
});

describe('applyDocumentStoreOverlay — description.md and personality.md overlays', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides description.md content', async () => {
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBe('vault-description');
  });

  it('maps empty description.md to null (clearing the field)', async () => {
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [{ mountPointId: 'mp-1', content: '' }],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBeNull();
  });

  it('overrides personality.md content', async () => {
    mockRepoPaths({
      [CHARACTER_PERSONALITY_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-personality' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      personality: 'db-personality',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.personality).toBe('vault-personality');
  });

  it('does not touch description or personality when those files are missing', async () => {
    mockRepoPaths({});
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
      personality: 'db-personality',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBe('db-description');
    expect(result.personality).toBe('db-personality');
  });
});

describe('applyDocumentStoreOverlay — physical-description.md / physical-prompts.json', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides physicalDescriptions[0].fullDescription from physical-description.md', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [
        makePhysicalDescription({ id: 'pd-1', fullDescription: 'db-full' }),
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].fullDescription).toBe('vault-full-description');
    expect(result.physicalDescriptions[0].id).toBe('pd-1');
  });

  it('overrides the four prompt tiers from physical-prompts.json', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [makePhysicalDescription({ id: 'pd-1' })],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].shortPrompt).toBe('vault-short');
    expect(result.physicalDescriptions[0].mediumPrompt).toBe('vault-medium');
    expect(result.physicalDescriptions[0].longPrompt).toBe('vault-long');
    expect(result.physicalDescriptions[0].completePrompt).toBe('vault-complete');
  });

  it('accepts null prompt values from physical-prompts.json (null means null)', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ short: null, medium: null, long: null, complete: null }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [makePhysicalDescription({ id: 'pd-1' })],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].shortPrompt).toBeNull();
    expect(result.physicalDescriptions[0].completePrompt).toBeNull();
  });

  it('leaves prompts from DB when physical-prompts.json is malformed JSON', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ not json' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [makePhysicalDescription({ id: 'pd-1', shortPrompt: 'db-short' })],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].shortPrompt).toBe('db-short');
  });

  it('leaves prompts from DB when physical-prompts.json fails schema validation', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify({ short: 42 }) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [makePhysicalDescription({ id: 'pd-1', shortPrompt: 'db-short' })],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].shortPrompt).toBe('db-short');
  });

  it('preserves subsequent physical descriptions (only index 0 is patched)', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [
        makePhysicalDescription({ id: 'pd-1', fullDescription: 'db-full' }),
        makePhysicalDescription({ id: 'pd-2', fullDescription: 'other-db-full' }),
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions).toHaveLength(2);
    expect(result.physicalDescriptions[0].fullDescription).toBe('vault-full');
    expect(result.physicalDescriptions[1].fullDescription).toBe('other-db-full');
  });

  it('skips physical overlay when the character has no physicalDescriptions', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full' },
      ],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions).toEqual([]);
  });
});

describe('applyDocumentStoreOverlay — per-file independence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies description.md overlay even when properties.json is missing', async () => {
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
    expect(result.description).toBe('vault-description');
  });

  it('applies physical-description.md overlay even when physical-prompts.json is invalid', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full' },
      ],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ broken' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      physicalDescriptions: [
        makePhysicalDescription({ id: 'pd-1', fullDescription: 'db-full', shortPrompt: 'db-short' }),
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescriptions[0].fullDescription).toBe('vault-full');
    expect(result.physicalDescriptions[0].shortPrompt).toBe('db-short'); // not overridden
  });
});

describe('applyDocumentStoreOverlay — batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('makes one query per overlay path, regardless of candidate count', async () => {
    const findMany = mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-a' }) },
        { mountPointId: 'mp-2', content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-b' }) },
      ],
    });

    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-1' }),
      makeCharacter({ id: 'b', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-2' }),
      makeCharacter({ id: 'c', readPropertiesFromDocumentStore: false }),
    ];

    const result = await applyDocumentStoreOverlay(chars);
    // 5 overlay paths: properties.json, description.md, personality.md,
    // physical-description.md, physical-prompts.json
    expect(findMany).toHaveBeenCalledTimes(5);
    expect(result[0].title).toBe('vault-a');
    expect(result[1].title).toBe('vault-b');
    expect(result[2].title).toBe('db-title');
  });

  it('deduplicates mount point ids in each query', async () => {
    const findMany = mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-shared', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
      makeCharacter({ id: 'b', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
    ];
    await applyDocumentStoreOverlay(chars);
    const propsCall = findMany.mock.calls.find(([, path]) => path === CHARACTER_PROPERTIES_JSON_PATH);
    expect(propsCall).toBeDefined();
    expect(propsCall![0]).toEqual(['mp-shared']);
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
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
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
    readDatabaseDocumentMock.mockResolvedValue({ content: 'not json', mtime: 0, size: 10 });
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

describe('readCharacterVaultDescription / readCharacterVaultPersonality / readCharacterVaultPhysicalDescription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns raw text when the file exists', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: 'hello from the vault',
      mtime: 0,
      size: 10,
    });
    const result = await readCharacterVaultDescription('mp-1', 'char-a');
    expect(result).toBe('hello from the vault');
  });

  it('returns the empty string when the file exists but is empty', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: '', mtime: 0, size: 0 });
    const result = await readCharacterVaultPersonality('mp-1', 'char-a');
    expect(result).toBe('');
  });

  it('returns null when the file is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultPhysicalDescription('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on generic read errors', async () => {
    readDatabaseDocumentMock.mockRejectedValue(new Error('io error'));
    const result = await readCharacterVaultDescription('mp-1', 'char-a');
    expect(result).toBeNull();
  });
});

describe('readCharacterVaultPhysicalPrompts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed prompts on a clean read', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toEqual(VALID_VAULT_PHYSICAL_PROMPTS);
  });

  it('accepts null fields', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ short: null, medium: null, long: null, complete: null }),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toEqual({ short: null, medium: null, long: null, complete: null });
  });

  it('returns null on malformed JSON', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: 'not json', mtime: 0, size: 10 });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on schema validation failure', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ short: 42 }),
      mtime: 0,
      size: 10,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null when the file is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
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

describe('CharacterVaultPhysicalPromptsSchema', () => {
  it('accepts all-string values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse(VALID_VAULT_PHYSICAL_PROMPTS);
    expect(parsed.success).toBe(true);
  });

  it('accepts all-null values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({
      short: null,
      medium: null,
      long: null,
      complete: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('requires all four fields', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({ short: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-string non-null values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({
      short: 42,
      medium: null,
      long: null,
      complete: null,
    });
    expect(parsed.success).toBe(false);
  });
});
