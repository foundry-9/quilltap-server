/**
 * Wear-ledger import (wardrobe-wear-ledger.md §6): a bundle's
 * `wardrobe_wear` rows are remapped onto the items, characters and chats as
 * they landed, folded where a wearer cannot be resolved, merged where rows
 * collapse onto one (item, wearer) key, and never allowed to lower a live
 * tally.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

import {
  buildImportedWardrobeItemIdMap,
  importWardrobeWear,
  remapWardrobeWearRows,
  type WardrobeWearRemapContext,
} from '@/lib/import/quilltap-import/import-wardrobe-wear';
import { wardrobeItemIdForDocument } from '@/lib/database/repositories/vault-overlay/parsers';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeWearStatsRow } from '@/lib/schemas/wardrobe-wear.types';

const SRC_ITEM = '11111111-1111-4111-8111-111111111111';
const DST_ITEM = '22222222-2222-4222-8222-222222222222';
const SRC_ADA = '33333333-3333-4333-8333-333333333333';
const DST_ADA = '44444444-4444-4444-8444-444444444444';
const SRC_BEA = '55555555-5555-4555-8555-555555555555';
const SRC_CY = '66666666-6666-4666-8666-666666666666';
const SRC_CHAT = '77777777-7777-4777-8777-777777777777';
const DST_CHAT = '88888888-8888-4888-8888-888888888888';
const ROW_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
];
const NOW = '2026-10-07T12:00:00.000Z';

function row(overrides: Partial<WardrobeWearStatsRow> = {}): WardrobeWearStatsRow {
  return {
    id: ROW_IDS[0],
    itemId: SRC_ITEM,
    wearerCharacterId: SRC_ADA,
    wearCount: 3,
    firstWornAt: '2026-01-01T00:00:00.000Z',
    lastWornAt: '2026-03-01T00:00:00.000Z',
    lastWornChatId: SRC_CHAT,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function ctx(overrides: Partial<WardrobeWearRemapContext> = {}): WardrobeWearRemapContext {
  let n = 0;
  return {
    itemIds: new Map([[SRC_ITEM, DST_ITEM]]),
    resolveWearer: (id) => (id === SRC_ADA ? DST_ADA : null),
    resolveChat: (id) => (id === SRC_CHAT ? DST_CHAT : null),
    existing: [],
    mintId: () => `minted-${++n}`,
    now: NOW,
    ...overrides,
  };
}

describe('remapWardrobeWearRows', () => {
  it('remaps item, wearer and chat through the maps and mints a fresh row id', () => {
    const result = remapWardrobeWearRows([row()], ctx());

    expect(result.rows).toEqual([
      {
        id: 'minted-1',
        itemId: DST_ITEM,
        wearerCharacterId: DST_ADA,
        wearCount: 3,
        firstWornAt: '2026-01-01T00:00:00.000Z',
        lastWornAt: '2026-03-01T00:00:00.000Z',
        lastWornChatId: DST_CHAT,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: NOW,
      },
    ]);
    expect(result.foldedWearers).toBe(0);
    expect(result.clearedChats).toBe(0);
  });

  it('drops a row whose item did not import', () => {
    const result = remapWardrobeWearRows(
      [row({ itemId: '99999999-9999-4999-8999-999999999999' })],
      ctx(),
    );
    expect(result.rows).toEqual([]);
    expect(result.droppedMissingItem).toBe(1);
  });

  it('folds an unresolvable wearer into the unattributed row and clears an absent chat', () => {
    const result = remapWardrobeWearRows(
      [row({ wearerCharacterId: SRC_BEA, lastWornChatId: '99999999-9999-4999-8999-999999999999' })],
      ctx(),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].wearerCharacterId).toBeNull();
    expect(result.rows[0].lastWornChatId).toBeNull();
    expect(result.foldedWearers).toBe(1);
    expect(result.clearedChats).toBe(1);
  });

  it('merges rows that collapse onto one key: sum, earliest first, latest last with its chat', () => {
    const result = remapWardrobeWearRows(
      [
        // Already unattributed in the source.
        row({
          id: ROW_IDS[0],
          wearerCharacterId: null,
          wearCount: 2,
          firstWornAt: '2026-02-01T00:00:00.000Z',
          lastWornAt: '2026-02-15T00:00:00.000Z',
          lastWornChatId: null,
        }),
        // Two unknown wearers, both folding into unattributed.
        row({
          id: ROW_IDS[1],
          wearerCharacterId: SRC_BEA,
          wearCount: 4,
          firstWornAt: '2026-01-05T00:00:00.000Z',
          lastWornAt: '2026-05-01T00:00:00.000Z',
          lastWornChatId: SRC_CHAT,
        }),
        row({
          id: ROW_IDS[2],
          wearerCharacterId: SRC_CY,
          wearCount: 1,
          firstWornAt: '2026-03-01T00:00:00.000Z',
          lastWornAt: '2026-04-01T00:00:00.000Z',
          lastWornChatId: null,
        }),
        // A resolvable wearer keeps their own row.
        row({ id: ROW_IDS[3] }),
      ],
      ctx(),
    );

    expect(result.rows).toHaveLength(2);
    const unattributed = result.rows.find((r) => r.wearerCharacterId === null);
    expect(unattributed).toMatchObject({
      itemId: DST_ITEM,
      wearCount: 7,
      firstWornAt: '2026-01-05T00:00:00.000Z',
      lastWornAt: '2026-05-01T00:00:00.000Z',
      lastWornChatId: DST_CHAT,
    });
    expect(result.rows.find((r) => r.wearerCharacterId === DST_ADA)?.wearCount).toBe(3);
    // One row per key — never two for upsertRows to let the last one win.
    const keys = result.rows.map((r) => `${r.itemId}|${r.wearerCharacterId ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result.foldedWearers).toBe(2);
  });

  it('never lowers a live tally: keeps the live id and takes the larger count', () => {
    const live: WardrobeWearStatsRow = {
      id: 'live-row',
      itemId: DST_ITEM,
      wearerCharacterId: DST_ADA,
      wearCount: 5,
      firstWornAt: '2026-02-01T00:00:00.000Z',
      lastWornAt: '2026-02-20T00:00:00.000Z',
      lastWornChatId: 'live-chat',
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2026-02-20T00:00:00.000Z',
    };
    const result = remapWardrobeWearRows([row()], ctx({ existing: [live] }));

    expect(result.rows).toEqual([
      {
        id: 'live-row',
        itemId: DST_ITEM,
        wearerCharacterId: DST_ADA,
        wearCount: 5,
        firstWornAt: '2026-01-01T00:00:00.000Z',
        lastWornAt: '2026-03-01T00:00:00.000Z',
        lastWornChatId: DST_CHAT,
        createdAt: '2025-12-01T00:00:00.000Z',
        updatedAt: NOW,
      },
    ]);
  });

  it('is idempotent against a live row that is the same tally', () => {
    const first = remapWardrobeWearRows([row()], ctx());
    const again = remapWardrobeWearRows([row()], ctx({ existing: first.rows }));
    expect(again.rows[0].wearCount).toBe(first.rows[0].wearCount);
    expect(again.rows[0].id).toBe(first.rows[0].id);
  });

  it('drops malformed rows', () => {
    const result = remapWardrobeWearRows([{ itemId: SRC_ITEM }, null], ctx());
    expect(result.rows).toEqual([]);
    expect(result.droppedInvalid).toBe(2);
  });
});

describe('buildImportedWardrobeItemIdMap', () => {
  const doc = (overrides: Record<string, unknown>) =>
    ({
      mountPointId: 'src-mount',
      relativePath: 'Wardrobe/Coat.md',
      fileName: 'Coat.md',
      fileType: 'markdown',
      content: `---\nid: ${SRC_ITEM}\ntitle: Coat\ntypes: [top]\n---\n`,
      contentSha256: 'x'.repeat(64),
      plainTextLength: 1,
      lastModified: NOW,
      ...overrides,
    }) as never;

  it('maps a frontmatter id to itself for a store that imported', () => {
    const map = buildImportedWardrobeItemIdMap([doc({})], {
      mountPoints: new Map([['src-mount', 'dst-mount']]),
      wardrobeItems: new Map(),
    });
    expect(map.get(SRC_ITEM)).toBe(SRC_ITEM);
  });

  it('recomputes a path-derived id against the destination mount', () => {
    const content = '---\ntitle: Hat\ntypes: [accessories]\n---\n';
    const map = buildImportedWardrobeItemIdMap(
      [doc({ relativePath: 'Wardrobe/Hat.md', fileName: 'Hat.md', content })],
      { mountPoints: new Map([['src-mount', 'dst-mount']]), wardrobeItems: new Map() },
    );
    const sourceId = wardrobeItemIdForDocument({ mountPointId: 'src-mount', relativePath: 'Wardrobe/Hat.md', content });
    const targetId = wardrobeItemIdForDocument({ mountPointId: 'dst-mount', relativePath: 'Wardrobe/Hat.md', content });
    expect(sourceId).not.toBe(targetId);
    expect(map.get(sourceId)).toBe(targetId);
  });

  it('ignores stores that did not import, non-wardrobe paths and the instructions file', () => {
    const map = buildImportedWardrobeItemIdMap(
      [
        doc({ mountPointId: 'skipped-mount' }),
        doc({ relativePath: 'Notes/Coat.md' }),
        doc({ relativePath: 'Wardrobe/instructions.md', fileName: 'instructions.md' }),
        doc({ relativePath: 'Wardrobe/Old/Coat.md' }),
      ],
      { mountPoints: new Map([['src-mount', 'dst-mount']]), wardrobeItems: new Map() },
    );
    expect(map.size).toBe(0);
  });

  it('lets a carried vault document override the scaffold id importCharacters minted', () => {
    const map = buildImportedWardrobeItemIdMap([doc({})], {
      mountPoints: new Map([['src-mount', 'dst-mount']]),
      wardrobeItems: new Map([
        [SRC_ITEM, 'scaffold-id'],
        ['legacy-item', 'legacy-new'],
      ]),
    });
    expect(map.get(SRC_ITEM)).toBe(SRC_ITEM);
    expect(map.get('legacy-item')).toBe('legacy-new');
  });
});

describe('importWardrobeWear', () => {
  function idMaps(): any {
    return {
      characters: new Map([[SRC_ADA, DST_ADA]]),
      chats: new Map(),
      mountPoints: new Map(),
      wardrobeItems: new Map([[SRC_ITEM, DST_ITEM]]),
    };
  }

  it('keeps a wearer and chat that exist on this instance, writes through upsertRows', async () => {
    const upsertRows = jest.fn().mockResolvedValue(undefined);
    (getRepositories as jest.Mock).mockReturnValue({
      characters: { findByIdRaw: jest.fn(async (id: string) => (id === SRC_BEA ? { id } : null)) },
      chats: { findById: jest.fn(async (id: string) => (id === SRC_CHAT ? { id } : null)) },
      wardrobeWear: { findRowsForItems: jest.fn().mockResolvedValue([]), upsertRows },
    });

    const written = await importWardrobeWear(
      [row({ wearerCharacterId: SRC_BEA }), row({ id: ROW_IDS[1], wearerCharacterId: SRC_CY })],
      [],
      idMaps(),
      [],
    );

    expect(written).toBe(2);
    const rows = upsertRows.mock.calls[0][0] as WardrobeWearStatsRow[];
    expect(rows.find((r) => r.wearerCharacterId === SRC_BEA)?.lastWornChatId).toBe(SRC_CHAT);
    expect(rows.find((r) => r.wearerCharacterId === null)).toBeDefined();
    for (const r of rows) expect(r.itemId).toBe(DST_ITEM);
  });

  it('reads the live rows for the destination items before merging', async () => {
    const findRowsForItems = jest.fn().mockResolvedValue([]);
    (getRepositories as jest.Mock).mockReturnValue({
      characters: { findByIdRaw: jest.fn(async () => null) },
      chats: { findById: jest.fn(async () => null) },
      wardrobeWear: { findRowsForItems, upsertRows: jest.fn() },
    });

    await importWardrobeWear([row()], [], idMaps(), []);

    expect(findRowsForItems).toHaveBeenCalledWith([DST_ITEM]);
  });

  it('does nothing for an empty ledger', async () => {
    (getRepositories as jest.Mock).mockReturnValue({});
    await expect(importWardrobeWear([], [], idMaps(), [])).resolves.toBe(0);
  });
});
