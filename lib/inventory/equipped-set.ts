/**
 * The equipped set — the objects a character carries in one chat, read.
 *
 * `chats.equippedInventory[characterId]` holds ids; this resolves them
 * against the character's pool and drops any that no longer resolve to
 * something carriable (missing, archived, an archetype or a kit), each logged
 * at `debug`. Nothing is written: a dropped id leaves the column at the next
 * equip write (`equip.ts` prunes it).
 *
 * Server-only (logging); otherwise pure.
 *
 * @module lib/inventory/equipped-set
 */

import { logger } from '@/lib/logger';
import { normalizeEquippedInventory } from '@/lib/database/repositories/chats.repository';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import type { InventoryPool } from '@/lib/inventory/pool';
import { isEquippable } from '@/lib/inventory/resolve';

export { kitState } from '@/lib/inventory/resolve';

/** The raw ids a chat stores for one character. */
export function equippedIdsOf(chat: { equippedInventory?: unknown }, characterId: string): string[] {
  return normalizeEquippedInventory(chat.equippedInventory)[characterId] ?? [];
}

/** True when the chat has an entry (even an empty one) for the character. */
export function hasEquippedEntry(chat: { equippedInventory?: unknown }, characterId: string): boolean {
  return characterId in normalizeEquippedInventory(chat.equippedInventory);
}

/** What a character carries in a chat, resolved; unresolvable ids dropped. */
export function readEquippedSet(
  chat: { id?: string; equippedInventory?: unknown },
  characterId: string,
  pool: InventoryPool,
): ResolvedInventoryItem[] {
  const out: ResolvedInventoryItem[] = [];
  for (const id of equippedIdsOf(chat, characterId)) {
    const item = pool.resolveId(id);
    if (!item || !isEquippable(item)) {
      logger.debug('[InventoryEquippedSet] Dropped an id that no longer resolves to a carriable object', {
        chatId: chat.id,
        characterId,
        itemId: id,
        reason: !item ? 'missing' : item.archivedAt ? 'archived' : item.isArchetype ? 'archetype' : 'kit',
        context: 'inventory',
      });
      continue;
    }
    out.push(item);
  }
  return out;
}
