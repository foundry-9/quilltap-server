/**
 * The wearable pool (`lib/wardrobe/pool.ts`) — everything one character can
 * reach, read once per request.
 *
 * Strategy: run the real loader and the real `WardrobeRepository` tier reader,
 * mocking only the leaves — the character overlay, the per-mount shared
 * reader (which serves General, project and group stores alike), the group /
 * project mount resolvers, the General mount id, and the project roster.
 * Assert the merge rule (character > group > project > general), the
 * archived-before-shadow rule, `findByTitle`'s own-first order, `owns`, the
 * shared-tier batching, and the degradation when a store can't be read.
 *
 * (Repurposed from wardrobe.repository.pool.test.ts, which covered the
 * deleted `findWearablePoolForCharacter` / `findArchetypes*` repository reads.)
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/database/repositories/character-properties-overlay', () => ({
  getOverlaidWardrobeItems: jest.fn(),
}));

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  createInMount: jest.fn(),
  updateInMount: jest.fn(),
  deleteInMount: jest.fn(),
  resolveWardrobeMount: jest.fn(),
}));

jest.mock('@/lib/mount-index/shared-wardrobe', () => ({
  readSharedWardrobe: jest.fn(),
}));

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountsForCharacter: jest.fn(),
  resolveProjectMountPointIds: jest.fn(),
}));

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/projects/roster-access', () => ({
  rosterGatedProjectId: jest.fn(),
}));

const {
  buildWearablePool,
  componentGraph,
  createSharedTierLoader,
  loadCastPools,
  loadWearablePool,
  resolveProjectTierForChat,
} = require('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool');
const { WardrobeRepository } = require('@/lib/database/repositories/wardrobe.repository');
const { getOverlaidWardrobeItems } = require('@/lib/database/repositories/character-properties-overlay');
const { readSharedWardrobe } = require('@/lib/mount-index/shared-wardrobe');
const tiered = require('@/lib/mount-index/tiered-mount-pool');
const { getGeneralMountPointId } = require('@/lib/instance-settings');
const { rosterGatedProjectId } = require('@/lib/projects/roster-access');

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItemWithOrigin, WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';

const mockOverlay = getOverlaidWardrobeItems as jest.Mock;
/** Serves every shared tier — General, project and group stores alike. */
const mockMount = readSharedWardrobe as jest.Mock;
const mockGroups = tiered.resolveGroupMountsForCharacter as jest.Mock;
const mockProjectMounts = tiered.resolveProjectMountPointIds as jest.Mock;
const mockGeneralId = getGeneralMountPointId as jest.Mock;
const mockRoster = rosterGatedProjectId as jest.Mock;

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001';
const GENERAL_MP = 'general-mp';
const ARCHIVED = '2026-02-02T00:00:00.000Z';

function item(id: string, tier: string, overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: null,
    title: `${id} (${tier})`,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Titles keyed by id, so precedence assertions read as "which tier won". */
function titlesById(items: Iterable<{ id: string; title: string }>) {
  return Object.fromEntries(Array.from(items, (i) => [i.id, i.title]));
}

/** Per-mount contents for the shared reader; honours includeArchived. */
function serveMounts(byMount: Record<string, WardrobeItem[] | Error>) {
  mockMount.mockImplementation(async (mountPointId: string, includeArchived = false) => {
    const contents = byMount[mountPointId] ?? [];
    if (contents instanceof Error) throw contents;
    return includeArchived ? contents : contents.filter((i) => !i.archivedAt);
  });
}

/** The character's own vault; honours includeArchived. */
function serveOwn(items: WardrobeItem[]) {
  mockOverlay.mockImplementation(async (_id: string, opts: { includeArchived?: boolean } = {}) =>
    opts.includeArchived ? items : items.filter((i) => !i.archivedAt),
  );
}

let repos: {
  wardrobe: InstanceType<typeof WardrobeRepository>;
  projects: Record<string, jest.Mock>;
  chats: { findById: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  repos = {
    wardrobe: new WardrobeRepository(),
    projects: {},
    chats: { findById: jest.fn().mockResolvedValue(null) },
  };
  serveOwn([]);
  serveMounts({});
  mockGroups.mockResolvedValue([]);
  mockProjectMounts.mockResolvedValue([]);
  mockGeneralId.mockResolvedValue(GENERAL_MP);
  mockRoster.mockImplementation(async (projectId: string) => projectId);
});

function load(projectMountPointIds?: string[], opts?: Parameters<typeof loadWearablePool>[3]) {
  return loadWearablePool(repos as never, CHAR_ID, projectMountPointIds, opts);
}

describe('loadWearablePool — precedence', () => {
  it('applies precedence character > group > project > general', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'The Guild' }, mountPointIds: ['grp-1'] }]);
    serveMounts({
      [GENERAL_MP]: [item('shared', 'general'), item('g-only', 'general')],
      'grp-1': [item('shared', 'group'), item('grp-only', 'group')],
      'mp-1': [item('shared', 'project'), item('p-only', 'project')],
    });
    serveOwn([item('c-only', 'character', { characterId: CHAR_ID })]);

    const pool = await load(['mp-1']);

    expect(titlesById(pool.wearable())).toEqual({
      shared: 'shared (group)',
      'g-only': 'g-only (general)',
      'p-only': 'p-only (project)',
      'grp-only': 'grp-only (group)',
      'c-only': 'c-only (character)',
    });
    expect(pool.tiers).toEqual({ groupMountPointIds: ['grp-1'], projectMountPointIds: ['mp-1'] });
  });

  it('tags each item with the tier that won it', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'The Guild' }, mountPointIds: ['grp-1'] }]);
    serveMounts({ [GENERAL_MP]: [item('hat', 'general')], 'grp-1': [item('sash', 'group')] });
    serveOwn([item('coat', 'character')]);

    const pool = await load([]);

    expect(pool.get('hat')!.origin.scope).toBe('general');
    expect(pool.get('sash')!.origin).toEqual({ scope: 'group', id: 'G1', name: 'The Guild' });
    expect(pool.get('coat')!.origin).toMatchObject({ scope: 'character', id: CHAR_ID });
    // Own items are coerced to the character, whatever the vault said.
    expect(pool.get('coat')!.characterId).toBe(CHAR_ID);
  });

  it('lets the character shadow a group item they hold their own copy of', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'G' }, mountPointIds: ['grp-1'] }]);
    serveMounts({ 'grp-1': [item('livery', 'group')] });
    serveOwn([item('livery', 'character', { characterId: CHAR_ID })]);

    const pool = await load([]);

    expect(titlesById(pool.byId.values())).toEqual({ livery: 'livery (character)' });
  });

  it('offers the group tier even with no project in scope', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'G' }, mountPointIds: ['grp-1'] }]);
    serveMounts({ 'grp-1': [item('house-livery', 'group')] });

    const pool = await load([]);

    expect(titlesById(pool.wearable())).toEqual({ 'house-livery': 'house-livery (group)' });
    // Tiers are read archived-included; wearable() filters.
    expect(mockMount).toHaveBeenCalledWith('grp-1', true);
  });

  it('lets the last mount win a collision between stores of the same tier', async () => {
    serveMounts({ 'mp-1': [item('livery', 'project-mp-1')], 'mp-2': [item('livery', 'project-mp-2')] });

    const pool = await load(['mp-1', 'mp-2']);

    expect(titlesById(pool.wearable())).toEqual({ livery: 'livery (project-mp-2)' });
  });
});

describe('loadWearablePool — archived items', () => {
  it('drops archived shared items from wearable() but keeps them in byId', async () => {
    serveMounts({ [GENERAL_MP]: [item('live', 'general'), item('gone', 'general', { archivedAt: ARCHIVED })] });

    const pool = await load([]);

    expect(pool.wearable().map((i) => i.id)).toEqual(['live']);
    expect(pool.get('gone')?.archivedAt).toBe(ARCHIVED);
  });

  it('drops archived items per tier BEFORE shadowing: an archived own copy never hides the shared one', async () => {
    serveMounts({ [GENERAL_MP]: [item('livery', 'general')] });
    serveOwn([item('livery', 'character', { characterId: CHAR_ID, archivedAt: ARCHIVED })]);

    const pool = await load([]);

    expect(titlesById(pool.wearable())).toEqual({ livery: 'livery (general)' });
    // byId still shadows — the archived own copy is what an equipped id resolves to.
    expect(pool.get('livery')!.title).toBe('livery (character)');
  });

  it('an archived group copy does not hide the project item it shadows', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'G' }, mountPointIds: ['grp-1'] }]);
    serveMounts({
      'grp-1': [item('cloak', 'group', { archivedAt: ARCHIVED })],
      'mp-1': [item('cloak', 'project')],
    });

    const pool = await load(['mp-1']);

    expect(titlesById(pool.wearable())).toEqual({ cloak: 'cloak (project)' });
  });

  it('reads the own vault archived-included', async () => {
    await load([]);
    expect(mockOverlay).toHaveBeenCalledWith(CHAR_ID, { includeArchived: true });
  });
});

describe('WearablePool lookups', () => {
  const OWN: WardrobeOrigin = { scope: 'character', id: CHAR_ID, name: '' };
  const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' };
  const GROUP: WardrobeOrigin = { scope: 'group', id: 'G1', name: 'G' };
  const tag = (items: WardrobeItem[], origin: WardrobeOrigin): WardrobeItemWithOrigin[] =>
    items.map((i) => ({ ...i, origin }));

  function pool(layers: { own?: WardrobeItem[]; group?: WardrobeItem[]; general?: WardrobeItem[] }) {
    return buildWearablePool(
      CHAR_ID,
      { groupMountPointIds: [], projectMountPointIds: [] },
      {
        own: tag((layers.own ?? []).map((i) => ({ ...i, characterId: CHAR_ID })), OWN),
        group: tag(layers.group ?? [], GROUP),
        project: [],
        general: tag(layers.general ?? [], GENERAL),
      },
    );
  }

  describe('findByTitle', () => {
    it("prefers the character's own item over a shared one with the same title", () => {
      const p = pool({
        own: [item('mine', 'x', { title: 'Red Scarf' })],
        general: [item('theirs', 'x', { title: 'Red Scarf' })],
      });
      expect(p.findByTitle('red scarf')?.id).toBe('mine');
    });

    it('finds an own item even when archived (own first, archived included)', () => {
      const p = pool({
        own: [item('mine', 'x', { title: 'Red Scarf', archivedAt: ARCHIVED })],
        general: [item('theirs', 'x', { title: 'Red Scarf' })],
      });
      expect(p.findByTitle('Red Scarf')?.id).toBe('mine');
    });

    it('falls back to the wearable shared set, case-insensitive and trimmed', () => {
      const p = pool({ group: [item('sash', 'x', { title: 'Guild Sash' })] });
      expect(p.findByTitle('  GUILD sash ')?.id).toBe('sash');
    });

    it('never matches an archived shared item', () => {
      const p = pool({ general: [item('old', 'x', { title: 'Old Hat', archivedAt: ARCHIVED })] });
      expect(p.findByTitle('Old Hat')).toBeUndefined();
    });

    it('returns undefined for an empty title', () => {
      const p = pool({ own: [item('a', 'x', { title: '' })] });
      expect(p.findByTitle('   ')).toBeUndefined();
    });
  });

  describe('owns', () => {
    it("is true only for an item in this character's vault", () => {
      const p = pool({ own: [item('mine', 'x')], general: [item('theirs', 'x')] });
      expect(p.owns(p.get('mine')!)).toBe(true);
      expect(p.owns(p.get('theirs')!)).toBe(false);
    });

    it("is false for a shared item that merely claims the character's id", () => {
      const p = pool({ general: [item('impostor', 'x', { characterId: CHAR_ID })] });
      expect(p.owns(p.get('impostor')!)).toBe(false);
    });

    it("is false for another character's item that happens to share an own id", () => {
      const p = pool({ own: [item('mine', 'x')] });
      expect(p.owns({ id: 'mine', characterId: 'someone-else' })).toBe(false);
    });
  });

  it('getMany keeps the asked order, skips unknowns and duplicates', () => {
    const p = pool({ own: [item('a', 'x')], general: [item('b', 'x')] });
    expect(p.getMany(['b', 'nope', 'a', 'b']).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('componentGraph walks composites transitively across tiers and tolerates cycles', () => {
    const p = pool({
      own: [item('outfit', 'x', { componentItemIds: ['sash', 'inner'] })],
      group: [item('sash', 'x')],
      general: [
        item('inner', 'x', { componentItemIds: ['leaf', 'outfit'] }),
        item('leaf', 'x'),
      ],
    });
    expect(Array.from(componentGraph(p, ['outfit']).keys()).sort()).toEqual(['inner', 'leaf', 'outfit', 'sash']);
  });
});

describe('loadWearablePool — project tier', () => {
  it('resolves the project tier from chatId behind the roster when none is passed', async () => {
    repos.chats.findById.mockResolvedValue({ id: 'chat-1', projectId: 'proj-1' });
    mockProjectMounts.mockResolvedValue(['mp-1']);
    serveMounts({ 'mp-1': [item('apron', 'project')] });

    const pool = await load(undefined, { chatId: 'chat-1' });

    expect(mockRoster).toHaveBeenCalledWith('proj-1', CHAR_ID);
    expect(pool.tiers.projectMountPointIds).toEqual(['mp-1']);
    expect(pool.get('apron')).toBeDefined();
  });

  it('withholds the project tier from a character off the roster', async () => {
    repos.chats.findById.mockResolvedValue({ id: 'chat-1', projectId: 'proj-1' });
    mockRoster.mockResolvedValue(undefined);

    expect(await resolveProjectTierForChat(repos as never, 'chat-1', CHAR_ID)).toEqual([]);
    expect(mockProjectMounts).not.toHaveBeenCalled();
  });

  it('the operator bypasses the roster', async () => {
    repos.chats.findById.mockResolvedValue({ id: 'chat-1', projectId: 'proj-1' });
    mockRoster.mockResolvedValue(undefined);
    mockProjectMounts.mockResolvedValue(['mp-1']);

    expect(await resolveProjectTierForChat(repos as never, 'chat-1', CHAR_ID, { operator: true })).toEqual(['mp-1']);
    expect(mockRoster).not.toHaveBeenCalled();
  });

  it('an explicit (even empty) project tier skips the chat lookup', async () => {
    await load([], { chatId: 'chat-1' });
    expect(repos.chats.findById).not.toHaveBeenCalled();
  });
});

describe('loadWearablePool — I/O shape', () => {
  it('skips the vault read when the caller hands over ownItems', async () => {
    const pool = await load([], { ownItems: [item('handed', 'character')] });
    expect(mockOverlay).not.toHaveBeenCalled();
    expect(pool.owns(pool.get('handed')!)).toBe(true);
  });

  it('shares the character-independent tiers across a batch', async () => {
    serveMounts({ [GENERAL_MP]: [item('hat', 'general')], 'mp-1': [item('apron', 'project')] });
    const loader = createSharedTierLoader(repos as never, ['mp-1']);

    const a = await load(['mp-1'], { sharedTiers: loader() });
    const b = await load(['mp-1'], { sharedTiers: loader() });

    expect(a.get('hat')).toBeDefined();
    expect(b.get('apron')).toBeDefined();
    // One read of General, one of the project store — not two each.
    expect(mockMount.mock.calls.filter(([mp]) => mp === GENERAL_MP)).toHaveLength(1);
    expect(mockMount.mock.calls.filter(([mp]) => mp === 'mp-1')).toHaveLength(1);
  });

  it('loadCastPools reads the shared tiers once and each character sees only their own groups', async () => {
    mockProjectMounts.mockResolvedValue(['mp-1']);
    mockGroups.mockImplementation(async (characterId: string) =>
      characterId === 'char-a' ? [{ group: { id: 'GA', name: 'A' }, mountPointIds: ['grp-a'] }] : [],
    );
    serveMounts({
      [GENERAL_MP]: [item('hat', 'general')],
      'mp-1': [item('apron', 'project')],
      'grp-a': [item('sash', 'group')],
    });

    const pools = await loadCastPools(repos as never, 'proj-1', ['char-a', 'char-b']);

    expect(pools.get('char-a')!.get('sash')).toBeDefined();
    expect(pools.get('char-b')!.get('sash')).toBeUndefined();
    expect(pools.get('char-b')!.get('apron')).toBeDefined();
    expect(mockMount.mock.calls.filter(([mp]) => mp === GENERAL_MP)).toHaveLength(1);
    expect(mockMount.mock.calls.filter(([mp]) => mp === 'mp-1')).toHaveLength(1);
  });

  it('reads no shared store when nothing but General is in scope and General is unprovisioned', async () => {
    mockGeneralId.mockResolvedValue(null);
    await load([]);
    expect(mockMount).not.toHaveBeenCalled();
  });
});

describe('loadWearablePool — degradation', () => {
  it('skips a failing store and keeps the other tiers', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'G' }, mountPointIds: ['grp-broken'] }]);
    serveMounts({
      [GENERAL_MP]: [item('g-only', 'general')],
      'grp-broken': new Error('store offline'),
      'mp-ok': [item('p-only', 'project')],
    });
    serveOwn([item('c-only', 'character', { characterId: CHAR_ID })]);

    const pool = await load(['mp-ok']);

    expect(pool.wearable().map((i) => i.id).sort()).toEqual(['c-only', 'g-only', 'p-only']);
  });

  it('keeps the shared tiers when the character vault cannot be read', async () => {
    serveMounts({ [GENERAL_MP]: [item('g-only', 'general')] });
    mockOverlay.mockRejectedValue(new Error('vault offline'));

    const pool = await load([]);

    expect(pool.wearable().map((i) => i.id)).toEqual(['g-only']);
  });

  it('keeps the group tier from one store when a sibling store of the same group fails', async () => {
    mockGroups.mockResolvedValue([{ group: { id: 'G1', name: 'G' }, mountPointIds: ['grp-broken', 'grp-ok'] }]);
    serveMounts({ 'grp-broken': new Error('offline'), 'grp-ok': [item('sash', 'group')] });

    const pool = await load([]);

    expect(pool.wearable().map((i) => i.id)).toEqual(['sash']);
  });
});

describe('WardrobeRepository.readSharedTiers', () => {
  const SISTERS: WardrobeOrigin = { scope: 'group', id: 'G1', name: 'The Sisters' };
  const REGIMENT: WardrobeOrigin = { scope: 'group', id: 'G2', name: 'The Regiment' };
  const originOf = (mp: string) => (mp === 'm-sisters' ? SISTERS : REGIMENT);

  it('tags every item with the origin of the store it hangs in', async () => {
    serveMounts({ 'm-sisters': [item('shawl', 'sisters')], 'm-regiment': [item('kit', 'regiment')] });

    const items = await repos.wardrobe.readSharedTiers(['m-sisters', 'm-regiment'], false, originOf);

    expect(Object.fromEntries(items.map((i: WardrobeItemWithOrigin) => [i.id, i.origin]))).toEqual({
      shawl: SISTERS,
      kit: REGIMENT,
    });
  });

  it('lets the later mount win an id collision, keeping its own origin', async () => {
    serveMounts({ 'm-sisters': [item('livery', 'sisters')], 'm-regiment': [item('livery', 'regiment')] });

    const items = await repos.wardrobe.readSharedTiers(['m-sisters', 'm-regiment'], false, originOf);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('livery (regiment)');
    expect(items[0].origin).toEqual(REGIMENT);
  });

  it('passes includeArchived through to the store reader', async () => {
    serveMounts({ 'm-sisters': [item('old', 'sisters', { archivedAt: ARCHIVED })] });
    expect(await repos.wardrobe.readSharedTiers(['m-sisters'], false, originOf)).toEqual([]);
    expect(await repos.wardrobe.readSharedTiers(['m-sisters'], true, originOf)).toHaveLength(1);
  });

  it('skips an unreadable store and keeps the others', async () => {
    serveMounts({ 'm-sisters': new Error('offline'), 'm-regiment': [item('kit', 'regiment')] });
    const items = await repos.wardrobe.readSharedTiers(['m-sisters', 'm-regiment'], false, originOf);
    expect(items.map((i: WardrobeItemWithOrigin) => i.id)).toEqual(['kit']);
  });

  it('reads nothing for an empty mount list', async () => {
    expect(await repos.wardrobe.readSharedTiers([], false, originOf)).toEqual([]);
    expect(mockMount).not.toHaveBeenCalled();
  });
});
