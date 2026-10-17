/**
 * Rendering an outfit-history entry: its slots resolved against a character's
 * wearable pool, stale ids marked rather than dropped, and a one-line summary.
 * Shared by the `wardrobe_history` tool and `?action=wardrobe-history`.
 *
 * Entries store dissolved leaves; a legacy whole-composite id resolves to the
 * composite's own title. No I/O: the caller loads the pool once.
 *
 * Server-only (the pool type pulls in server modules).
 *
 * @module wardrobe/history/describe-entry
 */

import { WARDROBE_SLOT_TYPES, bySlot } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import type { WardrobeHistorySource } from '@/lib/schemas/chat-wardrobe-history.types';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import type { WearablePool } from '@/lib/wardrobe/pool';

/** One id in an entry's slot, as the pool sees it now. */
export interface HistorySlotItem {
  itemId: string;
  title: string | null;
  archived: boolean;
  missing: boolean;
}

export type HistorySlots = Record<WardrobeItemType, HistorySlotItem[]>;

/** Resolve each stored id against the pool. Archived items still resolve; absent ones are `missing`. */
export function resolveHistorySlots(pool: WearablePool, slots: EquippedSlots): HistorySlots {
  return bySlot((slot) =>
    (slots[slot] ?? []).map((itemId) => {
      const item = pool.get(itemId);
      return item
        ? { itemId, title: item.title, archived: Boolean(item.archivedAt), missing: false }
        : { itemId, title: null, archived: false, missing: true };
    }),
  );
}

/** The ids in an entry that cannot be put back on: archived or gone. Deduplicated across slots. */
export function staleItemsOf(resolved: HistorySlots): HistorySlotItem[] {
  const seen = new Set<string>();
  const stale: HistorySlotItem[] = [];
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const entry of resolved[slot]) {
      if (!(entry.archived || entry.missing) || seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      stale.push(entry);
    }
  }
  return stale;
}

/**
 * One plain-text line: `describeOutfit` over the titles (stale ones tagged),
 * its Markdown list flattened — the History tab and the tool both show it as
 * prose.
 */
export function summarizeHistorySlots(resolved: HistorySlots): string {
  const values = bySlot((slot) =>
    resolved[slot].map((entry) => {
      if (entry.missing) return `${entry.itemId} (no longer exists)`;
      return entry.archived ? `${entry.title} (archived)` : (entry.title ?? entry.itemId);
    }),
  );
  return describeOutfit(values)
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Who made an entry, for a reader. `selfLabel` is how the character the
 * timeline belongs to is named when they made it ("you" for the tool).
 */
export function changedByLabel(
  entry: { source: WardrobeHistorySource; actorCharacterId: string | null; characterId: string },
  actorName: string | null,
  selfLabel: string,
): string {
  switch (entry.source) {
    case 'operator':
      return 'the operator';
    case 'pascal':
      return entry.actorCharacterId && entry.actorCharacterId !== entry.characterId && actorName
        ? `Pascal (rolled by ${actorName})`
        : 'Pascal';
    case 'character':
      if (!entry.actorCharacterId || entry.actorCharacterId === entry.characterId) return selfLabel;
      return actorName ?? 'another character';
    case 'chat-start':
      return 'chat opened';
    case 'participant-added':
      return 'joined the chat';
    case 'merge':
      return 'merged';
    case 'seeded':
      return 'before history was kept';
  }
}
