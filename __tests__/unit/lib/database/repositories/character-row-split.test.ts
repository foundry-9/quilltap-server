/**
 * `CharacterRow` and `Character` are two types (D2 of
 * refactor-character-repository-and-vault.md).
 *
 * The repository's generic is the slim row: `_update` validates against
 * `CharacterRowSchema`, which knows no vault-managed field, so even a managed
 * field that reached it could never land in `$set` (the `characters` table has
 * no such column). And `MANAGED_FIELDS` is derived from the two schemas, never
 * hand-listed.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

import { CharactersRepository } from '@/lib/database/repositories/characters.repository';
import {
  CharacterRowSchema,
  CharacterSchema,
  CHARACTER_MANAGED_FIELDS,
} from '@/lib/schemas/character.types';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Tess',
  tags: [],
  partnerLinks: [],
  avatarOverrides: [],
  isFavorite: false,
  npc: false,
  controlledBy: 'llm',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('the row/entity split', () => {
  it('derives exactly the nineteen vault-managed fields', () => {
    expect([...CHARACTER_MANAGED_FIELDS].sort()).toEqual([
      'aliases', 'birthday', 'canChooseOutfit', 'canDrawDiagrams', 'description',
      'diagramStyle', 'exampleDialogues', 'firstMessage', 'identity', 'kind',
      'manifesto', 'metadata', 'personality', 'physicalDescription', 'pronouns',
      'scenarios', 'systemPrompts', 'talkativeness', 'title',
    ]);
    for (const field of CHARACTER_MANAGED_FIELDS) {
      expect(field in CharacterRowSchema.shape).toBe(false);
      expect(field in CharacterSchema.shape).toBe(true);
    }
    expect('systemTransparency' in CharacterRowSchema.shape).toBe(true);
  });

  it('never writes a managed field into $set', async () => {
    const repo = new CharactersRepository();
    const updateOne = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(repo, 'findByIdRaw').mockResolvedValue(ROW as any);
    (repo as any).getCollection = jest.fn().mockResolvedValue({ updateOne });

    await (repo as any)._update(ROW.id, { name: 'Tess II', identity: 'smuggled', talkativeness: 0.9 });

    const $set = updateOne.mock.calls[0][1].$set;
    expect($set.name).toBe('Tess II');
    for (const field of CHARACTER_MANAGED_FIELDS) {
      expect(field in $set).toBe(false);
    }
  });
});
