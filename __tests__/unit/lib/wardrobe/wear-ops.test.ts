/**
 * Wear operations (`lib/wardrobe/wear-ops.ts`) — the shared front half of
 * every put-on / take-off gesture. `resolveWearable` gives one refusal with
 * one set of words (not found, archived — bug 191, slot), and `wearItem` /
 * `takeOffItem` commit through `applyDisplacement`.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockApplyDisplacement = jest.fn();
jest.mock('@/lib/wardrobe/outfit-displacement', () => ({
  applyDisplacement: (...args: unknown[]) => mockApplyDisplacement(...args),
}));

const {
  findInPool,
  resolveWearable,
  takeOffItem,
  wardrobeItemNotFoundMessage,
  wearItem,
} = require('@/lib/wardrobe/wear-ops') as typeof import('@/lib/wardrobe/wear-ops');
const { buildWearablePool } = require('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool');
const { archivedWearMessage } = require('@/lib/wardrobe/wearable') as typeof import('@/lib/wardrobe/wearable');

import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';

const CHAR_ID = 'char-1';
const CHAT_ID = 'chat-1';
const STAMP = '2026-01-01T00:00:00.000Z';

function item(id: string, title: string, types: WardrobeItemType[], extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: CHAR_ID,
    title,
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

const OWN: WardrobeOrigin = { scope: 'character', id: CHAR_ID, name: '' };
const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

const shirt = item('shirt', 'Linen Shirt', ['top']);
const coat = item('coat', 'Old Coat', ['top'], { archivedAt: STAMP });
const dress = item('dress', 'Sundress', ['top', 'bottom'], { replace: true });
const generalHat = { ...item('hat', 'Bowler Hat', ['accessories']), characterId: null };

const pool = buildWearablePool(
  CHAR_ID,
  { groupMountPointIds: [], projectMountPointIds: [] },
  {
    own: [shirt, coat, dress].map((i) => ({ ...i, origin: OWN })),
    group: [],
    project: [],
    general: [{ ...generalHat, origin: GENERAL }],
  },
);

const empty = (): EquippedSlots => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] });
const repos = { chats: {}, wardrobeWear: {} } as never;

beforeEach(() => {
  mockApplyDisplacement.mockReset().mockImplementation(async () => empty());
});

describe('findInPool', () => {
  it('finds by id first, then by title', () => {
    expect(findInPool(pool, { itemId: 'hat' })?.id).toBe('hat');
    expect(findInPool(pool, { itemTitle: 'linen shirt' })?.id).toBe('shirt');
    expect(findInPool(pool, { itemId: 'nope', itemTitle: 'Bowler Hat' })?.id).toBe('hat');
  });

  it('finds archived items (refusing them is resolveWearable\'s job)', () => {
    expect(findInPool(pool, { itemId: 'coat' })?.id).toBe('coat');
  });

  it('returns null for an empty reference', () => {
    expect(findInPool(pool, {})).toBeNull();
  });
});

describe('resolveWearable', () => {
  it('resolves a wearable item from any tier', () => {
    expect(resolveWearable(pool, { itemId: 'shirt' }, 'wear')).toEqual({ ok: true, item: pool.get('shirt') });
    expect(resolveWearable(pool, { itemTitle: 'Bowler Hat' }, 'replace')).toMatchObject({ ok: true });
  });

  it('refuses an unknown item as not_found, naming what was asked for', () => {
    expect(resolveWearable(pool, { itemId: 'ghost', itemTitle: 'Ghost Cape' }, 'wear')).toEqual({
      ok: false,
      reason: 'not_found',
      message: wardrobeItemNotFoundMessage('ghost', 'Ghost Cape'),
    });
    expect(wardrobeItemNotFoundMessage('ghost', 'Ghost Cape')).toBe(
      'Wardrobe item not found with ID "ghost" with title "Ghost Cape"',
    );
  });

  it.each(['wear', 'replace', 'add_to_slot'] as const)('refuses an archived item for %s (bug 191)', (mode) => {
    expect(resolveWearable(pool, { itemId: 'coat' }, mode, 'top')).toEqual({
      ok: false,
      reason: 'archived',
      message: archivedWearMessage('Old Coat'),
    });
  });

  it('refuses add_to_slot into a slot the item does not cover', () => {
    const result = resolveWearable(pool, { itemId: 'shirt' }, 'add_to_slot', 'footwear');
    expect(result).toMatchObject({ ok: false, reason: 'slot' });
    expect((result as { message: string }).message).toContain('"footwear"');
  });

  it('allows add_to_slot into a covered slot, and ignores the slot for wear', () => {
    expect(resolveWearable(pool, { itemId: 'dress' }, 'add_to_slot', 'bottom')).toMatchObject({ ok: true });
    expect(resolveWearable(pool, { itemId: 'shirt' }, 'wear', 'footwear')).toMatchObject({ ok: true });
  });
});

describe('wearItem', () => {
  it('commits through applyDisplacement with the pool as the composite lookup', async () => {
    const outcome = await wearItem(repos, CHAT_ID, pool, pool.get('shirt')!, 'wear', undefined, 'tool');

    expect(mockApplyDisplacement).toHaveBeenCalledWith(
      repos,
      CHAT_ID,
      CHAR_ID,
      { mode: 'wear', item: pool.get('shirt'), slot: undefined, itemsById: pool.byId },
      'tool',
    );
    expect(outcome).toMatchObject({ effect: 'layered', slotsAffected: ['top'] });
  });

  it('reports replaced for a replace-flagged item or the replace mode', async () => {
    expect((await wearItem(repos, CHAT_ID, pool, pool.get('dress')!, 'wear', undefined, 'ui')).effect).toBe('replaced');
    expect((await wearItem(repos, CHAT_ID, pool, pool.get('shirt')!, 'replace', undefined, 'ui')).effect).toBe('replaced');
  });

  it('add_to_slot layers into the one named slot', async () => {
    const outcome = await wearItem(repos, CHAT_ID, pool, pool.get('dress')!, 'add_to_slot', 'bottom', 'ui');
    expect(outcome).toMatchObject({ effect: 'layered', slotsAffected: ['bottom'] });
  });
});

describe('takeOffItem', () => {
  it('removes the item from each named slot, one remove_from_slot per slot', async () => {
    await takeOffItem(repos, CHAT_ID, CHAR_ID, 'dress', ['top', 'bottom']);
    expect(mockApplyDisplacement.mock.calls.map((c) => c[3])).toEqual([
      { mode: 'remove_from_slot', slot: 'top', itemId: 'dress' },
      { mode: 'remove_from_slot', slot: 'bottom', itemId: 'dress' },
    ]);
  });
});
