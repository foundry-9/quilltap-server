/**
 * The one wardrobe route factory behind all four tiers (character vault,
 * group store, project store, Quilltap General).
 *
 * Every tier resolves through the real `resolveWardrobeLocation`; only the
 * folder I/O, store provisioning and the instance setting are mocked. The
 * behaviours worth pinning are the ones whose failure is quiet:
 *
 *   - **`?action=instructions` must not fall through to the item CRUD.**
 *   - **The collection GET honours `?includeArchived`.**
 *   - **Every item read or written carries `origin` and `wear`** — GET, POST
 *     and PUT alike; a POST answers `{ wardrobeItem }` only.
 *   - **Archiving is idempotent.** Re-archiving keeps the original stamp.
 *   - **A component cycle is a 400, not a 500** — on every tier.
 *   - **A PUT checks the item exists before the picture choice.**
 *   - **A character is the requesting user's, or a 404.**
 *   - **An archived character's vault refuses writes with a 409.**
 *   - **An unprovisioned General lists as empty**, not as an error.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler:
    (handler: (req: never, ctx: never, params: never) => Promise<unknown>) => handler,
  withActionDispatch: jest.requireActual('@/lib/api/middleware/actions').withActionDispatch,
}));

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => {
  class WardrobeComponentCycleError extends Error {
    constructor(itemId: string) {
      super(`Wardrobe item ${itemId} would create a component cycle`);
      this.name = 'WardrobeComponentCycleError';
    }
  }
  return {
    WardrobeComponentCycleError,
    readMountItems: jest.fn(),
    createInMount: jest.fn(),
    updateInMount: jest.fn(),
    deleteInMount: jest.fn(),
    resolveWardrobeMount: jest.fn(),
  };
});

jest.mock('@/lib/database/repositories/characters.repository', () => {
  class CharacterArchivedError extends Error {
    constructor(characterId: string) {
      super(`Character ${characterId} is archived`);
      this.name = 'CharacterArchivedError';
    }
  }
  return { CharacterArchivedError };
});

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }));
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }));
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({ ensureSharedWardrobeFolder: jest.fn() }));
jest.mock('@/lib/mount-index/general-wardrobe', () => ({ readGeneralWardrobe: jest.fn() }));
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({ resolveGroupMountsForCharacter: jest.fn() }));
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }));

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}));

// Pictures: the PUT validates a hand-set `imageFileId` and the DELETE drops the
// item's pictures, both through lib/wardrobe/item-images (tested on its own).
jest.mock('@/lib/wardrobe/item-images', () => {
  class ForeignWardrobeImageError extends Error {}
  return {
    ForeignWardrobeImageError,
    assertItemImageChoice: jest.fn(async () => undefined),
    cleanupItemImages: jest.fn(async () => undefined),
  };
});

import {
  createWardrobeCollectionHandlers,
  createWardrobeItemHandlers,
} from '@/lib/wardrobe/routes/wardrobe-route-factory';
import {
  WardrobeComponentCycleError,
  createInMount,
  deleteInMount,
  readMountItems,
  resolveWardrobeMount,
  updateInMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store';
import { ensureSharedWardrobeFolder } from '@/lib/mount-index/shared-wardrobe';
import { readGeneralWardrobe } from '@/lib/mount-index/general-wardrobe';
import { resolveGroupMountsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import { loadWearablePool } from '@/lib/wardrobe/pool';
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions';
import {
  ForeignWardrobeImageError,
  assertItemImageChoice,
  cleanupItemImages,
} from '@/lib/wardrobe/item-images';
import type { WardrobeScope } from '@/lib/wardrobe/location';

const mockReadItems = jest.mocked(readMountItems);
const mockCreate = jest.mocked(createInMount);
const mockUpdate = jest.mocked(updateInMount);
const mockDelete = jest.mocked(deleteInMount);
const mockResolveMount = jest.mocked(resolveWardrobeMount);
const mockGeneralMount = jest.mocked(getGeneralMountPointId);
const mockEnsureStore = jest.mocked(ensureOwnerOfficialStore);
const mockEnsureFolder = jest.mocked(ensureSharedWardrobeFolder);
const mockReadGeneral = jest.mocked(readGeneralWardrobe);
const mockGroupMounts = jest.mocked(resolveGroupMountsForCharacter);
const mockLoadPool = jest.mocked(loadWearablePool);
const mockReadInstructions = jest.mocked(readWardrobeInstructionsFile);
const mockWriteInstructions = jest.mocked(writeWardrobeInstructionsFile);
const mockAssertImageChoice = jest.mocked(assertItemImageChoice);
const mockCleanupItemImages = jest.mocked(cleanupItemImages);

const CHAR_ID = 'char-1';
const PROJECT = { id: 'proj-1', name: 'The Estate', officialMountPointId: 'mount-1' };
const GROUP = { id: 'group-1', name: 'The Drones Club', officialMountPointId: 'gmount-1' };
const CHARACTER = {
  id: CHAR_ID,
  name: 'Vivienne',
  userId: 'user-1',
  characterDocumentMountPointId: 'vault-1',
  archivedAt: null,
};

const PROJECT_ORIGIN = { scope: 'project', id: 'proj-1', name: 'The Estate' };
const GROUP_ORIGIN = { scope: 'group', id: 'group-1', name: 'The Drones Club' };
const CHARACTER_ORIGIN = { scope: 'character', id: CHAR_ID, name: 'Vivienne' };
const GENERAL_ORIGIN = { scope: 'general', id: null, name: 'Quilltap General' };

/** The canonical never-worn summary every read attaches by default. */
const NEVER_WORN = { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null };

let findProject: jest.Mock;
let findGroup: jest.Mock;
let findByIdRaw: jest.Mock;
let removeEquippedItemFromAllChats: jest.Mock;
let deleteByItemIds: jest.Mock;
let findSummaries: jest.Mock;
let findHistory: jest.Mock;
let findChatById: jest.Mock;
let readSharedTiers: jest.Mock;

function wardrobeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    characterId: null,
    title: 'Greatcoat',
    description: null,
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CONFIGS: Record<WardrobeScope, { logTag: string; logIdKey: string }> = {
  character: { logTag: '[Wardrobe v1]', logIdKey: 'characterId' },
  group: { logTag: '[Groups v1]', logIdKey: 'groupId' },
  project: { logTag: '[Projects v1]', logIdKey: 'projectId' },
  general: { logTag: '[Wardrobe Archetypes v1]', logIdKey: 'generalId' },
};

function collection(scope: WardrobeScope = 'project') {
  return createWardrobeCollectionHandlers<{ id: string }>({
    scope,
    paramsToId: ({ id }) => (scope === 'general' ? null : id),
    ...CONFIGS[scope],
  });
}

function item(scope: WardrobeScope = 'project') {
  return createWardrobeItemHandlers<{ id: string; itemId: string }>({
    scope,
    paramsToId: ({ id }) => (scope === 'general' ? null : id),
    ...CONFIGS[scope],
  });
}

const OWNER_ID: Record<WardrobeScope, string> = {
  character: CHAR_ID,
  group: 'group-1',
  project: 'proj-1',
  general: '',
};

/**
 * The request shape these handlers read: `url` for `readIncludeArchived`,
 * `nextUrl` for the action dispatcher, `method` for its log line, `json()` for
 * the body.
 */
function req(url: string, body?: unknown, method = 'GET') {
  return { url, nextUrl: new URL(url), method, json: async () => body } as never;
}

function ctx(userId = 'user-1') {
  return {
    user: { id: userId },
    repos: {
      projects: { findById: findProject },
      groups: { findById: findGroup },
      characters: { findByIdRaw },
      chats: { removeEquippedItemFromAllChats, findById: findChatById },
      wardrobeWear: { deleteByItemIds, findSummaries, findHistory },
      wardrobe: { readSharedTiers },
    },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  findProject = jest.fn(async (id: string) => (id === PROJECT.id ? PROJECT : null));
  findGroup = jest.fn(async (id: string) => (id === GROUP.id ? GROUP : null));
  findByIdRaw = jest.fn(async (id: string) => (id === CHAR_ID ? CHARACTER : null));
  removeEquippedItemFromAllChats = jest.fn().mockResolvedValue(undefined);
  deleteByItemIds = jest.fn().mockResolvedValue(undefined);
  findSummaries = jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, NEVER_WORN])));
  findHistory = jest.fn().mockResolvedValue({ ...NEVER_WORN, wearers: [] });
  findChatById = jest.fn().mockResolvedValue(null);
  readSharedTiers = jest.fn().mockResolvedValue([]);

  mockGeneralMount.mockResolvedValue('general-mount' as never);
  mockEnsureStore.mockImplementation(async (kind: string) =>
    ({ mountPointId: kind === 'group' ? 'gmount-1' : 'mount-1' }) as never,
  );
  mockEnsureFolder.mockResolvedValue(undefined as never);
  mockReadGeneral.mockResolvedValue([] as never);
  mockGroupMounts.mockResolvedValue([] as never);
  mockLoadPool.mockResolvedValue({ byId: new Map() } as never);
  mockResolveMount.mockResolvedValue({ mountPointId: 'vault-1', scope: 'character', characterId: CHAR_ID });

  mockReadItems.mockResolvedValue([wardrobeItem()] as never);
  mockCreate.mockImplementation(async (_mount, i) => i as never);
  mockUpdate.mockImplementation(async (_mount, id, patch) =>
    ({ ...wardrobeItem({ id }), ...patch }) as never,
  );
  mockDelete.mockResolvedValue(true);
  mockReadInstructions.mockResolvedValue(null as never);
  mockWriteInstructions.mockResolvedValue(undefined as never);
  mockAssertImageChoice.mockResolvedValue(undefined as never);
  mockCleanupItemImages.mockResolvedValue(undefined as never);
});

// ============================================================================
// Collection GET
// ============================================================================

describe('collection GET — listing', () => {
  it('project: ensures the store and folder, then answers the list with its mount', async () => {
    const res = await collection('project').GET(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(mockEnsureStore).toHaveBeenCalledWith('project', 'proj-1', 'The Estate');
    expect(mockEnsureFolder).toHaveBeenCalledWith('mount-1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      mountPointId: 'mount-1',
      wardrobeItems: [{ ...wardrobeItem(), origin: PROJECT_ORIGIN, wear: NEVER_WORN }],
    });
  });

  it('group: ensures the group store and tags items with the group', async () => {
    const res = await collection('group').GET(req('https://x.test/'), ctx(), { id: 'group-1' });

    expect(mockEnsureStore).toHaveBeenCalledWith('group', 'group-1', 'The Drones Club');
    expect(mockReadItems).toHaveBeenCalledWith({ mountPointId: 'gmount-1', scope: 'group', characterId: null });
    await expect(res.json()).resolves.toEqual({
      mountPointId: 'gmount-1',
      wardrobeItems: [{ ...wardrobeItem(), origin: GROUP_ORIGIN, wear: NEVER_WORN }],
    });
  });

  it('character: reads the vault without provisioning anything', async () => {
    const res = await collection('character').GET(req('https://x.test/'), ctx(), { id: CHAR_ID });

    expect(mockEnsureStore).not.toHaveBeenCalled();
    expect(mockEnsureFolder).not.toHaveBeenCalled();
    expect(mockReadItems).toHaveBeenCalledWith({ mountPointId: 'vault-1', scope: 'character', characterId: CHAR_ID });
    await expect(res.json()).resolves.toEqual({
      mountPointId: 'vault-1',
      wardrobeItems: [{ ...wardrobeItem(), origin: CHARACTER_ORIGIN, wear: NEVER_WORN }],
    });
  });

  it("character: 404s for another user's character, without reading its vault", async () => {
    const res = await collection('character').GET(req('https://x.test/'), ctx('user-2'), { id: CHAR_ID });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Character not found' });
    expect(mockReadItems).not.toHaveBeenCalled();
  });

  it('character: 404s when the character has no vault', async () => {
    findByIdRaw.mockResolvedValue({ ...CHARACTER, characterDocumentMountPointId: null });

    const res = await collection('character').GET(req('https://x.test/'), ctx(), { id: CHAR_ID });

    expect(res.status).toBe(404);
  });

  it('general: lists the General folder with the General origin', async () => {
    const res = await collection('general').GET(req('https://x.test/'), ctx(), { id: '' });

    expect(mockEnsureFolder).toHaveBeenCalledWith('general-mount');
    await expect(res.json()).resolves.toEqual({
      mountPointId: 'general-mount',
      wardrobeItems: [{ ...wardrobeItem(), origin: GENERAL_ORIGIN, wear: NEVER_WORN }],
    });
  });

  it('general: an unprovisioned General lists as empty, not an error', async () => {
    mockGeneralMount.mockResolvedValue(null as never);

    const res = await collection('general').GET(req('https://x.test/'), ctx(), { id: '' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ wardrobeItems: [] });
    expect(mockReadItems).not.toHaveBeenCalled();
  });

  it("attaches each item's wear summary from one ledger read", async () => {
    mockReadItems.mockResolvedValue([wardrobeItem(), wardrobeItem({ id: 'item-2', title: 'Spats' })] as never);
    const worn = {
      wearCount: 3,
      firstWornAt: '2026-03-14T10:00:00.000Z',
      lastWornAt: '2026-10-04T10:00:00.000Z',
      lastWornChatId: '11111111-1111-4111-8111-111111111111',
    };
    findSummaries.mockResolvedValue(new Map([['item-1', worn], ['item-2', NEVER_WORN]]));

    const body = await (await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' })).json();

    expect(findSummaries).toHaveBeenCalledTimes(1);
    expect(findSummaries).toHaveBeenCalledWith(['item-1', 'item-2']);
    expect(body.wardrobeItems.map((i: { wear: unknown }) => i.wear)).toEqual([worn, NEVER_WORN]);
  });

  it('honours ?includeArchived', async () => {
    mockReadItems.mockResolvedValue([
      wardrobeItem(),
      wardrobeItem({ id: 'item-2', archivedAt: '2026-02-02T00:00:00.000Z' }),
    ] as never);

    const archived = await (
      await collection().GET(req('https://x.test/?includeArchived=true'), ctx(), { id: 'proj-1' })
    ).json();
    expect(archived.wardrobeItems.map((i: { id: string }) => i.id)).toEqual(['item-1', 'item-2']);

    const live = await (await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' })).json();
    expect(live.wardrobeItems.map((i: { id: string }) => i.id)).toEqual(['item-1']);
  });

  it('404s when the owner is gone, without provisioning', async () => {
    const res = await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-gone' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Project not found' });
    expect(mockEnsureStore).not.toHaveBeenCalled();
  });

  it('404s when the store cannot be ensured', async () => {
    mockEnsureStore.mockResolvedValue(null as never);

    const res = await collection().GET(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(res.status).toBe(404);
    expect(mockReadItems).not.toHaveBeenCalled();
  });
});

describe('character collection GET ?scope=group', () => {
  it("answers the group tier of the character's pool, each item tagged with its group", async () => {
    mockGroupMounts.mockResolvedValue([
      { group: { id: 'group-1', name: 'The Drones Club' }, mountPointIds: ['gmount-1'] },
      { group: { id: 'group-2', name: 'The Junior Ganymede' }, mountPointIds: ['gmount-2'] },
    ] as never);
    readSharedTiers.mockImplementation(async (mounts: string[], _inc: boolean, originOf: (mp: string) => unknown) =>
      mounts.map((mp, i) => ({ ...wardrobeItem({ id: `g-${i}` }), origin: originOf(mp) })),
    );

    const res = await collection('character').GET(
      req('https://x.test/?scope=group&includeArchived=true'),
      ctx(),
      { id: CHAR_ID },
    );

    expect(mockGroupMounts).toHaveBeenCalledWith(CHAR_ID);
    expect(readSharedTiers).toHaveBeenCalledWith(['gmount-1', 'gmount-2'], true, expect.any(Function));
    expect(mockReadItems).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.wardrobeItems.map((i: { origin: unknown }) => i.origin)).toEqual([
      GROUP_ORIGIN,
      { scope: 'group', id: 'group-2', name: 'The Junior Ganymede' },
    ]);
    expect(body.wardrobeItems[0].wear).toEqual(NEVER_WORN);
  });
});

// ============================================================================
// Collection POST
// ============================================================================

describe('collection POST — create', () => {
  it('creates the item and answers it alone, with origin and wear', async () => {
    const res = await collection().POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: 'proj-1' },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['wardrobeItem']);
    expect(body.wardrobeItem).toMatchObject({ title: 'Greatcoat', origin: PROJECT_ORIGIN, wear: NEVER_WORN });
    expect(mockCreate).toHaveBeenCalledWith(
      { mountPointId: 'mount-1', scope: 'project', characterId: null },
      expect.objectContaining({ title: 'Greatcoat' }),
    );
  });

  it('character: writes through the re-resolved vault mount and owns the item', async () => {
    const res = await collection('character').POST(
      req('https://x.test/', { title: 'Cloche', types: ['accessories'] }, 'POST'),
      ctx(),
      { id: CHAR_ID },
    );

    expect(res.status).toBe(201);
    expect(mockResolveMount).toHaveBeenCalledWith(CHAR_ID);
    const stored = mockCreate.mock.calls[0][1] as { characterId: string };
    expect(stored.characterId).toBe(CHAR_ID);
    expect((await res.json()).wardrobeItem.origin).toEqual(CHARACTER_ORIGIN);
  });

  it('stamps a fresh id and timestamps rather than trusting the body', async () => {
    await collection().POST(
      req('https://x.test/', { id: 'attacker-chosen', title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: 'proj-1' },
    );

    const stored = mockCreate.mock.calls[0][1] as { id: string; createdAt: string };
    expect(stored.id).not.toBe('attacker-chosen');
    expect(stored.createdAt).toEqual(expect.any(String));
  });

  it('never provisions a store for an invalid body', async () => {
    await expect(
      collection().POST(req('https://x.test/', { title: '' }, 'POST'), ctx(), { id: 'proj-1' }),
    ).rejects.toThrow();
    expect(mockEnsureStore).not.toHaveBeenCalled();
  });

  it("a shared-tier composite takes its components' slots from its folder plus General", async () => {
    mockReadGeneral.mockResolvedValue([wardrobeItem({ id: 'gen-shoes', types: ['footwear'] })] as never);
    mockReadItems.mockResolvedValue([wardrobeItem({ id: 'coat', types: ['top'] })] as never);

    await collection().POST(
      req('https://x.test/', { title: 'Town kit', types: ['top'], componentItemIds: ['coat', 'gen-shoes'] }, 'POST'),
      ctx(),
      { id: 'proj-1' },
    );

    const stored = mockCreate.mock.calls[0][1] as { types: string[] };
    expect([...stored.types].sort()).toEqual(['footwear', 'top']);
    expect(mockLoadPool).not.toHaveBeenCalled();
  });

  it("a character composite looks its components up in the character's wearable pool", async () => {
    mockLoadPool.mockResolvedValue({
      byId: new Map([['gen-shoes', wardrobeItem({ id: 'gen-shoes', types: ['footwear'] })]]),
    } as never);

    await collection('character').POST(
      req('https://x.test/', { title: 'Kit', types: ['top'], componentItemIds: ['gen-shoes'] }, 'POST'),
      ctx(),
      { id: CHAR_ID },
    );

    expect(mockLoadPool).toHaveBeenCalledWith(expect.anything(), CHAR_ID, []);
    const stored = mockCreate.mock.calls[0][1] as { types: string[] };
    expect([...stored.types].sort()).toEqual(['footwear', 'top']);
  });

  it.each<WardrobeScope>(['character', 'group', 'project', 'general'])(
    '%s: turns a component cycle into a 400, not a 500',
    async (scope) => {
      mockCreate.mockRejectedValue(new WardrobeComponentCycleError('item-1', [['a', 'b', 'a']]));

      const res = await collection(scope).POST(
        req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
        ctx(),
        { id: OWNER_ID[scope] },
      );

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: 'Wardrobe item item-1 would create a component cycle',
      });
    },
  );

  it("409s a create in an archived character's vault", async () => {
    mockResolveMount.mockRejectedValue(new CharacterArchivedError(CHAR_ID));

    const res = await collection('character').POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: CHAR_ID },
    );

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("404s a create on another user's character", async () => {
    const res = await collection('character').POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx('user-2'),
      { id: CHAR_ID },
    );

    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('500s a create when General is not provisioned', async () => {
    mockGeneralMount.mockResolvedValue(null as never);

    const res = await collection('general').POST(
      req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
      ctx(),
      { id: '' },
    );

    expect(res.status).toBe(500);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets any other writer failure propagate', async () => {
    mockCreate.mockRejectedValue(new Error('store unreachable'));

    await expect(
      collection().POST(
        req('https://x.test/', { title: 'Greatcoat', types: ['top'] }, 'POST'),
        ctx(),
        { id: 'proj-1' },
      ),
    ).rejects.toThrow('store unreachable');
  });
});

// ============================================================================
// ?action=instructions
// ============================================================================

describe('?action=instructions does not fall through to item CRUD', () => {
  it("GET reads the tier's own file", async () => {
    mockReadInstructions.mockResolvedValue('Dress for the season.' as never);

    const res = await collection().GET(req('https://x.test/?action=instructions'), ctx(), { id: 'proj-1' });

    expect(mockReadInstructions).toHaveBeenCalledWith('mount-1');
    expect(mockReadItems).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ instructions: 'Dress for the season.' });
  });

  it('POST writes it — createWardrobeSchema never sees the body', async () => {
    const res = await collection().POST(
      req('https://x.test/?action=instructions', { instructions: 'Wear the greatcoat.' }, 'POST'),
      ctx(),
      { id: 'proj-1' },
    );

    expect(mockWriteInstructions).toHaveBeenCalledWith('mount-1', 'Wear the greatcoat.');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ instructions: 'Wear the greatcoat.' });
  });

  it('POST ensures the folder before writing — the file lives inside it', async () => {
    await collection().POST(
      req('https://x.test/?action=instructions', { instructions: 'x' }, 'POST'),
      ctx(),
      { id: 'proj-1' },
    );

    expect(mockEnsureFolder).toHaveBeenCalledWith('mount-1');
  });

  it('404s on a missing owner before reading a file', async () => {
    const res = await collection().GET(req('https://x.test/?action=instructions'), ctx(), { id: 'proj-gone' });

    expect(res.status).toBe(404);
    expect(mockReadInstructions).not.toHaveBeenCalled();
  });

  it("POST 409s for an archived character's vault", async () => {
    mockResolveMount.mockRejectedValue(new CharacterArchivedError(CHAR_ID));

    const res = await collection('character').POST(
      req('https://x.test/?action=instructions', { instructions: 'x' }, 'POST'),
      ctx(),
      { id: CHAR_ID },
    );

    expect(res.status).toBe(409);
    expect(mockWriteInstructions).not.toHaveBeenCalled();
  });

  it('general: GET reads null and a clearing POST is a no-op while unprovisioned', async () => {
    mockGeneralMount.mockResolvedValue(null as never);

    const get = await collection('general').GET(req('https://x.test/?action=instructions'), ctx(), { id: '' });
    await expect(get.json()).resolves.toEqual({ instructions: null });

    const post = await collection('general').POST(
      req('https://x.test/?action=instructions', { instructions: null }, 'POST'),
      ctx(),
      { id: '' },
    );
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toEqual({ instructions: null });
    expect(mockReadInstructions).not.toHaveBeenCalled();
    expect(mockWriteInstructions).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Item GET
// ============================================================================

describe('item GET', () => {
  it('finds an archived item too, with origin and wear', async () => {
    mockReadItems.mockResolvedValue([wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' })] as never);

    const res = await item().GET(req('https://x.test/'), ctx(), { id: 'proj-1', itemId: 'item-1' });

    await expect(res.json()).resolves.toEqual({
      wardrobeItem: {
        ...wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' }),
        origin: PROJECT_ORIGIN,
        wear: NEVER_WORN,
      },
    });
  });

  it('never provisions a store for a read', async () => {
    await item().GET(req('https://x.test/'), ctx(), { id: 'proj-1', itemId: 'item-1' });

    expect(mockEnsureStore).not.toHaveBeenCalled();
    expect(mockReadItems).toHaveBeenCalledWith({ mountPointId: 'mount-1', scope: 'project', characterId: null });
  });

  it('404s on an unknown item', async () => {
    const res = await item().GET(req('https://x.test/'), ctx(), { id: 'proj-1', itemId: 'nope' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Project wardrobe item not found' });
  });

  it('404s when the owner has no store yet', async () => {
    findProject.mockResolvedValue({ ...PROJECT, officialMountPointId: null });

    const res = await item().GET(req('https://x.test/'), ctx(), { id: 'proj-1', itemId: 'item-1' });

    expect(res.status).toBe(404);
    expect(mockReadItems).not.toHaveBeenCalled();
  });

  it("404s on another user's character", async () => {
    const res = await item('character').GET(req('https://x.test/'), ctx('user-2'), {
      id: CHAR_ID,
      itemId: 'item-1',
    });

    expect(res.status).toBe(404);
  });
});

describe('item GET ?action=wear-history', () => {
  const VIVIENNE = '22222222-2222-4222-8222-222222222222';
  const GONE = '33333333-3333-4333-8333-333333333333';
  const CHAT = '44444444-4444-4444-8444-444444444444';

  const HISTORY = {
    wearCount: 6,
    firstWornAt: '2026-03-14T10:00:00.000Z',
    lastWornAt: '2026-10-04T10:00:00.000Z',
    lastWornChatId: CHAT,
    wearers: [
      { characterId: VIVIENNE, wearCount: 3, firstWornAt: '2026-03-14T10:00:00.000Z', lastWornAt: '2026-10-04T10:00:00.000Z', lastWornChatId: CHAT },
      { characterId: GONE, wearCount: 2, firstWornAt: '2026-04-01T10:00:00.000Z', lastWornAt: '2026-05-01T10:00:00.000Z', lastWornChatId: null },
      { characterId: null, wearCount: 1, firstWornAt: '2026-03-20T10:00:00.000Z', lastWornAt: '2026-03-20T10:00:00.000Z', lastWornChatId: null },
    ],
  };

  function wearHistory(itemId = 'item-1') {
    return item().GET(req('https://x.test/?action=wear-history'), ctx(), { id: 'proj-1', itemId });
  }

  beforeEach(() => {
    findHistory.mockResolvedValue(HISTORY);
    findByIdRaw.mockImplementation(async (id: string) =>
      id === VIVIENNE ? { id: VIVIENNE, name: 'Vivienne', defaultImageId: null } : null,
    );
  });

  it('names wearers through the raw read, labels the missing and the unattributed', async () => {
    findChatById.mockResolvedValue({ id: CHAT, title: 'The Thornfield Dinner' });

    const res = await wearHistory();

    expect(res.status).toBe(200);
    expect(findHistory).toHaveBeenCalledWith('item-1');
    expect(findByIdRaw).toHaveBeenCalledWith(VIVIENNE);
    expect(findByIdRaw).toHaveBeenCalledWith(GONE);
    await expect(res.json()).resolves.toEqual({
      history: HISTORY,
      wearers: [
        { characterId: VIVIENNE, name: 'Vivienne', avatarUrl: null },
        { characterId: GONE, name: 'a departed character', avatarUrl: null },
        { characterId: null, name: 'unattributed', avatarUrl: null },
      ],
      lastWornChat: { id: CHAT, title: 'The Thornfield Dinner' },
    });
  });

  it('costs a label, not a 500, when a wearer read throws', async () => {
    findByIdRaw.mockRejectedValue(new Error('vault unavailable'));

    const res = await wearHistory();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wearers[0]).toEqual({ characterId: VIVIENNE, name: 'a departed character', avatarUrl: null });
  });

  it('links the last-worn chat only when it still exists', async () => {
    const body = await (await wearHistory()).json();

    expect(findChatById).toHaveBeenCalledWith(CHAT);
    expect(body.lastWornChat).toBeNull();
  });

  it('answers a never-worn item with an empty history and no chat lookup', async () => {
    findHistory.mockResolvedValue({ ...NEVER_WORN, wearers: [] });

    const body = await (await wearHistory()).json();

    expect(body).toEqual({ history: { ...NEVER_WORN, wearers: [] }, wearers: [], lastWornChat: null });
    expect(findChatById).not.toHaveBeenCalled();
  });

  it('404s for an item not in this store, before touching the ledger', async () => {
    const res = await wearHistory('nope');

    expect(res.status).toBe(404);
    expect(findHistory).not.toHaveBeenCalled();
  });

  it('refuses an unknown action rather than serving the item', async () => {
    const res = await item().GET(req('https://x.test/?action=wear-histroy'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Item PUT
// ============================================================================

describe('item PUT', () => {
  function put(body: unknown, scope: WardrobeScope = 'project', itemId = 'item-1', userId = 'user-1') {
    return item(scope).PUT(req('https://x.test/', body, 'PUT'), ctx(userId), { id: OWNER_ID[scope], itemId });
  }

  it('answers the updated item with origin and wear', async () => {
    const res = await put({ title: 'Overcoat' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      wardrobeItem: { ...wardrobeItem({ title: 'Overcoat' }), origin: PROJECT_ORIGIN, wear: NEVER_WORN },
    });
  });

  it('stamps archivedAt when archiving a live item', async () => {
    await put({ archived: true });

    const patch = mockUpdate.mock.calls[0][2] as { archivedAt?: string | null };
    expect(patch.archivedAt).toEqual(expect.any(String));
  });

  it('is idempotent — re-archiving keeps the original stamp', async () => {
    mockReadItems.mockResolvedValue([wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' })] as never);

    await put({ archived: true });

    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty('archivedAt');
  });

  it('clears the stamp when restoring', async () => {
    mockReadItems.mockResolvedValue([wardrobeItem({ archivedAt: '2026-02-02T00:00:00.000Z' })] as never);

    await put({ archived: false });

    const patch = mockUpdate.mock.calls[0][2] as { archivedAt?: string | null };
    expect(patch.archivedAt).toBeNull();
  });

  it('never touches archivedAt when the body does not mention it', async () => {
    await put({ title: 'Overcoat' });

    const patch = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('archivedAt');
    expect(patch).toMatchObject({ title: 'Overcoat' });
  });

  it('404s on an unknown item before writing', async () => {
    const res = await put({ archived: true }, 'project', 'nope');

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('checks the item exists before the picture choice — a missing item is a 404, not a 400', async () => {
    mockAssertImageChoice.mockRejectedValue(new ForeignWardrobeImageError('foreign'));

    const res = await put({ imageFileId: '0d2b7c1e-6a3f-4c8e-9b51-2f7e3a9d4c10' }, 'project', 'nope');

    expect(res.status).toBe(404);
    expect(mockAssertImageChoice).not.toHaveBeenCalled();
  });

  it.each<WardrobeScope>(['character', 'group', 'project', 'general'])(
    '%s: turns a component cycle into a 400',
    async (scope) => {
      mockUpdate.mockRejectedValue(new WardrobeComponentCycleError('item-1', [['item-1', 'item-1']]));

      const res = await put({ title: 'Loop' }, scope);

      expect(res.status).toBe(400);
    },
  );

  it('404s when the writer reports the item vanished mid-flight', async () => {
    mockUpdate.mockResolvedValue(null);

    const res = await put({ title: 'Overcoat' });

    expect(res.status).toBe(404);
  });

  it("409s an edit in an archived character's vault", async () => {
    mockResolveMount.mockRejectedValue(new CharacterArchivedError(CHAR_ID));

    const res = await put({ title: 'Overcoat' }, 'character');

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s an edit on another user's character", async () => {
    const res = await put({ title: 'Overcoat' }, 'character', 'item-1', 'user-2');

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("a composite whose components change widens over the slots it claimed", async () => {
    mockReadItems.mockResolvedValue([
      wardrobeItem({ id: 'kit', types: ['top', 'bottom'], componentItemIds: ['coat'] }),
      wardrobeItem({ id: 'coat', types: ['top'] }),
      wardrobeItem({ id: 'boots', types: ['footwear'] }),
    ] as never);

    await put({ componentItemIds: ['coat', 'boots'] }, 'project', 'kit');

    const patch = mockUpdate.mock.calls[0][2] as { types: string[] };
    expect([...patch.types].sort()).toEqual(['bottom', 'footwear', 'top']);
  });
});

// ============================================================================
// Item DELETE
// ============================================================================

describe('item DELETE', () => {
  function del(scope: WardrobeScope = 'project', userId = 'user-1') {
    return item(scope).DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(userId), {
      id: OWNER_ID[scope],
      itemId: 'item-1',
    });
  }

  it('clears equipped references before deleting', async () => {
    const order: string[] = [];
    removeEquippedItemFromAllChats.mockImplementation(async () => {
      order.push('cleanup');
    });
    mockDelete.mockImplementation(async () => {
      order.push('delete');
      return true;
    });

    const res = await del();

    expect(order).toEqual(['cleanup', 'delete']);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it("drops the item's wear-ledger rows before deleting", async () => {
    const order: string[] = [];
    deleteByItemIds.mockImplementation(async () => {
      order.push('ledger');
    });
    mockDelete.mockImplementation(async () => {
      order.push('delete');
      return true;
    });

    await del();

    expect(deleteByItemIds).toHaveBeenCalledWith(['item-1']);
    expect(order).toEqual(['ledger', 'delete']);
  });

  it('deletes anyway when the ledger cleanup fails', async () => {
    deleteByItemIds.mockRejectedValue(new Error('ledger busy'));

    const res = await del();

    expect(removeEquippedItemFromAllChats).toHaveBeenCalledWith('item-1');
    expect(mockDelete).toHaveBeenCalledWith(
      { mountPointId: 'mount-1', scope: 'project', characterId: null },
      'item-1',
    );
    expect(res.status).toBe(200);
  });

  it('deletes anyway when the equipped cleanup fails — a dangling reference is harmless', async () => {
    removeEquippedItemFromAllChats.mockRejectedValue(new Error('chats db busy'));

    const res = await del();

    expect(mockDelete).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('404s when there was nothing to delete', async () => {
    mockDelete.mockResolvedValue(false);

    const res = await del();

    expect(res.status).toBe(404);
  });

  it("409s an archived character's item before touching any chat", async () => {
    mockResolveMount.mockRejectedValue(new CharacterArchivedError(CHAR_ID));

    const res = await del('character');

    expect(res.status).toBe(409);
    expect(removeEquippedItemFromAllChats).not.toHaveBeenCalled();
    expect(deleteByItemIds).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404s on another user's character before touching any chat", async () => {
    const res = await del('character', 'user-2');

    expect(res.status).toBe(404);
    expect(removeEquippedItemFromAllChats).not.toHaveBeenCalled();
  });
});

describe('the tier label follows the scope', () => {
  it('says Group for a missing group', async () => {
    const res = await item('group').GET(req('https://x.test/'), ctx(), { id: 'group-gone', itemId: 'item-1' });

    await expect(res.json()).resolves.toEqual({ error: 'Group not found' });
  });

  it('says Archetype wardrobe item for a missing General item', async () => {
    const res = await item('general').GET(req('https://x.test/'), ctx(), { id: '', itemId: 'nope' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Archetype wardrobe item not found' });
  });

  it('500s an item read while General is unprovisioned', async () => {
    mockGeneralMount.mockResolvedValue(null as never);

    const res = await item('general').GET(req('https://x.test/'), ctx(), { id: '', itemId: 'item-1' });

    expect(res.status).toBe(500);
  });
});

describe('item pictures', () => {
  it("PUT refuses an imageFileId that is not one of the item's own pictures, before writing", async () => {
    mockAssertImageChoice.mockRejectedValueOnce(new ForeignWardrobeImageError('foreign'));

    const res = await item().PUT(
      req('https://x.test/', { imageFileId: '0d2b7c1e-6a3f-4c8e-9b51-2f7e3a9d4c10' }, 'PUT'),
      ctx(),
      { id: 'proj-1', itemId: 'item-1' },
    );

    expect(res.status).toBe(400);
    expect(mockAssertImageChoice).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      '0d2b7c1e-6a3f-4c8e-9b51-2f7e3a9d4c10',
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("PUT passes one of the item's own pictures through", async () => {
    const res = await item().PUT(
      req('https://x.test/', { imageFileId: '1e3c8d2f-7b4a-4d9f-8c62-3a8f4b0e5d21' }, 'PUT'),
      ctx(),
      { id: 'proj-1', itemId: 'item-1' },
    );

    expect(res.status).toBe(200);
    const patch = mockUpdate.mock.calls[0][2] as { imageFileId?: string | null };
    expect(patch.imageFileId).toBe('1e3c8d2f-7b4a-4d9f-8c62-3a8f4b0e5d21');
  });

  it("DELETE drops the item's pictures once the item is gone", async () => {
    const order: string[] = [];
    mockDelete.mockImplementation(async () => {
      order.push('delete');
      return true;
    });
    mockCleanupItemImages.mockImplementationOnce(async () => {
      order.push('pictures');
    });

    const res = await item().DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(), {
      id: 'proj-1',
      itemId: 'item-1',
    });

    expect(res.status).toBe(200);
    expect(mockCleanupItemImages).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      '[Projects v1]',
      expect.objectContaining({ mountPointId: 'mount-1' }),
    );
    expect(order).toEqual(['delete', 'pictures']);
  });

  it('DELETE leaves the pictures alone when there was nothing to delete', async () => {
    mockDelete.mockResolvedValue(false);
    await item().DELETE(req('https://x.test/', undefined, 'DELETE'), ctx(), { id: 'proj-1', itemId: 'item-1' });
    expect(mockCleanupItemImages).not.toHaveBeenCalled();
  });
});
