/**
 * Rolling a character back (or forward) to an outfit they wore earlier in a
 * chat — the one rollback implementation. The `wardrobe_rollback` tool and
 * `?action=wardrobe-rollback` are thin callers.
 *
 * 1. Resolve the target entry (default: one before the cursor).
 * 2. Filter stale items: an id that no longer resolves, or resolves archived,
 *    is left off — unless it is archived and *currently worn in that slot*,
 *    since leaving it where it is puts nothing on (bug 191 stays true).
 * 3. One `commitEquippedOutfit`, the `set_all` shape, so the wear ledger
 *    credits whatever goes back on.
 * 4. `notifyWardrobeChanged` with a cursor intent: the avatar refresh, Aurora's
 *    announcement, and the history cursor move instead of an append.
 *
 * Server-only.
 *
 * Design of record: docs/developer/features/complete/wardrobe-outfit-history.md §5
 *
 * @module wardrobe/history/rollback
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { EquipSource } from '@/lib/database/repositories/wardrobe-wear.repository';
import { bySlot, makeEmptyEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { notifyWardrobeChanged, type OutfitChangeContext } from '@/lib/wardrobe/outfit-change-effects';
import type { WearablePool } from '@/lib/wardrobe/pool';

export interface RollbackInput {
  chatId: string;
  /** The caller's pool: `loadToolPool`, or `loadWearablePool(..., { operator: true })`. */
  pool: WearablePool;
  /** Absolute entry index; default = current - 1. */
  index?: number;
  /** Provenance plus the turn containers, if any. `characterId` is whose outfit rolls back. */
  context: Omit<OutfitChangeContext, 'historyIntent'>;
  /** The ledger's EquipSource for the commit. */
  source: Extract<EquipSource, 'ui' | 'tool'>;
}

export interface RollbackSkippedItem {
  itemId: string;
  title: string | null;
  reason: 'archived' | 'missing';
}

export type RollbackOutcome =
  | {
      ok: true;
      previousIndex: number;
      restoredIndex: number;
      /** What was actually written (stale items removed). */
      slots: EquippedSlots;
      skipped: RollbackSkippedItem[];
    }
  | {
      ok: false;
      reason: 'no_history' | 'at_first' | 'out_of_range' | 'already_current';
      message: string;
    };

type RollbackRepos = Pick<RepositoryContainer, 'wardrobeHistory' | 'wardrobeWear' | 'chats' | 'characters'>;

const CONTEXT = 'wardrobe.history.rollback';

async function characterName(repos: RollbackRepos, characterId: string): Promise<string> {
  try {
    return (await repos.characters.findByIdRaw(characterId))?.name || 'This character';
  } catch {
    return 'This character';
  }
}

/**
 * Keep each id the pool can still put on; keep an archived id already worn in
 * the same slot; drop the rest into `skipped`. Pure; exported for tests.
 */
export function filterStaleItems(
  pool: WearablePool,
  target: EquippedSlots,
  live: EquippedSlots,
): { slots: EquippedSlots; skipped: RollbackSkippedItem[] } {
  const skipped = new Map<string, RollbackSkippedItem>();
  const slots = bySlot((slot) =>
    (target[slot] ?? []).filter((itemId) => {
      const item = pool.get(itemId);
      if (!item) {
        if (!skipped.has(itemId)) skipped.set(itemId, { itemId, title: null, reason: 'missing' });
        return false;
      }
      if (!item.archivedAt) return true;
      if ((live[slot] ?? []).includes(itemId)) return true;
      if (!skipped.has(itemId)) skipped.set(itemId, { itemId, title: item.title, reason: 'archived' });
      return false;
    }),
  );
  return { slots, skipped: Array.from(skipped.values()) };
}

export async function rollbackWardrobe(
  repos: RepositoryContainer,
  input: RollbackInput,
  sourceContext: string = CONTEXT,
): Promise<RollbackOutcome> {
  const { chatId, pool, context, source } = input;
  const characterId = context.characterId;

  const entries = await repos.wardrobeHistory.findEntries(chatId, characterId);
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'no_history',
      message: `No outfit history yet for ${await characterName(repos, characterId)} in this chat.`,
    };
  }

  const current = entries.find((entry) => entry.isCurrent) ?? entries[entries.length - 1];
  const max = entries[entries.length - 1].entryIndex;
  const targetIndex = input.index ?? current.entryIndex - 1;

  if (input.index === undefined && current.entryIndex === 0) {
    return {
      ok: false,
      reason: 'at_first',
      message: `${await characterName(repos, characterId)} is already in the first outfit of this chat (0); there is nothing earlier to return to.`,
    };
  }
  if (targetIndex < 0 || targetIndex > max) {
    return {
      ok: false,
      reason: 'out_of_range',
      message: `There is no outfit ${targetIndex}; this chat's outfits are numbered 0 to ${max}.`,
    };
  }
  if (targetIndex === current.entryIndex) {
    return {
      ok: false,
      reason: 'already_current',
      message: `${await characterName(repos, characterId)} is already wearing outfit ${targetIndex}.`,
    };
  }

  const target = entries.find((entry) => entry.entryIndex === targetIndex)!;
  const live = (await repos.chats.getEquippedOutfitForCharacter(chatId, characterId)) ?? makeEmptyEquippedSlots();
  const { slots, skipped } = filterStaleItems(pool, target.slots, live);

  for (const item of skipped) {
    logger.info('Rollback left a stale item off', {
      context: sourceContext,
      chatId,
      characterId,
      targetIndex,
      itemId: item.itemId,
      reason: item.reason,
    });
  }

  await repos.wardrobeWear.commitEquippedOutfit({
    chatId,
    characterId,
    nextSlots: slots,
    wornBundles: [],
    source,
  });

  await notifyWardrobeChanged(
    repos,
    { ...context, historyIntent: { kind: 'cursor', index: targetIndex } },
    sourceContext,
  );

  logger.debug('Rolled a wardrobe back', {
    context: sourceContext,
    chatId,
    characterId,
    previousIndex: current.entryIndex,
    restoredIndex: targetIndex,
    skipped: skipped.length,
    provenance: context.provenance.source,
  });

  return { ok: true, previousIndex: current.entryIndex, restoredIndex: targetIndex, slots, skipped };
}
