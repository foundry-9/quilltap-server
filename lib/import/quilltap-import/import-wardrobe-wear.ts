/**
 * Wear-ledger import: bring a bundle's `wardrobe_wear` rows across, keyed to
 * the items, characters and chats as they landed on this instance.
 *
 * Runs after characters, chats and document stores have imported, so every
 * id map it reads is final. The judgement is {@link remapWardrobeWearRows}
 * (pure, unit-tested); {@link importWardrobeWear} only gathers what it checks
 * against and writes the result through `repos.wardrobeWear.upsertRows`.
 *
 * Design of record: docs/developer/features/complete/wardrobe-wear-ledger.md §6
 *
 * @module import/quilltap-import/import-wardrobe-wear
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  WardrobeWearStatsRowSchema,
  type WardrobeWearStatsRow,
} from '@/lib/schemas/wardrobe-wear.types';
import {
  isWardrobeItemDocumentPath,
  wardrobeItemIdForDocument,
} from '@/lib/database/repositories/vault-overlay/parsers';
import type { ExportedDocumentStoreDocument } from '@/lib/export/types';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:wardrobe-wear' });

// ============================================================================
// PURE REMAP / MERGE
// ============================================================================

export interface WardrobeWearRemapContext {
  /** Source item id → destination item id, for items that actually imported. */
  itemIds: ReadonlyMap<string, string>;
  /** Destination character id for a source wearer, or null to fold into unattributed. */
  resolveWearer: (sourceCharacterId: string) => string | null;
  /** Destination chat id for a source chat, or null to clear `lastWornChatId`. */
  resolveChat: (sourceChatId: string) => string | null;
  /**
   * Live rows already on this instance for the destination items. An import
   * never lowers a live tally: on a shared key the larger count wins, with the
   * earliest first wear and the latest last wear. That makes re-importing the
   * same bundle idempotent instead of doubling or rewinding the ledger.
   */
  existing: readonly WardrobeWearStatsRow[];
  mintId: () => string;
  now: string;
}

export interface WardrobeWearRemapResult {
  /** Rows to hand to `upsertRows` — one per (item, wearer) key, never two. */
  rows: WardrobeWearStatsRow[];
  /** Rows whose item did not come along. */
  droppedMissingItem: number;
  /** Rows that failed schema validation. */
  droppedInvalid: number;
  /** Rows whose wearer could not be resolved and were folded into unattributed. */
  foldedWearers: number;
  /** Rows whose `lastWornChatId` was cleared because the chat is not here. */
  clearedChats: number;
}

function keyOf(itemId: string, wearerCharacterId: string | null): string {
  return `${itemId}\u0000${wearerCharacterId ?? ''}`;
}

/** Take `b`'s last wear (and its chat) when it is later than `a`'s; `a` wins ties. */
function laterLastWear(
  a: Pick<WardrobeWearStatsRow, 'lastWornAt' | 'lastWornChatId'>,
  b: Pick<WardrobeWearStatsRow, 'lastWornAt' | 'lastWornChatId'>,
): Pick<WardrobeWearStatsRow, 'lastWornAt' | 'lastWornChatId'> {
  return b.lastWornAt > a.lastWornAt
    ? { lastWornAt: b.lastWornAt, lastWornChatId: b.lastWornChatId }
    : { lastWornAt: a.lastWornAt, lastWornChatId: a.lastWornChatId };
}

function minIso(a: string, b: string): string {
  return b < a ? b : a;
}

/**
 * Remap a bundle's wear-ledger rows onto this instance.
 *
 * - `itemId` goes through `ctx.itemIds`; a row whose item did not import is
 *   dropped.
 * - `wearerCharacterId` goes through `ctx.resolveWearer`; a wearer that does
 *   not resolve folds into the item's unattributed row (`null`).
 * - `lastWornChatId` goes through `ctx.resolveChat`; an unresolved chat is
 *   cleared.
 * - Rows that collapse onto one (item, wearer) key — several unknown wearers
 *   folding into unattributed, say — are summed (earliest first wear, latest
 *   last wear and its chat), because `upsertRows` replaces a tally on
 *   collision rather than adding to it.
 * - A key that already has a live row keeps that row's id and creation stamp
 *   and takes the larger count (see {@link WardrobeWearRemapContext.existing}).
 *
 * Every new row gets a freshly minted id.
 */
export function remapWardrobeWearRows(
  incoming: readonly unknown[],
  ctx: WardrobeWearRemapContext,
): WardrobeWearRemapResult {
  const merged = new Map<string, WardrobeWearStatsRow>();
  let droppedMissingItem = 0;
  let droppedInvalid = 0;
  let foldedWearers = 0;
  let clearedChats = 0;

  for (const raw of incoming) {
    const parsed = WardrobeWearStatsRowSchema.safeParse(raw);
    if (!parsed.success) {
      droppedInvalid++;
      continue;
    }
    const row = parsed.data;

    const itemId = ctx.itemIds.get(row.itemId);
    if (!itemId) {
      droppedMissingItem++;
      continue;
    }

    let wearerCharacterId: string | null = null;
    if (row.wearerCharacterId) {
      wearerCharacterId = ctx.resolveWearer(row.wearerCharacterId);
      if (!wearerCharacterId) foldedWearers++;
    }

    let lastWornChatId: string | null = null;
    if (row.lastWornChatId) {
      lastWornChatId = ctx.resolveChat(row.lastWornChatId);
      if (!lastWornChatId) clearedChats++;
    }

    const key = keyOf(itemId, wearerCharacterId);
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, {
        id: ctx.mintId(),
        itemId,
        wearerCharacterId,
        wearCount: row.wearCount,
        firstWornAt: row.firstWornAt,
        lastWornAt: row.lastWornAt,
        lastWornChatId,
        createdAt: row.createdAt,
        updatedAt: ctx.now,
      });
      continue;
    }

    merged.set(key, {
      ...prior,
      wearCount: prior.wearCount + row.wearCount,
      firstWornAt: minIso(prior.firstWornAt, row.firstWornAt),
      ...laterLastWear(prior, { lastWornAt: row.lastWornAt, lastWornChatId }),
      createdAt: minIso(prior.createdAt, row.createdAt),
    });
  }

  const existingByKey = new Map(
    ctx.existing.map((row) => [keyOf(row.itemId, row.wearerCharacterId), row]),
  );
  const rows: WardrobeWearStatsRow[] = [];
  for (const [key, row] of merged) {
    const live = existingByKey.get(key);
    if (!live) {
      rows.push(row);
      continue;
    }
    rows.push({
      ...row,
      id: live.id,
      wearCount: Math.max(live.wearCount, row.wearCount),
      firstWornAt: minIso(live.firstWornAt, row.firstWornAt),
      ...laterLastWear(live, row),
      createdAt: live.createdAt,
    });
  }

  return { rows, droppedMissingItem, droppedInvalid, foldedWearers, clearedChats };
}

// ============================================================================
// ITEM ID MAP
// ============================================================================

/**
 * Source item id → destination item id for every wardrobe item this import
 * brought across.
 *
 * Two sources, in precedence order:
 *
 * 1. `Wardrobe/*.md` documents carried by an imported store — shared stores
 *    and each character's own vault. The item id lives in the frontmatter and
 *    travels verbatim, so source and destination agree unless the file has no
 *    frontmatter id and its id is derived from the (remapped) mount point.
 *    These win: when a bundle carries a character's vault, reconciliation
 *    repoints the character at it and discards the scaffold vault the
 *    `wardrobe_item` records were written into.
 * 2. `idMaps.wardrobeItems` — the ids `importCharacterWardrobeItems` minted,
 *    which are the live ones only for a bundle that carried no vault.
 */
export function buildImportedWardrobeItemIdMap(
  documents: readonly ExportedDocumentStoreDocument[],
  idMaps: Pick<IdMappingState, 'mountPoints' | 'wardrobeItems'>,
): Map<string, string> {
  const map = new Map<string, string>(idMaps.wardrobeItems);
  for (const doc of documents) {
    if (!isWardrobeItemDocumentPath(doc.relativePath)) continue;
    const targetMountId = idMaps.mountPoints.get(doc.mountPointId);
    if (!targetMountId) continue;
    const sourceId = wardrobeItemIdForDocument(doc);
    const targetId = wardrobeItemIdForDocument({ ...doc, mountPointId: targetMountId });
    map.set(sourceId, targetId);
  }
  return map;
}

// ============================================================================
// EFFECTFUL IMPORT
// ============================================================================

/**
 * Import a bundle's wear-ledger rows. Returns how many rows were written.
 *
 * A wearer resolves through `idMaps.characters` when the bundle carried them,
 * otherwise to themselves when that character exists on this instance (a
 * same-instance round trip of a shared store keeps its attribution); anything
 * else folds into unattributed. Chats resolve the same way, else clear.
 */
export async function importWardrobeWear(
  incoming: readonly unknown[],
  documents: readonly ExportedDocumentStoreDocument[],
  idMaps: IdMappingState,
  warnings: string[],
): Promise<number> {
  if (incoming.length === 0) return 0;
  const repos = getRepositories();

  const itemIds = buildImportedWardrobeItemIdMap(documents, idMaps);

  // Pre-resolve the ids the bundle did not map against this instance, once
  // per distinct id, so the remap itself stays pure.
  const localCharacterIds = new Set<string>();
  const localChatIds = new Set<string>();
  const unmappedWearers = new Set<string>();
  const unmappedChats = new Set<string>();
  for (const raw of incoming) {
    const row = raw as Partial<WardrobeWearStatsRow> | null;
    if (row?.wearerCharacterId && !idMaps.characters.has(row.wearerCharacterId)) {
      unmappedWearers.add(row.wearerCharacterId);
    }
    if (row?.lastWornChatId && !idMaps.chats.has(row.lastWornChatId)) {
      unmappedChats.add(row.lastWornChatId);
    }
  }
  for (const id of unmappedWearers) {
    if (await repos.characters.findByIdRaw(id)) localCharacterIds.add(id);
  }
  for (const id of unmappedChats) {
    if (await repos.chats.findById(id)) localChatIds.add(id);
  }

  const existing = await repos.wardrobeWear.findRowsForItems(Array.from(new Set(itemIds.values())));

  const result = remapWardrobeWearRows(incoming, {
    itemIds,
    resolveWearer: (id) =>
      idMaps.characters.get(id) ?? (localCharacterIds.has(id) ? id : null),
    resolveChat: (id) => idMaps.chats.get(id) ?? (localChatIds.has(id) ? id : null),
    existing,
    mintId: () => randomUUID(),
    now: new Date().toISOString(),
  });

  if (result.droppedInvalid > 0) {
    warnings.push(`Dropped ${result.droppedInvalid} malformed wardrobe wear-ledger row(s).`);
  }

  await repos.wardrobeWear.upsertRows(result.rows);

  moduleLogger.info('Imported wardrobe wear ledger', {
    incoming: incoming.length,
    written: result.rows.length,
    mergedIntoLive: result.rows.filter((r) => existing.some((e) => e.id === r.id)).length,
    droppedMissingItem: result.droppedMissingItem,
    droppedInvalid: result.droppedInvalid,
    foldedWearers: result.foldedWearers,
    clearedChats: result.clearedChats,
    importedItemCount: itemIds.size,
  });

  return result.rows.length;
}
