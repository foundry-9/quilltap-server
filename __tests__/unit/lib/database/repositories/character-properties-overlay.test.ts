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
    // 6 single-file overlay paths: properties.json, description.md, personality.md,
    // example-dialogues.md, physical-description.md, physical-prompts.json
    expect(findManyByMountPointsAndPath).toHaveBeenCalledTimes(6);
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
      outfitPresets: [],
    });

    expect(result.physicalSkippedNoPrimary).toBe(false);
    expect(result.singleFileWriteCount).toBe(6);

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

    const wardrobe = JSON.parse(getWrite('wardrobe.json')!);
    expect(wardrobe).toEqual({
      items: [],
      presets: [],
      outfit: { top: null, bottom: null, footwear: null, accessories: null },
    });
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
      outfitPresets: [],
    });

    expect(result.physicalSkippedNoPrimary).toBe(true);
    expect(result.singleFileWriteCount).toBe(4);

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
      outfitPresets: [],
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
      outfitPresets: [],
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
      outfitPresets: [],
    });

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(deletedPaths).toContain(`${CHARACTER_PROMPTS_FOLDER}/Old.md`);
    expect(deletedPaths).toContain(`${CHARACTER_SCENARIOS_FOLDER}/Old Scene.md`);
  });

  it('writes wardrobe items and presets as the vault wardrobe.json payload with an outfit placeholder', async () => {
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
        appropriateness: null,
        isDefault: true,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const outfitPresets = [
      {
        id: 'preset-1',
        characterId: 'char-wardrobe',
        name: 'Garden Party',
        description: null,
        slots: { top: 'item-1', bottom: null, footwear: null, accessories: null },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = await writeCharacterVaultManagedFields('mount-6', {
      character,
      wardrobeItems,
      outfitPresets,
    });

    expect(result.wardrobeItemsWritten).toBe(1);
    expect(result.outfitPresetsWritten).toBe(1);

    const wardrobe = JSON.parse(getWrite('wardrobe.json')!);
    expect(wardrobe.items).toEqual(wardrobeItems);
    expect(wardrobe.presets).toEqual(outfitPresets);
    expect(wardrobe.outfit).toEqual({ top: null, bottom: null, footwear: null, accessories: null });
  });
});
