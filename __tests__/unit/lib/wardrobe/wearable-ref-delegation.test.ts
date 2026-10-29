/**
 * The server's title lookup shares the Workbench's rule: `findInPool` reaches
 * `WearablePool.findByTitle`, which delegates to `matchWearableTitle`
 * (`lib/wardrobe/wearable-ref.ts`) — own items first, then the wearable
 * shared set. If this test fails, the applier and the Workbench's reference
 * chips may disagree about which garment a title names
 * (pascal-wardrobe-effect-picker §2.1).
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockMatch = jest.fn();
jest.mock('@/lib/wardrobe/wearable-ref', () => {
  const actual = jest.requireActual('@/lib/wardrobe/wearable-ref');
  return {
    ...actual,
    matchWearableTitle: (...args: unknown[]) => {
      mockMatch(...args);
      return (actual.matchWearableTitle as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const { findInPool } = require('@/lib/wardrobe/wear-ops') as typeof import('@/lib/wardrobe/wear-ops');
const { buildWearablePool } = require('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool');

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';

const STAMP = '2026-01-01T00:00:00.000Z';
const OWN: WardrobeOrigin = { scope: 'character', id: 'char-1', name: 'Imogen' };
const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

function item(id: string, title: string, characterId: string | null, extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId,
    title,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  } as WardrobeItem;
}

const pool = buildWearablePool(
  'char-1',
  { groupMountPointIds: [], projectMountPointIds: [] },
  {
    own: [{ ...item('own-coat', 'Old Coat', 'char-1', { archivedAt: STAMP }), origin: OWN }],
    group: [],
    project: [],
    general: [
      { ...item('gen-coat', 'Old Coat', null), origin: GENERAL },
      { ...item('gen-hat', 'Bowler Hat', null), origin: GENERAL },
    ],
  },
);

beforeEach(() => mockMatch.mockClear());

describe('findInPool title half', () => {
  it('delegates to matchWearableTitle', () => {
    expect(findInPool(pool, { itemTitle: 'bowler hat' })?.id).toBe('gen-hat');
    expect(mockMatch).toHaveBeenCalled();
  });

  it('keeps own-items-first, archived included', () => {
    expect(findInPool(pool, { itemTitle: 'OLD COAT' })?.id).toBe('own-coat');
  });

  it('finds by id without the title rule', () => {
    expect(findInPool(pool, { itemId: 'gen-coat' })?.id).toBe('gen-coat');
    expect(mockMatch).not.toHaveBeenCalled();
  });
});
