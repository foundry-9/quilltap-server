/**
 * Unit tests for the built-in reset id plan: Reset Built-in Characters must
 * bring Lorian and Riya back under the ids they had.
 */

import fs from 'fs';
import path from 'path';
import { findBuiltinCharacterIds, planBuiltinReset } from '../builtin-reset';

const SEED_LORIAN = 'a42c02d7-90b8-49da-b7fa-c5f31894afd7';
const SEED_RIYA = 'f11db2bc-8cfe-4beb-a1b8-91f4c4ba9f23';
const OLD_LORIAN = '026d6d31-dcc0-4e9c-abe1-b78a02cc4998';

function seed() {
  return {
    manifest: { settings: { selectedIds: [SEED_LORIAN, SEED_RIYA] } },
    data: {
      characters: [
        { id: SEED_LORIAN, name: 'Lorian', wardrobeItems: [{ id: 'w1', characterId: SEED_LORIAN }] },
        { id: SEED_RIYA, name: 'Riya', wardrobeItems: [] },
      ],
      memories: [
        { id: 'm1', characterId: SEED_LORIAN, aboutCharacterId: SEED_RIYA },
        { id: 'm2', characterId: SEED_RIYA, aboutCharacterId: SEED_LORIAN },
      ],
    },
  };
}

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

const never = async () => false;

describe('planBuiltinReset', () => {
  it('gives an existing built-in its old id everywhere the seed named it', async () => {
    const plan = await planBuiltinReset(seed(), { Lorian: OLD_LORIAN, Riya: null }, never, counter());

    expect(plan.characterIds).toEqual({ Lorian: OLD_LORIAN, Riya: SEED_RIYA });
    expect(plan.data.data.characters[0].id).toBe(OLD_LORIAN);
    expect(plan.data.data.characters[0].wardrobeItems[0].characterId).toBe(OLD_LORIAN);
    expect(plan.data.data.memories[0].characterId).toBe(OLD_LORIAN);
    expect(plan.data.data.memories[1].aboutCharacterId).toBe(OLD_LORIAN);
    expect(plan.data.manifest.settings.selectedIds).toEqual([OLD_LORIAN, SEED_RIYA]);
  });

  it('keeps the seed id for a built-in that did not exist when the id is free', async () => {
    const isTaken = jest.fn(never);
    const plan = await planBuiltinReset(seed(), {}, isTaken, counter());

    expect(plan.characterIds).toEqual({ Lorian: SEED_LORIAN, Riya: SEED_RIYA });
    expect(isTaken).toHaveBeenCalledWith(SEED_LORIAN);
    expect(isTaken).toHaveBeenCalledWith(SEED_RIYA);
  });

  it('mints a new id when the seed id is held by another row', async () => {
    const plan = await planBuiltinReset(seed(), {}, async (id) => id === SEED_RIYA, counter());

    expect(plan.characterIds.Lorian).toBe(SEED_LORIAN);
    expect(plan.characterIds.Riya).toBe('new-1');
    expect(plan.data.data.memories[0].aboutCharacterId).toBe('new-1');
  });

  it('does not ask whether a preserved id is taken', async () => {
    const isTaken = jest.fn(never);
    await planBuiltinReset(seed(), { Lorian: OLD_LORIAN, Riya: SEED_RIYA }, isTaken, counter());

    expect(isTaken).not.toHaveBeenCalled();
  });

  it('gives every memory a new id', async () => {
    const plan = await planBuiltinReset(seed(), {}, never, counter());

    expect(plan.data.data.memories.map((m) => m.id)).toEqual(['new-1', 'new-2']);
    expect(plan.remappedIdCount).toBe(2);
  });

  it('leaves the seed object untouched', async () => {
    const original = seed();
    await planBuiltinReset(original, { Lorian: OLD_LORIAN }, never, counter());

    expect(original).toEqual(seed());
  });
});

describe('the shipped seed bundle', () => {
  const bundle = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'first-startup', 'imports', 'lorian-and-riya.qtap'), 'utf-8')
  );

  it('carries exactly the two built-ins, by the names the reset and the avatars match on', () => {
    expect(findBuiltinCharacterIds(bundle)).toEqual({ Lorian: SEED_LORIAN, Riya: SEED_RIYA });
  });

  it('claims no memory id twice and points every memory at a built-in', () => {
    const ids = bundle.data.memories.map((m: { id: string }) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const memory of bundle.data.memories) {
      expect([SEED_LORIAN, SEED_RIYA]).toContain(memory.characterId);
    }
  });
});
