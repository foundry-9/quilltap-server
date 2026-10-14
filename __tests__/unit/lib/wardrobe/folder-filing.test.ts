/**
 * Folder filing with components (`lib/wardrobe/folder-filing.ts`) — moving or
 * copying items to a folder of one wardrobe, an outfit's same-wardrobe
 * components moved, copied or left behind. Pins the five combinations, that
 * borrowed components never travel, that copies take `(copy)` titles and are
 * rewired to one another, and that a copy cannot move its components.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCarryItemImages = jest.fn();
jest.mock('@/lib/wardrobe/item-images', () => ({
  carryItemImages: (...args: unknown[]) => mockCarryItemImages(...args),
}));

jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }));

const { fileItemsToFolder, FolderFilingRequestError } =
  require('@/lib/wardrobe/folder-filing') as typeof import('@/lib/wardrobe/folder-filing');
const { resolveWardrobeFolder, WardrobeItemNotInLocationError } =
  require('@/lib/wardrobe/folders') as typeof import('@/lib/wardrobe/folders');

import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

const CHAR_ID = 'char-1';
const STAMP = '2026-01-01T00:00:00.000Z';

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
    imageFileId: null,
    folder: '',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  } as WardrobeItem;
}

const shirt = item('shirt', ['top'], { title: 'Shirt', imageFileId: 'img-shirt' });
const trousers = item('trousers', ['bottom'], { title: 'Trousers' });
// A nested piece: the suit bundles the shirt, the outfit bundles the suit.
const suit = item('suit', ['top', 'bottom'], { title: 'Suit', componentItemIds: ['shirt', 'trousers'] });
// `general-hat` is borrowed from General — not in this wardrobe, so it stays put.
const outfit = item('outfit', ['top', 'bottom', 'head'], {
  title: 'Outfit',
  componentItemIds: ['suit', 'general-hat'],
});
const ITEMS = [shirt, trousers, suit, outfit];

function makeLocation() {
  return {
    scope: 'character' as const,
    id: CHAR_ID,
    mountPointId: 'vault-1',
    characterId: CHAR_ID as string | null,
    readItems: jest.fn(async () => ITEMS),
    create: jest.fn(async (i: WardrobeItem) => i),
    writableMountPointId: jest.fn(async () => 'vault-1'),
    resolveFolder: jest.fn(async (requested: string) => resolveWardrobeFolder(['Formal'], requested)),
    updateMany: jest.fn(async (patches: Array<{ id: string; patch: Partial<WardrobeItem> }>) =>
      patches.map(({ id, patch }) => ({ ...(ITEMS.find((i) => i.id === id) as WardrobeItem), ...patch })),
    ),
  };
}

beforeEach(() => {
  mockCarryItemImages.mockReset();
  mockCarryItemImages.mockImplementation(async (_repos: unknown, args: { sourceItemId: string }) => ({
    fileIdMap: new Map(args.sourceItemId === 'shirt' ? [['img-shirt', 'img-shirt-copy']] : []),
    pendingMove: { repoints: [] },
  }));
});

describe('fileItemsToFolder', () => {
  it('a move with components left behind files the items alone', async () => {
    const location = makeLocation();
    const result = await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'move',
      itemIds: ['outfit'],
      folder: 'formal',
    });
    expect(location.updateMany).toHaveBeenCalledWith([{ id: 'outfit', patch: { folder: 'Formal' } }], {
      requireAll: true,
    });
    expect(location.create).not.toHaveBeenCalled();
    expect(result.componentsCarried).toBe(0);
  });

  it('a move with components moved files the whole same-wardrobe closure in one batch', async () => {
    const location = makeLocation();
    const result = await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'move',
      itemIds: ['outfit'],
      folder: 'formal',
      components: 'move',
    });
    expect(location.updateMany).toHaveBeenCalledTimes(1);
    const ids = location.updateMany.mock.calls[0][0].map((p: { id: string }) => p.id);
    expect(ids).toEqual(['outfit', 'suit', 'shirt', 'trousers']);
    expect(result.items.map((i) => i.id)).toEqual(['outfit']);
    expect(result.componentsCarried).toBe(3);
    expect(location.create).not.toHaveBeenCalled();
  });

  it('a move with components copied lands copies and rewires the moved outfit to them', async () => {
    const location = makeLocation();
    await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'move',
      itemIds: ['outfit'],
      folder: 'Formal',
      components: 'copy',
    });
    const created = location.create.mock.calls.map(([c]: [WardrobeItem]) => c);
    expect(created.map((c) => c.title)).toEqual(['Suit (copy)', 'Shirt (copy)', 'Trousers (copy)']);
    expect(created.every((c) => c.folder === 'Formal')).toBe(true);
    const suitCopy = created[0];
    const [shirtCopy, trousersCopy] = [created[1], created[2]];
    expect(suitCopy.componentItemIds).toEqual([shirtCopy.id, trousersCopy.id]);
    expect(shirtCopy.imageFileId).toBe('img-shirt-copy');
    expect(mockCarryItemImages).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ mode: 'copy', sourceItemId: 'shirt', destinationMountPointId: 'vault-1' }),
    );

    const [patches] = location.updateMany.mock.calls[0];
    expect(patches).toEqual([
      { id: 'outfit', patch: { folder: 'Formal', componentItemIds: [suitCopy.id, 'general-hat'] } },
    ]);
  });

  it('a copy with components left behind copies the outfit naming the original pieces', async () => {
    const location = makeLocation();
    const result = await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'copy',
      itemIds: ['outfit'],
      folder: '',
      components: 'none',
    });
    expect(location.create).toHaveBeenCalledTimes(1);
    const copy = result.items[0];
    expect(copy.id).not.toBe('outfit');
    expect(copy.title).toBe('Outfit (copy)');
    expect(copy.componentItemIds).toEqual(['suit', 'general-hat']);
    expect(location.updateMany).not.toHaveBeenCalled();
  });

  it('a copy with components copied rewires the copy to the copied pieces', async () => {
    const location = makeLocation();
    const result = await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'copy',
      itemIds: ['outfit'],
      folder: 'Formal',
      components: 'copy',
    });
    const created = location.create.mock.calls.map(([c]: [WardrobeItem]) => c);
    expect(created).toHaveLength(4);
    // Components land before the outfit that names them.
    expect(created[created.length - 1].title).toBe('Outfit (copy)');
    const suitCopy = created.find((c) => c.title === 'Suit (copy)') as WardrobeItem;
    expect(result.items[0].componentItemIds).toEqual([suitCopy.id, 'general-hat']);
    expect(result.componentsCarried).toBe(3);
  });

  it('copying an item and one of its components together names the copy, not the original', async () => {
    const location = makeLocation();
    const result = await fileItemsToFolder({} as never, 'user-1', location as never, {
      action: 'copy',
      itemIds: ['suit', 'shirt'],
      folder: 'Formal',
    });
    const [suitCopy, shirtCopy] = result.items;
    expect(suitCopy.componentItemIds).toEqual([shirtCopy.id, 'trousers']);
  });

  it('refuses a copy that would move its components', async () => {
    await expect(
      fileItemsToFolder({} as never, 'user-1', makeLocation() as never, {
        action: 'copy',
        itemIds: ['outfit'],
        folder: 'Formal',
        components: 'move',
      }),
    ).rejects.toBeInstanceOf(FolderFilingRequestError);
  });

  it('refuses an item not filed in this wardrobe before writing anything', async () => {
    const location = makeLocation();
    await expect(
      fileItemsToFolder({} as never, 'user-1', location as never, {
        action: 'copy',
        itemIds: ['outfit', 'general-hat'],
        folder: 'Formal',
        components: 'copy',
      }),
    ).rejects.toBeInstanceOf(WardrobeItemNotInLocationError);
    expect(location.create).not.toHaveBeenCalled();
  });
});
