/**
 * The character vault layout table (D4 of
 * refactor-character-repository-and-vault.md).
 *
 * Every managed field is described once, in `lib/characters/vault/layout.ts`,
 * and every reader and writer derives from that description. These tests hold
 * the table to the schemas and hold each codec to its own inverse:
 * `render(parse(x)) === x` for every file a fixture character projects to.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

import {
  CHARACTER_VAULT_ENTRIES,
  CHARACTER_VAULT_FILE_ENTRIES,
  CHARACTER_VAULT_COMPOSITE_ENTRIES,
  CHARACTER_VAULT_FOLDER_ENTRIES,
  CHARACTER_VAULT_KEYSTONES,
  CHARACTER_VAULT_KEEP_PATHS,
  CHARACTER_VAULT_FILE_PATHS,
  CHARACTER_VAULT_SEEDS,
  CHARACTER_VAULT_ANCHOR_PATH,
  MANAGED_FIELDS,
  physicalDescriptionIdFor,
} from '@/lib/characters/vault/layout';
import {
  CHARACTER_MANAGED_FIELDS,
  characterManagedDefaults,
  type Character,
} from '@/lib/schemas/character.types';

const MOUNT = '22222222-2222-4222-8222-222222222222';
const CTX = { characterId: '11111111-1111-4111-8111-111111111111', mountPointId: MOUNT };
const NOW = '2026-11-09T00:00:00.000Z';

const FIXTURE: Character = {
  ...characterManagedDefaults(),
  id: CTX.characterId,
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Tess',
  tags: [],
  partnerLinks: [],
  avatarOverrides: [],
  isFavorite: false,
  npc: false,
  controlledBy: 'llm',
  characterDocumentMountPointId: MOUNT,
  createdAt: NOW,
  updatedAt: NOW,
  identity: 'Keeper of the Fairhaven light.',
  description: 'Speaks in short, salt-dried sentences.',
  manifesto: 'You keep the light lit.',
  personality: 'You fear the dark more than the sea.',
  exampleDialogues: '<START>\nTess: Mind the rocks.',
  title: 'the keeper',
  firstMessage: 'You came in on the evening tide.',
  talkativeness: 0.7,
  aliases: ['Tessie'],
  pronouns: { subject: 'she', object: 'her', possessive: 'her' },
  birthday: '1890-03-14',
  canChooseOutfit: true,
  canDrawDiagrams: true,
  diagramStyle: 'clean',
  kind: 'assistant',
  metadata: { clearanceLevel: 3 },
  physicalDescription: {
    id: physicalDescriptionIdFor(MOUNT),
    headAndShouldersPrompt: 'weathered face',
    shortPrompt: 'tall woman',
    mediumPrompt: 'tall woman, grey eyes',
    longPrompt: 'tall woman, grey eyes, salt-white hair',
    completePrompt: 'tall woman, grey eyes, salt-white hair, scar',
    fullDescription: 'Tall, with grey eyes and a scar along the jaw.',
    humanoid: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  systemPrompts: [],
  scenarios: [],
};

describe('the layout covers exactly the managed fields', () => {
  it('names every managed field once, and nothing else', () => {
    const fields = CHARACTER_VAULT_ENTRIES.flatMap((e) => e.fields);
    expect(new Set(fields).size).toBe(fields.length);
    expect([...fields].sort()).toEqual([...CHARACTER_MANAGED_FIELDS].sort());
    expect([...MANAGED_FIELDS].sort()).toEqual([...CHARACTER_MANAGED_FIELDS].sort());
  });

  it('derives the keystones, the keep-set and the seeds from the entries', () => {
    expect(CHARACTER_VAULT_ANCHOR_PATH).toBe('properties.json');
    expect(CHARACTER_VAULT_KEYSTONES).toEqual([
      'properties.json', 'identity.md', 'description.md', 'manifesto.md', 'personality.md', 'example-dialogues.md',
    ]);
    expect(CHARACTER_VAULT_FILE_PATHS).toHaveLength(9);
    expect(CHARACTER_VAULT_KEEP_PATHS).toEqual([...CHARACTER_VAULT_FILE_PATHS, 'wardrobe.json']);
    expect(CHARACTER_VAULT_SEEDS.map((s) => s.path)).toEqual(CHARACTER_VAULT_FILE_PATHS);
  });

  it('seeds parse back to the defaults', () => {
    const defaults = characterManagedDefaults();
    for (const entry of CHARACTER_VAULT_FILE_ENTRIES) {
      const parsed = entry.parse(entry.seed, CTX);
      for (const field of entry.fields) {
        expect([field, parsed[field] ?? null]).toEqual([field, (defaults as Record<string, unknown>)[field] ?? (field === 'metadata' ? {} : null)]);
      }
    }
  });
});

describe('every codec is its own inverse', () => {
  it.each(CHARACTER_VAULT_FILE_ENTRIES.map((e) => [e.path, e] as const))('%s: render(parse(x)) === x', (_path, entry) => {
    const raw = entry.render(FIXTURE)!;
    expect(raw).not.toBeNull();
    const parsed = entry.parse(raw, CTX);
    expect(entry.render({ ...FIXTURE, ...parsed })).toBe(raw);
    for (const field of entry.fields) {
      expect(parsed[field]).toEqual(FIXTURE[field]);
    }
  });

  it('the physical composite round-trips both files', () => {
    for (const entry of CHARACTER_VAULT_COMPOSITE_ENTRIES) {
      const files = entry.render(FIXTURE, CTX)!;
      const parsed = entry.parse(files, CTX);
      const again = entry.render({ ...FIXTURE, ...parsed }, CTX)!;
      expect([...again.entries()]).toEqual([...files.entries()]);
      expect({ ...parsed.physicalDescription, createdAt: NOW, updatedAt: NOW }).toEqual(FIXTURE.physicalDescription);
    }
  });

  it('a folder item round-trips through its file', () => {
    const prompts = CHARACTER_VAULT_FOLDER_ENTRIES[0];
    const scenarios = CHARACTER_VAULT_FOLDER_ENTRIES[1];
    const doc = (relativePath: string, content: string) => ({
      id: relativePath, mountPointId: MOUNT, relativePath,
      fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1), content,
      createdAt: NOW, updatedAt: NOW,
    }) as any;

    const prompt = { id: '44444444-4444-4444-8444-444444444444', name: 'Formal: evening', content: 'Speak formally.', isDefault: true, createdAt: NOW, updatedAt: NOW };
    const promptRaw = prompts.renderItem(prompt);
    const [parsedPrompt] = prompts.parseFolder([doc(`Prompts/${prompts.fileNameFor(prompt)}`, promptRaw)], CTX).systemPrompts!;
    expect(prompts.renderItem({ ...parsedPrompt })).toBe(promptRaw);

    const scenario = { id: '55555555-5555-4555-8555-555555555555', title: 'Harbour', content: 'Fog.', description: 'The first', archived: true, createdAt: NOW, updatedAt: NOW };
    const scenarioRaw = scenarios.renderItem(scenario);
    const [parsedScenario] = scenarios.parseFolder([doc(`Scenarios/${scenarios.fileNameFor(scenario)}`, scenarioRaw)], CTX).scenarios!;
    expect(scenarios.renderItem({ ...parsedScenario })).toBe(scenarioRaw);
  });
});
