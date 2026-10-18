/**
 * Inventory context — the rolling character's bag, loaded once per tool call
 * or per custom-tool run (spec inventory-tools-and-pascal §5.1).
 *
 * The pool (`loadInventoryPool`), its resolved form and the character's
 * equipped set for the chat (`readEquippedSet`), handed to every reader
 * through {@link InventoryContext}. In the job child the chat read answers
 * from the per-job equipped-inventory overlay a buffered
 * `setEquippedInventory` writes into, so two gestures in one run see each
 * other.
 *
 * Server-only.
 *
 * @module lib/inventory/context
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { readEquippedSet } from '@/lib/inventory/equipped-set';
import { loadInventoryPool, type InventoryPool } from '@/lib/inventory/pool';
import { inventoryContextFrom, type InventoryContext, type ResolvedInventoryPool } from '@/lib/inventory/refs';

export type { InventoryContext } from '@/lib/inventory/refs';

/** A loaded context, with the server pool it was built from. */
export interface LoadedInventoryContext extends InventoryContext {
  pool: ResolvedInventoryPool;
  equippedIds: ReadonlySet<string>;
  serverPool: InventoryPool;
}

/** The resolved form of a server pool: every reachable object plus the holder's own archived ones. */
export function resolvedPoolOf(pool: InventoryPool): ResolvedInventoryPool {
  const reachable = pool.resolved();
  const seen = new Set(reachable.map((item) => item.id));
  const archivedOwn = pool.own
    .filter((record) => record.archivedAt && !seen.has(record.id))
    .map((record) => pool.resolve(record));
  return { items: [...reachable, ...archivedOwn], owns: (id) => pool.owns(id) };
}

/** Load the rolling character's inventory context for a chat (no chat: nothing equipped). */
export async function loadInventoryContext(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>,
  characterId: string,
  chatId: string | null,
): Promise<LoadedInventoryContext> {
  const chat = chatId ? await repos.chats.findById(chatId) : null;
  const serverPool = await loadInventoryPool(repos, {
    characterId,
    chatId,
    projectId: (chat as { projectId?: string | null } | null)?.projectId ?? null,
  });
  const equipped = chat ? readEquippedSet(chat, characterId, serverPool) : [];
  const equippedIds = new Set(equipped.map((item) => item.id));
  const pool = resolvedPoolOf(serverPool);
  logger.debug('[InventoryContext] Loaded', {
    characterId,
    chatId,
    reachable: pool.items.length,
    equipped: equippedIds.size,
    context: 'inventory',
  });
  return { ...inventoryContextFrom(characterId, chatId, pool, equippedIds), pool, equippedIds, serverPool };
}
