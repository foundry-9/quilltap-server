/**
 * Unit tests for lib/database/repositories/character-properties-overlay.ts
 *
 * Strategy: Mock getRepositories, readDatabaseDocument, and the logger.
 * No real database. Tests cover per-file overlay behavior across all eight
 * vault targets (properties.json, description.md, personality.md,
 * example-dialogues.md, physical-description.md, physical-prompts.json,
 * Prompts/*.md, Scenarios/*.md), per-file fallback semantics, and batching.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

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

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  deleteDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
  readCharacterVaultProperties,
  readCharacterVaultDescription,
  readCharacterVaultPersonality,
  readCharacterVaultExampleDialogues,
  readCharacterVaultPhysicalDescription,
  readCharacterVaultPhysicalPrompts,
  readCharacterVaultSystemPrompts,
  readCharacterVaultScenarios,
  writeCharacterVaultManagedFields,
  syncCharacterVaultWardrobe,
  readCharacterVaultWardrobe,
  CharacterVaultPropertiesSchema,
  CharacterVaultPhysicalPromptsSchema,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
} from '@/lib/database/repositories/character-properties-overlay';
import type { Character, PhysicalDescription } from '@/lib/schemas/types';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readDatabaseDocumentMock = readDatabaseDocument as jest.MockedFunction<typeof readDatabaseDocument>;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.MockedFunction<typeof writeDatabaseDocument>;
const deleteDatabaseDocumentMock = deleteDatabaseDocument as jest.MockedFunction<typeof deleteDatabaseDocument>;

function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-default',
    userId: 'user-1',
    name: 'Default',
    title: 'db-title',
    description: 'db-description',
    personality: 'db-personality',
    exampleDialogues: 'db-dialogues',
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

type SingleFileDoc = { mountPointId: string; content: string };
type FolderDoc = {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Mock repos with per-path documents plus per-folder documents. `docsByPath`
 * maps a single-file vault path (e.g. 'properties.json') to the docs that
 * findManyByMountPointsAndPath should return. `docsByFolder` maps a folder
 * name (e.g. 'Prompts') to the docs that findManyByMountPointsInFolder
 * should return. Unset keys resolve to [].
 */
function mockRepoPaths(
  docsByPath: Record<string, SingleFileDoc[]> = {},
  docsByFolder: Record<string, FolderDoc[]> = {},
) {
  const findManyByMountPointsAndPath = jest
    .fn()
    .mockImplementation((_ids: string[], path: string) =>
      Promise.resolve(docsByPath[path] ?? []),
    );
  const findManyByMountPointsInFolder = jest
    .fn()
    .mockImplementation((_ids: string[], folder: string) =>
      Promise.resolve(
        (docsByFolder[folder] ?? []).map((d) => ({
          id: 'doc-' + d.relativePath,
          fileType: 'markdown' as const,
          contentSha256: 'x'.repeat(64),
          plainTextLength: d.content.length,
          folderId: null,
          lastModified: 0,
          createdAt: d.createdAt ?? '2026-01-01T00:00:00.000Z',
          updatedAt: d.updatedAt ?? '2026-01-01T00:00:00.000Z',
          ...d,
        })),
      ),
    );
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: {
      findManyByMountPointsAndPath,
      findManyByMountPointsInFolder,
    },
  });
  return { findManyByMountPointsAndPath, findManyByMountPointsInFolder };
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

describe('applyDocumentStoreOverlay — example-dialogues.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides example-dialogues.md content', async () => {
    mockRepoPaths({
      [CHARACTER_EXAMPLE_DIALOGUES_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-dialogues' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBe('vault-dialogues');
  });

  it('maps an empty example-dialogues.md to null (the valid "no examples" state)', async () => {
    mockRepoPaths({
      [CHARACTER_EXAMPLE_DIALOGUES_MD_PATH]: [
        { mountPointId: 'mp-1', content: '' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBeNull();
  });

  it('falls back to DB when example-dialogues.md is missing', async () => {
    mockRepoPaths({});
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBe('db-dialogues');
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

describe('applyDocumentStoreOverlay — Prompts/*.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const promptFileContent = (name: string, body: string, isDefault = false) =>
    `---\nname: ${name}\n${isDefault ? 'isDefault: true\n' : ''}---\n\n${body}`;

  it('synthesizes systemPrompts from vault files with YAML frontmatter', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body prose.', true),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body prose.'),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'db-prompt',
          content: 'db content',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toHaveLength(2);
    expect(result.systemPrompts.map(p => p.name)).toEqual(['Alpha', 'Beta']);
    expect(result.systemPrompts[0].content).toBe('Alpha body prose.');
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('promotes first alphabetically when no file is marked isDefault', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body.'),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body.'),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // Alphabetic sort puts Alpha first; Alpha is promoted to default
    expect(result.systemPrompts[0].name).toBe('Alpha');
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('keeps only the first isDefault when multiple are marked', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body.', true),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body.', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('skips files without YAML frontmatter, keeps others', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/NoFrontmatter.md',
          fileName: 'NoFrontmatter.md',
          content: 'Just body, no frontmatter at all.',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Good.md',
          fileName: 'Good.md',
          content: promptFileContent('Good', 'Good body.', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toHaveLength(1);
    expect(result.systemPrompts[0].name).toBe('Good');
  });

  it('skips files whose frontmatter lacks a name', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/NoName.md',
          fileName: 'NoName.md',
          content: `---\nisDefault: true\n---\n\nBody text here.`,
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'db-prompt',
          content: 'db body',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // All files invalid; no overlay applied, DB passes through
    expect(result.systemPrompts).toHaveLength(1);
    expect(result.systemPrompts[0].name).toBe('db-prompt');
  });

  it('falls back to DB when Prompts/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'db-only',
          content: 'db body',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts[0].name).toBe('db-only');
  });

  it('synthesizes stable IDs across repeated reads', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Stable.md',
          fileName: 'Stable.md',
          content: promptFileContent('Stable', 'body', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [first] = await applyDocumentStoreOverlay([char]);
    const [second] = await applyDocumentStoreOverlay([char]);
    expect(first.systemPrompts[0].id).toBe(second.systemPrompts[0].id);
    // Valid UUID format
    expect(first.systemPrompts[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('applyDocumentStoreOverlay — Scenarios/*.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('synthesizes scenarios from vault files using # heading as title', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Morning.md',
          fileName: 'Morning.md',
          content: '# Good Morning\n\nBody of the morning scenario.',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Evening.md',
          fileName: 'Evening.md',
          content: '# Evening\n\nEvening scenario body.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // Alphabetic sort by relativePath: Evening before Morning
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].title).toBe('Evening');
    expect(result.scenarios[0].content).toBe('Evening scenario body.');
    expect(result.scenarios[1].title).toBe('Good Morning');
  });

  it('falls back to filename when the file has no # heading', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/MissingHeading.md',
          fileName: 'MissingHeading.md',
          content: 'Body text without a heading line.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].title).toBe('MissingHeading');
    expect(result.scenarios[0].content).toBe('Body text without a heading line.');
  });

  it('falls back to DB when the Scenarios/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
      scenarios: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          title: 'db-scenario',
          content: 'db body',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios[0].title).toBe('db-scenario');
  });

  it('skips files with no body content', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Empty.md',
          fileName: 'Empty.md',
          content: '# Empty\n\n',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Full.md',
          fileName: 'Full.md',
          content: '# Full\n\nHas body.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].title).toBe('Full');
  });

  it('synthesizes stable IDs across repeated reads', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/One.md',
          fileName: 'One.md',
          content: '# One\n\nBody.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mp-1',
    });
    const [first] = await applyDocumentStoreOverlay([char]);
    const [second] = await applyDocumentStoreOverlay([char]);
    expect(first.scenarios[0].id).toBe(second.scenarios[0].id);
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

  it('issues one query per single-file path and one per folder, regardless of candidate count', async () => {
    const { findManyByMountPointsAndPath, findManyByMountPointsInFolder } = mockRepoPaths({
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
    // 8 single-file overlay paths: properties.json, identity.md, description.md,
    // manifesto.md, personality.md, example-dialogues.md, physical-description.md, physical-prompts.json
    expect(findManyByMountPointsAndPath).toHaveBeenCalledTimes(8);
    // 2 directory overlays: Prompts, Scenarios
    expect(findManyByMountPointsInFolder).toHaveBeenCalledTimes(2);
    expect(result[0].title).toBe('vault-a');
    expect(result[1].title).toBe('vault-b');
    expect(result[2].title).toBe('db-title');
  });

  it('deduplicates mount point ids in each query', async () => {
    const { findManyByMountPointsAndPath } = mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-shared', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
    const chars = [
      makeCharacter({ id: 'a', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
      makeCharacter({ id: 'b', readPropertiesFromDocumentStore: true, characterDocumentMountPointId: 'mp-shared' }),
    ];
    await applyDocumentStoreOverlay(chars);
    const propsCall = findManyByMountPointsAndPath.mock.calls.find(
      ([, path]) => path === CHARACTER_PROPERTIES_JSON_PATH,
    );
    expect(propsCall).toBeDefined();
    expect(propsCall![0]).toEqual(['mp-shared']);
  });

  it('falls back gracefully when the repository throws', async () => {
    const findManyByMountPointsAndPath = jest.fn().mockRejectedValue(new Error('db exploded'));
    const findManyByMountPointsInFolder = jest.fn().mockResolvedValue([]);
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: { findManyByMountPointsAndPath, findManyByMountPointsInFolder },
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

describe('readCharacterVaultDescription / readCharacterVaultPersonality / readCharacterVaultExampleDialogues / readCharacterVaultPhysicalDescription', () => {
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

  it('readCharacterVaultExampleDialogues returns raw text when the file exists', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: '{{user}}: Hi\n{{char}}: Hello.',
      mtime: 0,
      size: 20,
    });
    const result = await readCharacterVaultExampleDialogues('mp-1', 'char-a');
    expect(result).toBe('{{user}}: Hi\n{{char}}: Hello.');
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

describe('readCharacterVaultSystemPrompts / readCharacterVaultScenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enumerates Prompts/*.md and returns parsed entries', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: `---\nname: Alpha\nisDefault: true\n---\n\nAlpha body.`,
        },
      ],
    });
    const result = await readCharacterVaultSystemPrompts('mp-1', 'char-a');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alpha');
    expect(result[0].isDefault).toBe(true);
  });

  it('returns [] when the Prompts/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const result = await readCharacterVaultSystemPrompts('mp-1', 'char-a');
    expect(result).toEqual([]);
  });

  it('enumerates Scenarios/*.md and returns parsed entries', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Wakeup.md',
          fileName: 'Wakeup.md',
          content: '# Wakeup\n\nBody.',
        },
      ],
    });
    const result = await readCharacterVaultScenarios('mp-1', 'char-a');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Wakeup');
  });

  it('returns [] when the Scenarios/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const result = await readCharacterVaultScenarios('mp-1', 'char-a');
    expect(result).toEqual([]);
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

describe('writeCharacterVaultManagedFields — sync DB → vault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepoPaths({}, {});
  });

  function getWrite(path: string): string | undefined {
    const call = writeDatabaseDocumentMock.mock.calls.find(
      ([, relPath]) => relPath === path,
    );
    return call ? (call[2] as string) : undefined;
  }

  it('writes every single-file vault target for a character with a primary physical description', async () => {
    const character = makeCharacter({
      id: 'char-sync',
      pronouns: { subject: 'they', object: 'them', possessive: 'their' },
      aliases: ['Nick', 'Nicky'],
      title: 'Detective',
      firstMessage: 'Hello there.',
      talkativeness: 0.7,
      description: 'DB desc',
      personality: 'DB personality',
      exampleDialogues: 'DB dialogues',
      physicalDescriptions: [
        {
          id: 'phys-1',
          name: 'primary',
          fullDescription: 'primary full',
          shortPrompt: 'short',
          mediumPrompt: 'medium',
          longPrompt: 'long',
          completePrompt: 'complete',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      systemPrompts: [],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-1', {
      character,
      wardrobeItems: [],
    });

    expect(result.physicalSkippedNoPrimary).toBe(false);
    expect(result.singleFileWriteCount).toBe(8);

    const props = JSON.parse(getWrite(CHARACTER_PROPERTIES_JSON_PATH)!);
    expect(props).toEqual({
      pronouns: { subject: 'they', object: 'them', possessive: 'their' },
      aliases: ['Nick', 'Nicky'],
      title: 'Detective',
      firstMessage: 'Hello there.',
      talkativeness: 0.7,
      systemTransparency: null,
    });

    expect(getWrite(CHARACTER_DESCRIPTION_MD_PATH)).toBe('DB desc');
    expect(getWrite(CHARACTER_PERSONALITY_MD_PATH)).toBe('DB personality');
    expect(getWrite(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)).toBe('DB dialogues');
    expect(getWrite(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)).toBe('primary full');

    const physPrompts = JSON.parse(getWrite(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!);
    expect(physPrompts).toEqual({
      short: 'short',
      medium: 'medium',
      long: 'long',
      complete: 'complete',
    });

    // No items, no presets → no Wardrobe/*.md or Outfits/*.md writes, and the
    // legacy wardrobe.json must never be re-seeded.
    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(writtenPaths.some((p) => p.startsWith('Wardrobe/'))).toBe(false);
    expect(writtenPaths.some((p) => p.startsWith('Outfits/'))).toBe(false);
  });

  it('writes empty strings / nulls through for characters with sparse fields', async () => {
    const character = makeCharacter({
      id: 'char-sparse',
      description: null,
      personality: null,
      exampleDialogues: null,
      title: null,
      firstMessage: null,
      aliases: [],
      pronouns: null,
      physicalDescriptions: [],
      systemPrompts: [],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-2', {
      character,
      wardrobeItems: [],
    });

    expect(result.physicalSkippedNoPrimary).toBe(true);
    expect(result.singleFileWriteCount).toBe(6);

    const props = JSON.parse(getWrite(CHARACTER_PROPERTIES_JSON_PATH)!);
    expect(props).toEqual({
      pronouns: null,
      aliases: [],
      title: null,
      firstMessage: null,
      talkativeness: 0.5,
      systemTransparency: null,
    });
    expect(getWrite(CHARACTER_DESCRIPTION_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_PERSONALITY_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)).toBeUndefined();
    expect(getWrite(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)).toBeUndefined();
  });

  it('projects systemPrompts into Prompts/*.md with YAML frontmatter and marks the default', async () => {
    const character = makeCharacter({
      id: 'char-prompts',
      physicalDescriptions: [],
      systemPrompts: [
        {
          id: 'p1',
          name: 'Courtly',
          content: 'Speak formally.',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Casual',
          content: 'Speak casually.',
          isDefault: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-3', {
      character,
      wardrobeItems: [],
    });

    expect(result.systemPromptsWritten).toBe(2);

    const courtly = getWrite(`${CHARACTER_PROMPTS_FOLDER}/Courtly.md`);
    const casual = getWrite(`${CHARACTER_PROMPTS_FOLDER}/Casual.md`);
    expect(courtly).toBeDefined();
    expect(casual).toBeDefined();
    expect(courtly).toContain('name: Courtly');
    expect(courtly).toContain('isDefault: true');
    expect(courtly).toContain('Speak formally.');
    expect(casual).not.toContain('isDefault');
    expect(casual).toContain('Speak casually.');
  });

  it('projects scenarios into Scenarios/*.md with a # heading title', async () => {
    const character = makeCharacter({
      id: 'char-scenarios',
      physicalDescriptions: [],
      systemPrompts: [],
      scenarios: [
        {
          id: 's1',
          title: 'The Drawing Room',
          content: 'A quiet gathering on a Tuesday afternoon.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await writeCharacterVaultManagedFields('mount-4', {
      character,
      wardrobeItems: [],
    });

    expect(result.scenariosWritten).toBe(1);
    const scenarioFile = getWrite(`${CHARACTER_SCENARIOS_FOLDER}/The Drawing Room.md`);
    expect(scenarioFile).toBe('# The Drawing Room\n\nA quiet gathering on a Tuesday afternoon.');
  });

  it('deletes stale files in Prompts/ and Scenarios/ that no longer correspond to a DB entry', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mount-5',
          relativePath: `${CHARACTER_PROMPTS_FOLDER}/Old.md`,
          fileName: 'Old.md',
          content: 'stale',
        },
      ],
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mount-5',
          relativePath: `${CHARACTER_SCENARIOS_FOLDER}/Old Scene.md`,
          fileName: 'Old Scene.md',
          content: 'stale',
        },
      ],
    });

    const character = makeCharacter({
      id: 'char-stale',
      physicalDescriptions: [],
      systemPrompts: [
        {
          id: 'p-new',
          name: 'New',
          content: 'Fresh.',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      scenarios: [
        {
          id: 's-new',
          title: 'New Scene',
          content: 'Fresh scenario.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await writeCharacterVaultManagedFields('mount-5', {
      character,
      wardrobeItems: [],
    });

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(deletedPaths).toContain(`${CHARACTER_PROMPTS_FOLDER}/Old.md`);
    expect(deletedPaths).toContain(`${CHARACTER_SCENARIOS_FOLDER}/Old Scene.md`);
  });

  it('projects leaf wardrobe items into Wardrobe/*.md with frontmatter and freeform body', async () => {
    const character = makeCharacter({
      id: 'char-wardrobe',
      physicalDescriptions: [],
      systemPrompts: [],
      scenarios: [],
    });

    const wardrobeItems = [
      {
        id: 'item-1',
        characterId: 'char-wardrobe',
        title: 'Linen Jacket',
        description: 'Cream linen with ivory buttons.',
        types: ['top' as const],
        componentItemIds: [],
        appropriateness: null,
        isDefault: true,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = await writeCharacterVaultManagedFields('mount-6', {
      character,
      wardrobeItems,
    });

    expect(result.wardrobeItemsWritten).toBe(1);

    // The retired Outfits/ folder is no longer projected — composites fold
    // into Wardrobe/*.md. The legacy wardrobe.json must never be re-seeded.
    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(writtenPaths.some((p) => p.startsWith('Outfits/'))).toBe(false);

    const itemFile = getWrite('Wardrobe/Linen Jacket.md');
    expect(itemFile).toBeDefined();
    expect(itemFile).toContain('id: item-1');
    expect(itemFile).toContain('title: Linen Jacket');
    expect(itemFile).toContain('- top');
    expect(itemFile).toContain('default: true');
    expect(itemFile).toContain('Cream linen with ivory buttons.');
    // Leaf items don't carry a `componentItems:` array.
    expect(itemFile).not.toContain('componentItems:');
  });

  it('projects composite wardrobe items with a componentItems: slug array in frontmatter', async () => {
    // A composite "Rain Outfit" references three leaf items by id; the writer
    // should translate those ids to slugs (kebab-case from the leaf titles)
    // when emitting the frontmatter, so vault hand-edits are friendlier.
    const character = makeCharacter({
      id: 'char-composite',
      physicalDescriptions: [],
      systemPrompts: [],
      scenarios: [],
    });

    const raincoat = {
      id: 'raincoat-1',
      characterId: 'char-composite',
      title: 'Yellow Raincoat',
      description: null,
      types: ['top' as const],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const jeans = { ...raincoat, id: 'jeans-1', title: 'Blue Jeans', types: ['bottom' as const] };
    const wellies = { ...raincoat, id: 'wellies-1', title: 'Wellies', types: ['footwear' as const] };
    const rainOutfit = {
      id: 'rain-outfit',
      characterId: 'char-composite',
      title: 'Rain Outfit',
      description: 'Bundle for a rainy day.',
      types: ['top' as const, 'bottom' as const, 'footwear' as const],
      componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      appropriateness: null,
      isDefault: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const result = await writeCharacterVaultManagedFields('mount-7', {
      character,
      wardrobeItems: [raincoat, jeans, wellies, rainOutfit],
    });

    expect(result.wardrobeItemsWritten).toBe(4);

    const compositeFile = getWrite('Wardrobe/Rain Outfit.md');
    expect(compositeFile).toBeDefined();
    expect(compositeFile).toContain('id: rain-outfit');
    expect(compositeFile).toContain('title: Rain Outfit');
    // componentItems is emitted as the slug array, in declared order.
    expect(compositeFile).toContain('componentItems:');
    expect(compositeFile).toContain('- yellow-raincoat');
    expect(compositeFile).toContain('- blue-jeans');
    expect(compositeFile).toContain('- wellies');
    expect(compositeFile).toContain('Bundle for a rainy day.');
  });
});

describe('syncCharacterVaultWardrobe — vault-only items', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regression: a wardrobe Markdown file written via Document Mode (no DB
  // row) used to be deleted on the next sync, because the projection treated
  // the DB-only list as authoritative and swept any unmanaged file. Now the
  // sync ingests vault-only items into the DB before projecting, so the file
  // survives and the equip handler's deterministic UUID still resolves.
  it('promotes a vault-only wardrobe item into the DB instead of deleting its file', async () => {
    // The mocked DB starts empty; createFromVault appends so the subsequent
    // findByCharacterIdRaw call inside the projection step sees the promoted
    // item and the projection re-writes its file instead of sweeping it.
    const dbItems: any[] = [];
    const findByCharacterIdRaw = jest.fn(async () => dbItems.slice());
    const createFromVault = jest.fn(async (item) => {
      dbItems.push(item);
      return item;
    });
    const findByIdRaw = jest.fn().mockResolvedValue({
      id: 'gary',
      readPropertiesFromDocumentStore: true,
      characterDocumentMountPointId: 'mount-gary',
    });

    const findManyByMountPointsInFolder = jest
      .fn()
      .mockImplementation((_ids: string[], folder: string) => {
        if (folder === 'Wardrobe') {
          return Promise.resolve([
            {
              id: 'doc-dressing-gown',
              mountPointId: 'mount-gary',
              relativePath: 'Wardrobe/Dressing Gown.md',
              fileName: 'Dressing Gown.md',
              fileType: 'markdown',
              contentSha256: 'x'.repeat(64),
              plainTextLength: 100,
              folderId: null,
              lastModified: 0,
              createdAt: '2026-04-26T22:01:00.000Z',
              updatedAt: '2026-04-26T22:06:00.000Z',
              content: [
                '---',
                'title: Dressing Gown',
                'types:',
                '- top',
                '- bottom',
                'appropriateness: casual, around the house',
                '---',
                '',
                'A silk dressing gown with a sash to tie it.',
              ].join('\n'),
            },
          ]);
        }
        return Promise.resolve([]);
      });

    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder,
      },
      characters: { findByIdRaw },
      wardrobe: {
        findByCharacterIdRaw,
        createFromVault,
      },
    });

    await syncCharacterVaultWardrobe('gary');

    // The vault-only Dressing Gown was promoted into the DB.
    expect(createFromVault).toHaveBeenCalledTimes(1);
    expect(createFromVault).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Dressing Gown',
        types: ['top', 'bottom'],
        characterId: 'gary',
      }),
    );

    // And the projection step did not sweep the file away.
    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(deletedPaths).not.toContain('Wardrobe/Dressing Gown.md');
  });

  it('skips ingestion when every vault item already has a DB row', async () => {
    const existingItemId = 'a1b2c3d4-e5f6-4789-aabb-ccddeeff0011';
    const existingItem = {
      id: existingItemId,
      characterId: 'gary',
      title: 'Velvet Robe',
      description: null,
      types: ['top' as const, 'bottom' as const],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    };
    const findByCharacterIdRaw = jest.fn().mockResolvedValue([existingItem]);
    const createFromVault = jest.fn();

    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder: jest
          .fn()
          .mockImplementation((_ids: string[], folder: string) => {
            if (folder === 'Wardrobe') {
              return Promise.resolve([
                {
                  id: 'doc-velvet',
                  mountPointId: 'mount-gary',
                  relativePath: 'Wardrobe/Velvet Robe.md',
                  fileName: 'Velvet Robe.md',
                  fileType: 'markdown',
                  contentSha256: 'x'.repeat(64),
                  plainTextLength: 50,
                  folderId: null,
                  lastModified: 0,
                  createdAt: '2026-04-26T00:00:00.000Z',
                  updatedAt: '2026-04-26T00:00:00.000Z',
                  content: [
                    '---',
                    `id: ${existingItemId}`,
                    'title: Velvet Robe',
                    'types:',
                    '- top',
                    '- bottom',
                    '---',
                    '',
                  ].join('\n'),
                },
              ]);
            }
            return Promise.resolve([]);
          }),
      },
      characters: {
        findByIdRaw: jest.fn().mockResolvedValue({
          id: 'gary',
          readPropertiesFromDocumentStore: true,
          characterDocumentMountPointId: 'mount-gary',
        }),
      },
      wardrobe: {
        findByCharacterIdRaw,
        createFromVault,
      },
    });

    await syncCharacterVaultWardrobe('gary');

    expect(createFromVault).not.toHaveBeenCalled();
  });

  // Regression: deleting a wardrobe item from a vault-overlay character used
  // to be a no-op. The DB row was removed, then the post-write sync's
  // ingestion step saw a vault file with no DB row and re-created the row
  // (preserving the same id) via createFromVault, leaving the projection
  // step nothing to sweep. Now the delete path passes the deleted id as a
  // tombstone via excludeIds: ingestion skips it, the projection treats the
  // file as unmanaged, and the file is deleted.
  it('skips ingestion for tombstoned ids and lets the projection sweep their files', async () => {
    const tombstonedId = 'b1c2d3e4-f5a6-4789-aabb-ccddeeff0099';
    const findByCharacterIdRaw = jest.fn().mockResolvedValue([]);
    const createFromVault = jest.fn();

    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder: jest
          .fn()
          .mockImplementation((_ids: string[], folder: string) => {
            if (folder === 'Wardrobe') {
              return Promise.resolve([
                {
                  id: 'doc-tombstoned',
                  mountPointId: 'mount-gary',
                  relativePath: 'Wardrobe/Tombstoned Shirt.md',
                  fileName: 'Tombstoned Shirt.md',
                  fileType: 'markdown',
                  contentSha256: 'x'.repeat(64),
                  plainTextLength: 50,
                  folderId: null,
                  lastModified: 0,
                  createdAt: '2026-04-26T00:00:00.000Z',
                  updatedAt: '2026-04-26T00:00:00.000Z',
                  content: [
                    '---',
                    `id: ${tombstonedId}`,
                    'title: Tombstoned Shirt',
                    'types:',
                    '- top',
                    '---',
                    '',
                  ].join('\n'),
                },
              ]);
            }
            return Promise.resolve([]);
          }),
      },
      characters: {
        findByIdRaw: jest.fn().mockResolvedValue({
          id: 'gary',
          readPropertiesFromDocumentStore: true,
          characterDocumentMountPointId: 'mount-gary',
        }),
      },
      wardrobe: {
        findByCharacterIdRaw,
        createFromVault,
      },
    });

    await syncCharacterVaultWardrobe('gary', new Set([tombstonedId]));

    // Tombstoned id was not promoted into the DB.
    expect(createFromVault).not.toHaveBeenCalled();

    // And the projection step deleted the tombstoned vault file.
    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(deletedPaths).toContain('Wardrobe/Tombstoned Shirt.md');
  });
});

describe('readCharacterVaultWardrobe — componentItems frontmatter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Helper: build a vault doc shaped like docMountDocuments.findManyByMountPointsInFolder returns. */
  function vaultDoc(
    mountPointId: string,
    fileName: string,
    body: string,
    overrides: Partial<{
      createdAt: string;
      updatedAt: string;
    }> = {},
  ) {
    return {
      id: 'doc-' + fileName,
      mountPointId,
      relativePath: `Wardrobe/${fileName}`,
      fileName,
      fileType: 'markdown' as const,
      contentSha256: 'x'.repeat(64),
      plainTextLength: body.length,
      folderId: null,
      lastModified: 0,
      createdAt: overrides.createdAt ?? '2026-04-26T00:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-04-26T00:00:00.000Z',
      content: body,
    };
  }

  function setupVault(docs: ReturnType<typeof vaultDoc>[]) {
    const findManyByMountPointsInFolder = jest
      .fn()
      .mockImplementation((_ids: string[], folder: string) => {
        if (folder === 'Wardrobe') return Promise.resolve(docs);
        return Promise.resolve([]);
      });
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder,
      },
      wardrobe: {
        findArchetypes: jest.fn().mockResolvedValue([]),
      },
    });
    return { findManyByMountPointsInFolder };
  }

  it('resolves componentItems: slug refs to canonical UUIDs from sibling Wardrobe files', async () => {
    // Two leaf items + a composite that references them by slug. The reader
    // should resolve the slugs to the leaf items' UUIDs.
    const earringsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const lockectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const compositeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    setupVault([
      vaultDoc(
        'mount-a',
        'Pearl Earrings.md',
        ['---', `id: ${earringsId}`, 'title: Pearl Earrings', 'types:', '- accessories', '---', '', 'Lustrous.'].join(
          '\n',
        ),
      ),
      vaultDoc(
        'mount-a',
        'Gold Locket.md',
        ['---', `id: ${lockectId}`, 'title: Gold Locket', 'types:', '- accessories', '---', '', 'Heirloom.'].join(
          '\n',
        ),
      ),
      vaultDoc(
        'mount-a',
        'Nice Jewelry.md',
        [
          '---',
          `id: ${compositeId}`,
          'title: Nice Jewelry',
          'types:',
          '- accessories',
          'componentItems:',
          '- pearl-earrings',
          '- gold-locket',
          '---',
          '',
          'Set.',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-a', 'char-a');
    expect(result).not.toBeNull();
    const composite = result!.items.find((i) => i.id === compositeId);
    expect(composite).toBeDefined();
    expect(composite!.componentItemIds).toEqual([earringsId, lockectId]);
  });

  it('drops a self-cycle in componentItems: but keeps the item itself', async () => {
    // A composite that lists its own slug as a component must be tolerated —
    // the bad ref is dropped, the item stays.
    const itemId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    setupVault([
      vaultDoc(
        'mount-b',
        'Self Hugger.md',
        [
          '---',
          `id: ${itemId}`,
          'title: Self Hugger',
          'types:',
          '- top',
          'componentItems:',
          '- self-hugger',
          '---',
          '',
          'Curiously self-referential.',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-b', 'char-b');
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    // The cycle was detected → componentItemIds wiped, item itself preserved.
    expect(result!.items[0].componentItemIds).toEqual([]);
    expect(result!.items[0].title).toBe('Self Hugger');
  });

  it('drops unknown componentItems: refs but keeps known ones', async () => {
    // Vault hand-edits often include typos; the reader resolves what it can
    // and drops the rest with a log.
    const knownId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const compositeId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    setupVault([
      vaultDoc(
        'mount-c',
        'Known Item.md',
        ['---', `id: ${knownId}`, 'title: Known Item', 'types:', '- top', '---', '', ''].join('\n'),
      ),
      vaultDoc(
        'mount-c',
        'Composite.md',
        [
          '---',
          `id: ${compositeId}`,
          'title: Composite',
          'types:',
          '- top',
          'componentItems:',
          '- known-item',
          '- some-typo-that-doesnt-exist',
          '---',
          '',
          '',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-c', 'char-c');
    const composite = result!.items.find((i) => i.id === compositeId);
    expect(composite!.componentItemIds).toEqual([knownId]);
  });

  it('parses leaf items with no componentItems: as componentItemIds: []', async () => {
    setupVault([
      vaultDoc(
        'mount-d',
        'Plain Jeans.md',
        ['---', 'title: Plain Jeans', 'types:', '- bottom', '---', '', 'Sturdy.'].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-d', 'char-d');
    expect(result!.items[0].componentItemIds).toEqual([]);
  });

  it('resolves componentItems: UUID refs that point at shared archetypes', async () => {
    // A character-owned bundle whose only component is a shared archetype
    // (characterId === null, lives in the DB but not in this character's
    // vault). Without archetype seeding the ref would be dropped and the
    // bundle silently emptied.
    const fitbitId = '4c18725d-70bb-4cd6-a9d3-1f20c4aa8c7d';
    const bundleId = '11111111-2222-4333-8444-555555555555';

    const findManyByMountPointsInFolder = jest
      .fn()
      .mockImplementation((_ids: string[], folder: string) => {
        if (folder === 'Wardrobe') {
          return Promise.resolve([
            vaultDoc(
              'mount-e',
              'Naked Social.md',
              [
                '---',
                `id: ${bundleId}`,
                'title: Naked Social',
                'types:',
                '- accessories',
                'componentItems:',
                `- ${fitbitId}`,
                '---',
                '',
                '',
              ].join('\n'),
            ),
          ]);
        }
        return Promise.resolve([]);
      });
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder,
      },
      wardrobe: {
        findArchetypes: jest.fn().mockResolvedValue([
          {
            id: fitbitId,
            characterId: null,
            title: 'Fitbit',
            description: null,
            types: ['accessories'],
            appropriateness: null,
            isDefault: false,
            componentItemIds: [],
            archivedAt: null,
            migratedFromClothingRecordId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });

    const result = await readCharacterVaultWardrobe('mount-e', 'char-e');
    const bundle = result!.items.find((i) => i.id === bundleId);
    expect(bundle).toBeDefined();
    expect(bundle!.componentItemIds).toEqual([fitbitId]);
  });
});
