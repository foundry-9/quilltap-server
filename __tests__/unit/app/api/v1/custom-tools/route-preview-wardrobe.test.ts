/**
 * Workbench route — `?action=preview` says which garment a dry run's wardrobe
 * gestures would have found when a character sits in the chair
 * (pascal-wardrobe-effect-picker §4.1). A read through the applier's own
 * lookup (`findInPool` / `resolveWearable`); nothing is worn.
 *
 * Auth middleware and the action dispatch are stubbed; the pool loader is
 * replaced with a pool built from fixed tiers. The real definition schema,
 * execution core and resolution helpers run.
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

const mockFindById = jest.fn();
jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) =>
      handler(req, { user: { id: 'user-1' }, repos: { characters: { findById: mockFindById } } }),
  withCollectionActionDispatch:
    (handlers: Record<string, (req: any, ctx: any) => Promise<any>>) =>
    async (req: any, ctx: any) => {
      const action = new URL(req.url).searchParams.get('action') ?? '';
      return handlers[action](req, ctx);
    },
}));

const mockLoadPool = jest.fn();
const mockWearItem = jest.fn();
jest.mock('@/lib/wardrobe/pool', () => ({
  ...jest.requireActual('@/lib/wardrobe/pool'),
  loadWearablePool: (...args: unknown[]) => mockLoadPool(...args),
}));
jest.mock('@/lib/wardrobe/wear-ops', () => ({
  ...jest.requireActual('@/lib/wardrobe/wear-ops'),
  wearItem: (...args: unknown[]) => mockWearItem(...args),
}));

import { POST } from '@/app/api/v1/custom-tools/route';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container';

const { buildWearablePool } = jest.requireActual('@/lib/wardrobe/pool') as typeof import('@/lib/wardrobe/pool');

const STAMP = '2026-01-01T00:00:00.000Z';
const OWN: WardrobeOrigin = { scope: 'character', id: 'char-imogen', name: 'Imogen' };
const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' };

function item(id: string, title: string, types: WardrobeItem['types'], extra: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    characterId: 'char-imogen',
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

const pool = buildWearablePool(
  'char-imogen',
  { groupMountPointIds: [], projectMountPointIds: [] },
  {
    own: [
      { ...item('dress', 'Sundress', ['top', 'bottom']), origin: OWN },
      { ...item('coat', 'Old Coat', ['top'], { archivedAt: STAMP }), origin: OWN },
    ],
    group: [],
    project: [],
    general: [{ ...item('cloak', 'Cloak of Night', ['top'], { characterId: null }), origin: GENERAL }],
  },
);

function req(body: unknown) {
  return { url: 'http://localhost/api/v1/custom-tools?action=preview', json: async () => body } as never;
}

function tool(wardrobe: Record<string, unknown>) {
  return {
    name: 'dresser',
    description: 'x',
    roll: { min: 1, max: 1 },
    outcomes: [{ when: true, message: 'done', state: 'info' }],
    effects: [{ wardrobe }],
  };
}

async function preview(wardrobe: Record<string, unknown>, metadata: unknown = { characterId: 'char-imogen' }) {
  const res = await POST(req({ definition: tool(wardrobe), metadata }));
  return res.json();
}

beforeEach(() => {
  mockFindById.mockResolvedValue({ id: 'char-imogen', name: 'Imogen', metadata: {} });
  mockLoadPool.mockReset();
  mockLoadPool.mockResolvedValue(pool);
  mockWearItem.mockReset();
});

describe('POST ?action=preview — wardrobe resolution', () => {
  it('finds a garment by title', async () => {
    const body = await preview({ action: 'wear', items: ['cloak of night'] });
    expect(body.wardrobeResolution).toEqual([
      {
        index: 0,
        items: [
          {
            ref: 'cloak of night',
            found: { id: 'cloak', title: 'Cloak of Night', types: ['top'], origin: GENERAL, imageFileId: null },
          },
        ],
      },
    ]);
    // A read: no project tier, and nothing worn.
    expect(mockLoadPool).toHaveBeenCalledWith(expect.anything(), 'char-imogen', [], expect.anything());
    expect(mockWearItem).not.toHaveBeenCalled();
  });

  it('finds a garment by id', async () => {
    const body = await preview({ action: 'wear', items: ['dress'] });
    expect(body.wardrobeResolution[0].items[0].found.title).toBe('Sundress');
  });

  it('reports an unknown title as not found', async () => {
    const body = await preview({ action: 'wear', items: ['Cloak of Nite'] });
    expect(body.wardrobeResolution[0].items[0]).toMatchObject({ ref: 'Cloak of Nite', found: null, reason: 'not_found' });
  });

  it('refuses an archived garment under wear, but finds it under take_off', async () => {
    const wear = await preview({ action: 'wear', items: ['Old Coat'] });
    expect(wear.wardrobeResolution[0].items[0]).toMatchObject({
      found: null,
      reason: 'archived',
      message: 'Item "Old Coat" is archived and cannot be worn',
    });
    const takeOff = await preview({ action: 'take_off', items: ['Old Coat'] });
    expect(takeOff.wardrobeResolution[0].items[0].found.id).toBe('coat');
  });

  it('refuses a slot the garment does not cover under add_to_slot', async () => {
    const body = await preview({ action: 'wear', items: ['Sundress'], mode: 'add_to_slot', slot: 'footwear' });
    expect(body.wardrobeResolution[0].items[0]).toMatchObject({ found: null, reason: 'slot' });
  });

  it('resolves nothing for a hand-typed fact sheet', async () => {
    const body = await preview({ action: 'wear', items: ['Sundress'] }, { mood: 'grim' });
    expect(body.wardrobeResolution).toBeUndefined();
    expect(mockLoadPool).not.toHaveBeenCalled();
  });

  it('still returns the roll when the wardrobe cannot be read', async () => {
    mockLoadPool.mockRejectedValueOnce(new Error('vault asleep'));
    const body = await preview({ action: 'wear', items: ['Sundress'] });
    expect(body.message).toBe('done');
    expect(body.wardrobeResolution).toBeUndefined();
  });
});
