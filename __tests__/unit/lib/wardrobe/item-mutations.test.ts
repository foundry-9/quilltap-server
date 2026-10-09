/**
 * Item mutations (`lib/wardrobe/item-mutations.ts`) — the one way a wardrobe
 * item is created or edited. Pins the composite `types` rule (widen, never
 * narrow — bug 195), the idempotent archive flag (bug 188), the create-body
 * defaults, and which tiers a composite may gather components from.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockLoadWearablePool = jest.fn();
jest.mock('@/lib/wardrobe/pool', () => ({
  loadWearablePool: (...args: unknown[]) => mockLoadWearablePool(...args),
}));

const mockReadGeneralWardrobe = jest.fn();
jest.mock('@/lib/mount-index/general-wardrobe', () => ({
  readGeneralWardrobe: (...args: unknown[]) => mockReadGeneralWardrobe(...args),
}));

const {
  componentLookupFor,
  createItem,
  setItemArchived,
  updateItem,
  validateComponentRefs,
} = require('@/lib/wardrobe/item-mutations') as typeof import('@/lib/wardrobe/item-mutations');
const { buildCompositeTypes } = require('@/lib/wardrobe/composite-types') as typeof import('@/lib/wardrobe/composite-types');

import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

const CHAR_ID = 'char-1';
const STAMP = '2026-01-01T00:00:00.000Z';
const ARCHIVED = '2026-02-02T00:00:00.000Z';

function item(id: string, types: WardrobeItemType[], extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  } as WardrobeItem;
}

const shirt = item('shirt', ['top']);
const trousers = item('trousers', ['bottom']);
const boots = item('boots', ['footwear']);
const LOOKUP = new Map([shirt, trousers, boots].map((i) => [i.id, i]));

function makeLocation(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'character' as const,
    id: CHAR_ID,
    mountPointId: 'vault-1',
    characterId: CHAR_ID as string | null,
    origin: { scope: 'character' as const, id: CHAR_ID, name: 'Ada' },
    readItems: jest.fn(async () => [] as WardrobeItem[]),
    findItem: jest.fn(async () => null),
    create: jest.fn(async (i: WardrobeItem) => i),
    update: jest.fn(async (id: string, patch: Partial<WardrobeItem>) => ({ ...item(id, ['top']), ...patch })),
    delete: jest.fn(async () => true),
    writableMountPointId: jest.fn(async () => 'vault-1'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildCompositeTypes', () => {
  it('unions the components with any designated extras, in canonical slot order', () => {
    expect(buildCompositeTypes([boots, shirt], ['accessories'])).toEqual(['top', 'footwear', 'accessories']);
  });

  it('never narrows below what was designated', () => {
    expect(buildCompositeTypes([shirt], ['top', 'bottom', 'hair'])).toEqual(['top', 'bottom', 'hair']);
  });
});

describe('validateComponentRefs', () => {
  it('splits found from missing, deduplicating', () => {
    expect(validateComponentRefs(LOOKUP, ['shirt', 'ghost', 'shirt', 'boots'])).toEqual({
      components: [shirt, boots],
      missing: ['ghost'],
    });
  });
});

describe('createItem', () => {
  it('applies the create-body defaults and stamps an id', async () => {
    const location = makeLocation();
    const created = await createItem(location as never, {
      title: 'Cravat',
      types: ['accessories'],
      description: '   ',
    } as never);

    expect(location.create).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({
      title: 'Cravat',
      characterId: CHAR_ID,
      types: ['accessories'],
      componentItemIds: [],
      description: null,
      isDefault: false,
      replace: false,
      archivedAt: null,
      imageFileId: null,
      migratedFromClothingRecordId: null,
    });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('owns a shared-tier item to no character', async () => {
    const location = makeLocation({ scope: 'project', id: 'p1', characterId: null });
    const created = await createItem(location as never, { title: 'Apron', types: ['top'] } as never);
    expect(created.characterId).toBeNull();
  });

  it("derives a composite's types from its components plus what it designates", async () => {
    const location = makeLocation();
    const created = await createItem(
      location as never,
      { title: 'Riding kit', types: ['accessories'], componentItemIds: ['shirt', 'boots'] } as never,
      { lookup: LOOKUP },
    );
    expect(created.types).toEqual(['top', 'footwear', 'accessories']);
  });

  it("keeps the body's types for a composite when no lookup is given", async () => {
    const location = makeLocation();
    const created = await createItem(
      location as never,
      { title: 'Kit', types: ['top'], componentItemIds: ['shirt', 'boots'] } as never,
    );
    expect(created.types).toEqual(['top']);
  });

  it('preserves identity and history for a transfer', async () => {
    const location = makeLocation();
    const created = await createItem(location as never, { title: 'Coat', types: ['top'] } as never, {
      preserve: { id: 'kept', createdAt: STAMP, updatedAt: STAMP, archivedAt: ARCHIVED, imageFileId: 'f1' },
    });
    expect(created).toMatchObject({ id: 'kept', createdAt: STAMP, archivedAt: ARCHIVED, imageFileId: 'f1' });
  });
});

describe('updateItem — composite types widen, never narrow (bug 195)', () => {
  const kit = item('kit', ['top', 'bottom', 'accessories'], { componentItemIds: ['shirt', 'trousers'] });

  it('keeps every slot the composite already claimed when components change without restating types', async () => {
    const location = makeLocation();
    await updateItem(location as never, kit, { componentItemIds: ['shirt', 'boots'] }, { lookup: LOOKUP });

    const patch = location.update.mock.calls[0][1] as Partial<WardrobeItem>;
    // bottom stays (already claimed), footwear joins (new component), accessories stays (designated).
    expect(patch.types).toEqual(['top', 'bottom', 'footwear', 'accessories']);
    expect(patch.componentItemIds).toEqual(['shirt', 'boots']);
  });

  it('restated types are the new designation, still widened over the components', async () => {
    const location = makeLocation();
    await updateItem(location as never, kit, { types: ['hair'] }, { lookup: LOOKUP });

    const patch = location.update.mock.calls[0][1] as Partial<WardrobeItem>;
    expect(patch.types).toEqual(['top', 'bottom', 'hair']);
  });

  it('leaves types alone for an edit that touches neither components nor types', async () => {
    const location = makeLocation();
    await updateItem(location as never, kit, { description: 'Pressed.' }, { lookup: LOOKUP });

    const patch = location.update.mock.calls[0][1] as Partial<WardrobeItem>;
    expect(patch).toEqual({ description: 'Pressed.' });
  });

  it('does not touch a leaf garment\'s types', async () => {
    const location = makeLocation();
    await updateItem(location as never, shirt, { types: ['top', 'accessories'] }, { lookup: LOOKUP });
    expect((location.update.mock.calls[0][1] as Partial<WardrobeItem>).types).toEqual(['top', 'accessories']);
  });
});

describe('updateItem — the archived flag', () => {
  it('stamps archivedAt when archiving', async () => {
    const location = makeLocation();
    await updateItem(location as never, shirt, { archived: true });
    const patch = location.update.mock.calls[0][1] as Partial<WardrobeItem>;
    expect(typeof patch.archivedAt).toBe('string');
    expect(patch).not.toHaveProperty('archived');
  });

  it('keeps the original stamp when re-archiving', async () => {
    const location = makeLocation();
    await updateItem(location as never, { ...shirt, archivedAt: ARCHIVED }, { archived: true, title: 'Old shirt' });
    expect(location.update.mock.calls[0][1]).toEqual({ title: 'Old shirt' });
  });

  it('clears archivedAt when restoring', async () => {
    const location = makeLocation();
    await updateItem(location as never, { ...shirt, archivedAt: ARCHIVED }, { archived: false });
    expect(location.update.mock.calls[0][1]).toEqual({ archivedAt: null });
  });
});

describe('setItemArchived — idempotent (bug 188)', () => {
  it('archives an active item', async () => {
    const location = makeLocation();
    const result = await setItemArchived(location as never, shirt, true);
    expect(result.changed).toBe(true);
    expect(location.update).toHaveBeenCalledWith('shirt', { archivedAt: expect.any(String) });
  });

  it('returns an already-archived item untouched, keeping its date', async () => {
    const location = makeLocation();
    const archived = { ...shirt, archivedAt: ARCHIVED };
    const result = await setItemArchived(location as never, archived, true);
    expect(result).toEqual({ item: archived, changed: false });
    expect(location.update).not.toHaveBeenCalled();
  });

  it('restoring an active item is a no-op', async () => {
    const location = makeLocation();
    const result = await setItemArchived(location as never, shirt, false);
    expect(result.changed).toBe(false);
    expect(location.update).not.toHaveBeenCalled();
  });

  it('reports no change when the item vanished under it', async () => {
    const location = makeLocation({ update: jest.fn(async () => null) });
    expect(await setItemArchived(location as never, shirt, true)).toEqual({ item: null, changed: false });
  });
});

describe('componentLookupFor', () => {
  it("is the character's whole wearable pool for a vault", async () => {
    const byId = new Map([['sash', item('sash', ['accessories'])]]);
    mockLoadWearablePool.mockResolvedValue({ byId });
    const repos = {} as never;

    const lookup = await componentLookupFor(repos, makeLocation() as never, ['mp-1']);

    expect(lookup).toBe(byId);
    expect(mockLoadWearablePool).toHaveBeenCalledWith(repos, CHAR_ID, ['mp-1']);
    expect(mockReadGeneralWardrobe).not.toHaveBeenCalled();
  });

  it("is the store's own folder plus General for a shared tier, the folder winning", async () => {
    mockReadGeneralWardrobe.mockResolvedValue([item('hat', ['accessories'], { title: 'General hat' })]);
    const location = makeLocation({
      scope: 'group',
      id: 'g1',
      characterId: null,
      readItems: jest.fn(async () => [item('hat', ['accessories'], { title: 'Group hat' }), item('cloak', ['top'])]),
    });

    const lookup = await componentLookupFor({} as never, location as never);

    expect(mockReadGeneralWardrobe).toHaveBeenCalledWith(true);
    expect(location.readItems).toHaveBeenCalledWith(true);
    expect(lookup.get('hat')!.title).toBe('Group hat');
    expect(lookup.has('cloak')).toBe(true);
    expect(mockLoadWearablePool).not.toHaveBeenCalled();
  });

  it('is just its own folder for General', async () => {
    const location = makeLocation({
      scope: 'general',
      id: null,
      characterId: null,
      readItems: jest.fn(async () => [item('hat', ['accessories'])]),
    });
    const lookup = await componentLookupFor({} as never, location as never);
    expect(mockReadGeneralWardrobe).not.toHaveBeenCalled();
    expect(Array.from(lookup.keys())).toEqual(['hat']);
  });
});
