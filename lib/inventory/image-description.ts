/**
 * The Inventory's image phrase — what a character carries, as rendering
 * hints for the image pipelines.
 *
 * `describeEquippedInventoryForImages` joins the equipped objects'
 * `imageDescription`s into one noun-phrase list ("carrying a longsword with a
 * jewelled pommel, a brass signet ring on the left hand"). An object with no
 * `imageDescription` is not depicted; a kit never is (its members are). The
 * phrase reaches the pictures through the appearance resolver
 * (`resolveCharacterAppearances`, the Lantern and the image tool) and the
 * avatar job, which hand it to the prompt builders as text — no prompt
 * builder reads the Inventory itself.
 *
 * Server-only (the loader); the renderer is pure.
 *
 * @module lib/inventory/image-description
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { equippedIdsOf, readEquippedSet } from '@/lib/inventory/equipped-set';
import { loadInventoryPool, type InventoryPool } from '@/lib/inventory/pool';
import { inventoryLabel } from '@/lib/inventory/resolve';

/** Render the phrase from resolved objects, or null when none is depicted. Pure. */
export function renderCarryingPhrase(items: readonly ResolvedInventoryItem[]): string | null {
  const phrases = items
    .filter((item) => item.kind !== 'kit' && item.imageDescription?.trim())
    .sort((a, b) => inventoryLabel(a).localeCompare(inventoryLabel(b), undefined, { sensitivity: 'base' }))
    .map((item) => (item.imageDescription as string).trim().replace(/[.!?]+$/, ''));
  return phrases.length > 0 ? `carrying ${phrases.join(', ')}` : null;
}

/** The phrase for one character in a chat, against a pool already loaded. */
export function describeEquippedInventoryForImages(
  chat: { id?: string; equippedInventory?: unknown },
  characterId: string,
  pool: InventoryPool,
): string | null {
  return renderCarryingPhrase(readEquippedSet(chat, characterId, pool));
}

/**
 * Load the pool and build the phrase for one character in a chat; null when
 * nothing carried is depicted. Never throws.
 */
export async function loadCarryingPhrase(
  repos: Pick<RepositoryContainer, 'characters' | 'chats'>,
  chat: { id: string; projectId?: string | null; equippedInventory?: unknown },
  characterId: string,
): Promise<string | null> {
  if (equippedIdsOf(chat, characterId).length === 0) return null;
  try {
    const pool = await loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
    const phrase = describeEquippedInventoryForImages(chat, characterId, pool);
    logger.debug('[InventoryImages] Built the carrying phrase', {
      chatId: chat.id,
      characterId,
      present: phrase !== null,
      op: 'image-phrase',
      context: 'inventory',
    });
    return phrase;
  } catch (error) {
    logger.warn('[InventoryImages] Failed to build the carrying phrase; picture goes without it', {
      chatId: chat.id,
      characterId,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
