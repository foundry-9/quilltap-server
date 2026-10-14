/**
 * Golden for the wardrobe refactor's Phase B read-semantics change (spec §5,
 * bug 187): a character composite whose component lives in a *group* store
 * must survive the vault reader unchanged. The reader resolves component refs
 * against its own folder only; a UUID it can't find there is kept, not
 * dropped, and the wearable pool resolves it at request time.
 *
 * Runs the real reader (`readCharacterVaultWardrobe`), the real projector
 * (`projectVaultWardrobe`) and the real folder writer (`updateInMount`) over
 * an in-memory document store, so a regression anywhere on the read → write
 * → read loop shows up as a lost ref.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

/** The in-memory store: relativePath → content, for one mount. */
const store = new Map<string, string>();
const MOUNT_ID = 'vault-mount-1';

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async (mountIds: string[], folder: string, ext: string) =>
        Array.from(store.entries())
          .filter(([path]) => mountIds.includes(MOUNT_ID) && path.startsWith(`${folder}/`) && path.endsWith(ext))
          .filter(([path]) => !path.slice(folder.length + 1).includes('/'))
          .map(([relativePath, content]) => ({
            id: `doc:${relativePath}`,
            mountPointId: MOUNT_ID,
            relativePath,
            fileName: relativePath.split('/').pop(),
            content,
          })),
      ),
    },
    characters: {
      findByIdRaw: jest.fn(async (id: string) => ({ id, archivedAt: null, characterDocumentMountPointId: MOUNT_ID })),
    },
  }),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mp: string, path: string, content: string) => {
    store.set(path, content);
    return { mtime: 1 };
  }),
  deleteDatabaseDocument: jest.fn(async (_mp: string, path: string) => {
    if (!store.delete(path)) {
      const err = new Error('not found') as Error & { code: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
  }),
  readDatabaseDocument: jest.fn(async () => null),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(async () => 'folder-id'),
}));

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(async () => null),
}));

/** The cycle check's peer source — the character's wearable pool. */
const mockLoadWearablePool = jest.fn();
jest.mock('@/lib/wardrobe/pool', () => {
  const actual = jest.requireActual('@/lib/wardrobe/pool');
  return { ...actual, loadWearablePool: (...args: unknown[]) => mockLoadWearablePool(...args) };
});

const { readCharacterVaultWardrobe } = require('@/lib/database/repositories/vault-overlay/vault-readers');
const { projectVaultWardrobe } = require('@/lib/database/repositories/vault-overlay/wardrobe-sync');
const {
  createInMount,
  updateInMount,
  WardrobeComponentCycleError,
} = require('@/lib/database/repositories/vault-overlay/wardrobe-writes');
const { buildWearablePool } = require('@/lib/wardrobe/pool');
const { resolveEquippedOutfitForCharacter } = require('@/lib/wardrobe/resolve-equipped');

import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const SHIRT_ID = '22222222-2222-4222-8222-222222222222';
const REGALIA_ID = '33333333-3333-4333-8333-333333333333';
const BOOTS_ID = '44444444-4444-4444-8444-444444444444';
/** Lives in a group store, never in this vault. */
const GROUP_SASH_ID = '55555555-5555-4555-8555-555555555555';
const STAMP = '2026-01-01T00:00:00.000Z';

function item(id: string, title: string, types: WardrobeItemType[], componentItemIds: string[] = []): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title,
    types,
    componentItemIds,
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  } as WardrobeItem;
}

const shirt = item(SHIRT_ID, 'Dress Shirt', ['top']);
const boots = item(BOOTS_ID, 'Riding Boots', ['footwear']);
const regalia = item(REGALIA_ID, 'Guild Regalia', ['top', 'accessories'], [SHIRT_ID, GROUP_SASH_ID]);
const groupSash = { ...item(GROUP_SASH_ID, 'Guild Sash', ['accessories']), characterId: null };

const VAULT = { mountPointId: MOUNT_ID, scope: 'character' as const, characterId: CHAR_ID };

async function readVault(): Promise<WardrobeItem[]> {
  const result = await readCharacterVaultWardrobe(MOUNT_ID, CHAR_ID);
  return result?.items ?? [];
}

const byId = (items: WardrobeItem[]) => new Map(items.map((i) => [i.id, i]));

beforeEach(async () => {
  store.clear();
  mockLoadWearablePool.mockReset();
  // The pool the writer's cycle check consults: the vault's items plus the group sash.
  mockLoadWearablePool.mockImplementation(async (_repos: unknown, characterId: string, _p: unknown, opts: { ownItems?: WardrobeItem[] }) =>
    buildWearablePool(
      characterId,
      { groupMountPointIds: ['group-mount'], projectMountPointIds: [] },
      {
        own: (opts?.ownItems ?? []).map((i) => ({ ...i, origin: { scope: 'character', id: characterId, name: '' } })),
        group: [{ ...groupSash, origin: { scope: 'group', id: 'G1', name: 'The Guild' } }],
        project: [],
        general: [],
      },
    ),
  );
  await projectVaultWardrobe(MOUNT_ID, CHAR_ID, [shirt, regalia]);
});

describe('a character composite with a group-tier component', () => {
  it('writes the in-folder part as a slug and the group part as its UUID', () => {
    const file = store.get('Wardrobe/Guild Regalia.md');
    expect(file).toBeDefined();
    expect(file).toContain('dress-shirt');
    expect(file).toContain(GROUP_SASH_ID);
  });

  it('round-trips unchanged when read twice through the vault reader', async () => {
    const first = byId(await readVault());
    const second = byId(await readVault());

    expect(first.get(REGALIA_ID)!.componentItemIds).toEqual([SHIRT_ID, GROUP_SASH_ID]);
    expect(second.get(REGALIA_ID)).toEqual(first.get(REGALIA_ID));
    expect(second.get(SHIRT_ID)).toEqual(first.get(SHIRT_ID));
  });

  it('a read → reproject cycle leaves the file byte-identical', async () => {
    const before = store.get('Wardrobe/Guild Regalia.md');
    await projectVaultWardrobe(MOUNT_ID, CHAR_ID, await readVault());
    expect(store.get('Wardrobe/Guild Regalia.md')).toBe(before);
  });

  it('keeps the group ref across an unrelated write in the same vault', async () => {
    const regaliaBefore = store.get('Wardrobe/Guild Regalia.md');

    await updateInMount(VAULT, SHIRT_ID, { description: 'Starched within an inch of its life.' });

    const after = byId(await readVault());
    expect(after.get(SHIRT_ID)!.description).toBe('Starched within an inch of its life.');
    expect(after.get(REGALIA_ID)!.componentItemIds).toEqual([SHIRT_ID, GROUP_SASH_ID]);
    expect(store.get('Wardrobe/Guild Regalia.md')).toBe(regaliaBefore);
  });

  it('keeps the group ref when a new item is added to the vault', async () => {
    await createInMount(VAULT, boots);

    const after = byId(await readVault());
    expect(after.has(BOOTS_ID)).toBe(true);
    expect(after.get(REGALIA_ID)!.componentItemIds).toEqual([SHIRT_ID, GROUP_SASH_ID]);
  });

  it('resolves to wearable leaves once the pool supplies the group tier', async () => {
    const own = await readVault();
    const pool = buildWearablePool(
      CHAR_ID,
      { groupMountPointIds: ['group-mount'], projectMountPointIds: [] },
      {
        own: own.map((i) => ({ ...i, origin: { scope: 'character', id: CHAR_ID, name: '' } })),
        group: [{ ...groupSash, origin: { scope: 'group', id: 'G1', name: 'The Guild' } }],
        project: [],
        general: [],
      },
    );

    const resolved = resolveEquippedOutfitForCharacter(pool, {
      top: [REGALIA_ID],
      bottom: [],
      footwear: [],
      accessories: [],
      hair: [],
    });

    expect(resolved.outfitValues.top).toEqual(['Dress Shirt']);
    expect(resolved.outfitValues.accessories).toEqual(['Guild Sash']);
  });

  it('the writer checks cycles against the pool, so a cycle through the group part is refused', async () => {
    // Make the group sash point back at the regalia: regalia → sash → regalia.
    mockLoadWearablePool.mockImplementation(async (_r: unknown, characterId: string, _p: unknown, opts: { ownItems?: WardrobeItem[] }) =>
      buildWearablePool(
        characterId,
        { groupMountPointIds: ['group-mount'], projectMountPointIds: [] },
        {
          own: (opts?.ownItems ?? []).map((i) => ({ ...i, origin: { scope: 'character', id: characterId, name: '' } })),
          group: [{ ...groupSash, componentItemIds: [REGALIA_ID], origin: { scope: 'group', id: 'G1', name: 'G' } }],
          project: [],
          general: [],
        },
      ),
    );

    await expect(updateInMount(VAULT, REGALIA_ID, { title: 'Guild Regalia' })).rejects.toBeInstanceOf(
      WardrobeComponentCycleError,
    );
    // The pool was asked with the folder's own items in hand — no second vault read.
    const [, characterId, projectIds, opts] = mockLoadWearablePool.mock.calls[0];
    expect(characterId).toBe(CHAR_ID);
    expect(projectIds).toBeUndefined();
    expect(opts.ownItems.map((i: WardrobeItem) => i.id).sort()).toEqual([SHIRT_ID, REGALIA_ID].sort());
  });

  it('still drops a hand-edited slug that matches nothing', async () => {
    store.set(
      'Wardrobe/Guild Regalia.md',
      store.get('Wardrobe/Guild Regalia.md')!.replace('dress-shirt', 'no-such-garment'),
    );
    const after = byId(await readVault());
    expect(after.get(REGALIA_ID)!.componentItemIds).toEqual([GROUP_SASH_ID]);
  });
});
