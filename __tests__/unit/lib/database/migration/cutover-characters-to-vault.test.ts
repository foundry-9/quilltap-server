/**
 * Unit tests for the cutover-characters-to-vault migration's legacy-row mapper.
 *
 * Focus: the `physicalDescriptions` (array) → `physicalDescription` (singular)
 * reshape — index 0 is preserved, extra entries are discarded with exactly one
 * warning per affected character (the V3-2 acceptance criterion) — and the safe
 * parsing of the legacy JSON columns the vault writer reads.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockWarn = jest.fn();

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn() },
}));

// The module imports a lot of runtime-only deps (DB utils, vault writer, repo
// factory). Stub them so importing the module under test doesn't drag the world
// in — we only exercise the pure mapper.
jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  getSQLiteDatabase: () => ({}),
  sqliteTableExists: () => true,
  getSQLiteTableColumns: () => [],
}));
jest.mock('../../../../../lib/mount-index/character-vault', () => ({ ensureCharacterVault: jest.fn() }));
jest.mock('../../../../../lib/database/repositories/character-properties-overlay', () => ({
  writeCharacterVaultManagedFields: jest.fn(),
}));
jest.mock('../../../../../lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('../../../../../lib/mount-index/database-store', () => ({ writeDatabaseDocument: jest.fn() }));

const CTX = { context: 'migration.cutover-characters-to-vault-v1' };

describe('mapLegacyCharacterRow', () => {
  let mapLegacyCharacterRow: typeof import('@/migrations/scripts/cutover-characters-to-vault').mapLegacyCharacterRow;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ mapLegacyCharacterRow } = await import('@/migrations/scripts/cutover-characters-to-vault'));
  });

  it('preserves a single physicalDescriptions entry without warning', () => {
    const entry = { id: 'p1', name: 'default', fullDescription: 'tall', shortPrompt: 's' };
    const { character, originalPhysicalCount } = mapLegacyCharacterRow(
      { id: 'c1', name: 'Solo', physicalDescriptions: JSON.stringify([entry]) },
      CTX,
    );
    expect(originalPhysicalCount).toBe(1);
    expect((character as any).physicalDescription).toEqual(entry);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('keeps index 0 and warns once when multiple entries exist', () => {
    const first = { id: 'p1', name: 'Professional', fullDescription: 'auburn hair' };
    const second = { id: 'p2', name: 'Casual', fullDescription: 'blonde hair' };
    const { character, originalPhysicalCount } = mapLegacyCharacterRow(
      { id: 'rachel', name: 'Rachel', physicalDescriptions: JSON.stringify([first, second]) },
      CTX,
    );
    expect(originalPhysicalCount).toBe(2);
    expect((character as any).physicalDescription).toEqual(first); // index 0 wins
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const [msg, meta] = mockWarn.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toMatch(/multiple physicalDescriptions/i);
    expect(meta).toMatchObject({ characterId: 'rachel', characterName: 'Rachel', originalCount: 2 });
  });

  it('maps an empty / missing physicalDescriptions to null with no warning', () => {
    for (const raw of [JSON.stringify([]), '', undefined, null]) {
      mockWarn.mockClear();
      const { character, originalPhysicalCount } = mapLegacyCharacterRow(
        { id: 'c', name: 'Blank', physicalDescriptions: raw },
        CTX,
      );
      expect(originalPhysicalCount).toBe(0);
      expect((character as any).physicalDescription).toBeNull();
      expect(mockWarn).not.toHaveBeenCalled();
    }
  });

  it('parses the legacy JSON array columns the vault writer reads', () => {
    const { character } = mapLegacyCharacterRow(
      {
        id: 'c2',
        name: 'JSONy',
        aliases: JSON.stringify(['Ember', 'Anna']),
        scenarios: JSON.stringify([{ id: 's1', title: 'Default' }]),
        systemPrompts: JSON.stringify([{ id: 'sp1', name: 'Base' }]),
        physicalDescriptions: '[]',
      },
      CTX,
    );
    expect((character as any).aliases).toEqual(['Ember', 'Anna']);
    expect((character as any).scenarios).toEqual([{ id: 's1', title: 'Default' }]);
    expect((character as any).systemPrompts).toEqual([{ id: 'sp1', name: 'Base' }]);
  });

  it('falls back safely on malformed JSON instead of throwing', () => {
    const { character, originalPhysicalCount } = mapLegacyCharacterRow(
      { id: 'c3', name: 'Broken', aliases: '{not json', physicalDescriptions: 'also not json' },
      CTX,
    );
    expect((character as any).aliases).toEqual([]);
    expect((character as any).physicalDescription).toBeNull();
    expect(originalPhysicalCount).toBe(0);
  });

  it('parses an object-shaped pronouns column but leaves a plain string alone', () => {
    const obj = mapLegacyCharacterRow(
      { id: 'c4', name: 'P', pronouns: JSON.stringify({ subjective: 'they' }), physicalDescriptions: '[]' },
      CTX,
    ).character as any;
    expect(obj.pronouns).toEqual({ subjective: 'they' });

    const str = mapLegacyCharacterRow(
      { id: 'c5', name: 'Q', pronouns: 'she/her', physicalDescriptions: '[]' },
      CTX,
    ).character as any;
    expect(str.pronouns).toBe('she/her');
  });
});
