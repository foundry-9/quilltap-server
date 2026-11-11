/**
 * The equipped set — the objects a character carries in one chat, read.
 *
 * `chats.equippedInventory[characterId]` holds ids; this resolves them
 * against the character's pool and drops any that no longer resolve to
 * something carriable (missing, archived, an archetype or a kit), each logged
 * at `debug`. Nothing is written: a dropped id leaves the column at the next
 * equip write (`equip.ts` prunes it) — unless the pool failed to read a tier.
 * **A whole-set rewrite never treats "unread" as "gone"** (#186): while any
 * tier is unread, an id that resolves nowhere may live in that tier, so
 * {@link heldForUnreadTiers} hands it back for the rewrite to keep.
 *
 * {@link loadEquippedSet} is the readers' door (the prompt section, the image
 * phrase): it answers an empty set without reading any pool when the chat
 * stores nothing for the character, which is the common case.
 *
 * Server-only.
 *
 * @module lib/inventory/equipped-set
 */

import { logger } from '@/lib/logger';
import { normalizeEquippedInventory } from '@/lib/database/repositories/chats.repository';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { loadInventoryPool, type InventoryPool } from '@/lib/inventory/pool';
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

/**
 * The stored ids a whole-set rewrite must keep because the pool could not
 * read every tier: each one that resolves nowhere in the pool, since it may
 * live in a tier that failed to read (#186). Empty when every tier was read —
 * then an unresolved id really is gone and the rewrite prunes it.
 */
export function heldForUnreadTiers(
  chat: { id?: string; equippedInventory?: unknown },
  characterId: string,
  pool: Pick<InventoryPool, 'byId' | 'unreadMounts'>,
): string[] {
  if (pool.unreadMounts.length === 0) return [];
  const held = equippedIdsOf(chat, characterId).filter((id) => !pool.byId.has(id));
  if (held.length > 0) {
    logger.warn('[InventoryEquippedSet] A tier was unread; keeping carried ids it may hold', {
      chatId: chat.id,
      characterId,
      heldIds: held,
      unreadMounts: pool.unreadMounts.map((mount) => mount.mountPointId),
      context: 'inventory',
    });
  }
  return held;
}

/**
 * What a character carries in a chat, loading their pool only when the chat
 * stores something for them. Throws what the pool read throws; the callers
 * fail soft.
 */
export async function loadEquippedSet(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>,
  chat: { id: string; projectId?: string | null; equippedInventory?: unknown },
  characterId: string,
): Promise<ResolvedInventoryItem[]> {
  if (equippedIdsOf(chat, characterId).length === 0) return [];
  const pool = await loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
  return readEquippedSet(chat, characterId, pool);
}
