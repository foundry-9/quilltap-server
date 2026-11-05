/**
 * What a character arrived in at the start of their last few chats.
 *
 * The green room (`llm_choose`) used to choose each opening outfit with no
 * idea what the character had worn before, so the same scenario-agnostic
 * favourite came back chat after chat. This module turns the wardrobe
 * history's arrival rows into something the outfit prompt can read: a short,
 * newest-first list of outfits by title, each with a rough age.
 *
 * Read-only. Soft-fails to an empty list — a variety hint never blocks an
 * outfit choice.
 *
 * @module wardrobe/recent-openings
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatWardrobeHistoryRow } from '@/lib/schemas/chat-wardrobe-history.types';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/** How many earlier openings the green room is shown. */
export const RECENT_OPENINGS_LIMIT = 5;

/** One earlier opening, ready for the outfit prompt. */
export interface RecentOpening {
  /** Rough age: "today", "yesterday", "3 days ago". */
  when: string;
  /** Titles of what was worn, deduplicated, in slot order. Empty when unclothed. */
  titles: string[];
  /** Nothing on top or below — accessories, footwear or a hairdo alone still count as unclothed. */
  unclothed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The slots whose emptiness reads as "unclothed" in a recent opening. Narrower
 * than `CLOTHING_SLOT_TYPES` on purpose: a ring, a pendant or a pair of
 * flip-flops with nothing on top or below is, for the model reading the list,
 * an unclothed arrival.
 */
const BODY_SLOT_TYPES: readonly WardrobeItemType[] = ['top', 'bottom'];

/** A rough, human age for a timestamp, relative to `now`. */
export function describeAge(createdAt: string, now: number): string {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return 'some time ago';
  const days = Math.floor(Math.max(0, now - then) / DAY_MS);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return `${weeks} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/**
 * Turn arrival rows into prompt-ready openings. Pure.
 *
 * Items no longer in `byId` (deleted, or out of reach) are skipped; an
 * opening whose every garment has gone is dropped rather than shown as
 * "unclothed", which it was not.
 */
export function describeRecentOpenings(
  rows: readonly ChatWardrobeHistoryRow[],
  byId: ReadonlyMap<string, Pick<WardrobeItem, 'title'>>,
  now: number,
): RecentOpening[] {
  const openings: RecentOpening[] = [];
  for (const row of rows) {
    const unclothed = BODY_SLOT_TYPES.every((slot) => (row.slots[slot]?.length ?? 0) === 0);
    const seen = new Set<string>();
    const titles: string[] = [];
    let missing = 0;
    for (const slot of WARDROBE_SLOT_TYPES) {
      for (const id of row.slots[slot] ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = byId.get(id);
        if (item) titles.push(item.title);
        else missing++;
      }
    }
    if (!unclothed && titles.length === 0 && missing > 0) continue;
    openings.push({ when: describeAge(row.createdAt, now), titles, unclothed });
  }
  return openings;
}

/**
 * Load a character's recent openings for the green room. Never throws.
 *
 * @param excludeChatId The chat being dressed now — its own arrival, if one
 *   is already recorded (a re-added seat), is not "an earlier opening".
 */
export async function loadRecentOpenings(
  repos: Pick<RepositoryContainer, 'wardrobeHistory'>,
  characterId: string,
  byId: ReadonlyMap<string, Pick<WardrobeItem, 'title'>>,
  options: { excludeChatId?: string; limit?: number; now?: number } = {},
): Promise<RecentOpening[]> {
  try {
    const rows = await repos.wardrobeHistory.findRecentOpenings(
      characterId,
      options.limit ?? RECENT_OPENINGS_LIMIT,
      options.excludeChatId,
    );
    const openings = describeRecentOpenings(rows, byId, options.now ?? Date.now());
    logger.debug('[RecentOpenings] Loaded recent opening outfits for the green room', {
      characterId,
      rows: rows.length,
      openings: openings.length,
    });
    return openings;
  } catch (error) {
    logger.warn('[RecentOpenings] Could not read recent opening outfits; choosing without them', {
      characterId,
      error: getErrorMessage(error, 'Unknown error'),
    });
    return [];
  }
}
