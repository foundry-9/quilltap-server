/**
 * Outfit-history import: bring a bundle's `wardrobe_history` rows across,
 * keyed to the chats and characters as they landed on this instance.
 *
 * Runs after characters, chats, document stores and the wear ledger, so every
 * id map it reads is final. Each row gets a fresh `id`; `chatId`,
 * `characterId` and `actorCharacterId` are remapped; `entryIndex`,
 * `isCurrent`, `slots` and `createdAt` are copied as they are, so the
 * timeline and its cursor survive the trip. An item id in `slots` is remapped
 * when its item imported with a new id and otherwise kept — one that resolves
 * to nothing here falls under the stale-item rule at rollback and render time.
 *
 * A timeline that already has rows on this instance (the chat was skipped as
 * a duplicate, or the bundle is imported twice) is left alone: history is
 * never merged into a live timeline. A chat imported without history rows
 * (an older bundle) gets its entry 0 from the runtime first-touch seed.
 *
 * The judgement is {@link remapWardrobeHistoryRows} (pure, unit-tested).
 *
 * Design of record: docs/developer/features/complete/wardrobe-outfit-history.md §10
 *
 * @module import/quilltap-import/import-wardrobe-history
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  ChatWardrobeHistoryRowSchema,
  type ChatWardrobeHistoryRow,
} from '@/lib/schemas/chat-wardrobe-history.types';
import { bySlot } from '@/lib/schemas/wardrobe.types';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';
import type { ExportedDocumentStoreDocument } from '@/lib/export/types';
import { buildImportedWardrobeItemIdMap } from './import-wardrobe-wear';
import type { IdMappingState } from './types';

const moduleLogger = logger.child({ module: 'import:wardrobe-history' });

export interface WardrobeHistoryRemapContext {
  chatIds: ReadonlyMap<string, string>;
  characterIds: ReadonlyMap<string, string>;
  itemIds: ReadonlyMap<string, string>;
  mintId: () => string;
}

export interface WardrobeHistoryRemapResult {
  rows: ChatWardrobeHistoryRow[];
  droppedInvalid: number;
}

/** Remap a bundle's history rows onto this instance's ids. Pure. */
export function remapWardrobeHistoryRows(
  incoming: readonly unknown[],
  ctx: WardrobeHistoryRemapContext,
): WardrobeHistoryRemapResult {
  const rows: ChatWardrobeHistoryRow[] = [];
  let droppedInvalid = 0;
  for (const raw of incoming) {
    const parsed = ChatWardrobeHistoryRowSchema.safeParse(raw);
    if (!parsed.success) {
      droppedInvalid += 1;
      continue;
    }
    const row = parsed.data;
    const slots = bySlot((slot) => row.slots[slot].map((id) => ctx.itemIds.get(id) ?? id));
    rows.push({
      ...row,
      id: ctx.mintId(),
      chatId: ctx.chatIds.get(row.chatId) ?? row.chatId,
      characterId: ctx.characterIds.get(row.characterId) ?? row.characterId,
      actorCharacterId: row.actorCharacterId
        ? ctx.characterIds.get(row.actorCharacterId) ?? row.actorCharacterId
        : null,
      slots,
      slotsHash: hashEquippedSlots(slots),
    });
  }
  return { rows, droppedInvalid };
}

/** Import the bundle's history rows. Returns the number written. */
export async function importWardrobeHistory(
  incoming: readonly unknown[],
  documents: readonly ExportedDocumentStoreDocument[],
  idMaps: IdMappingState,
  warnings: string[],
): Promise<number> {
  if (incoming.length === 0) return 0;
  const repos = getRepositories();

  const { rows, droppedInvalid } = remapWardrobeHistoryRows(incoming, {
    chatIds: idMaps.chats,
    characterIds: idMaps.characters,
    itemIds: buildImportedWardrobeItemIdMap(documents, idMaps),
    mintId: () => randomUUID(),
  });
  if (droppedInvalid > 0) {
    warnings.push(`Dropped ${droppedInvalid} malformed outfit-history row(s).`);
  }

  // Never merge into a live timeline.
  const byPair = new Map<string, ChatWardrobeHistoryRow[]>();
  for (const row of rows) {
    const key = `${row.chatId}\u0000${row.characterId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), row]);
  }
  const toWrite: ChatWardrobeHistoryRow[] = [];
  let skippedTimelines = 0;
  for (const pairRows of byPair.values()) {
    const { chatId, characterId } = pairRows[0];
    if ((await repos.wardrobeHistory.findEntries(chatId, characterId)).length > 0) {
      skippedTimelines += 1;
      continue;
    }
    toWrite.push(...pairRows);
  }

  const written = await repos.wardrobeHistory.upsertRows(toWrite);
  moduleLogger.info('Imported outfit history', {
    incoming: incoming.length,
    written,
    droppedInvalid,
    skippedTimelines,
  });
  return written;
}
