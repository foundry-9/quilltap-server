/**
 * Arrival defaults — what a character carries when they arrive in a chat.
 *
 * Called beside `applyOutfitSelections` at each of its call sites (chat
 * start, a seat added or reactivated, a merge) with the same `source`:
 *
 *   - with a source chat (a continuation, or a merge's merged chat) that has
 *     an entry for the character, its list is copied — ids only; the reader
 *     drops what no longer resolves;
 *   - otherwise, for a character **with no entry yet**, every reachable,
 *     non-archived, non-archetype object flagged `equippedByDefault` is
 *     equipped (a flagged kit equips its members) through `equipItems`, with
 *     no announcement (arrival is not a gesture) and leniently: an object
 *     over its cap is dropped with a `warn`, never failing the arrival.
 *
 * Defaults apply only at arrival; a chat whose operator has changed things
 * is not revisited. {@link resetInventoryToDefaults} is the by-hand remedy.
 *
 * Never throws: a failure for one character is logged and the rest go on.
 *
 * Server-only.
 *
 * @module lib/inventory/apply-defaults
 */

import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { equipItemsHoldingLock, withChatInventoryLock, type EquipChat, type EquipResult } from '@/lib/inventory/equip';
import { equippedIdsOf, hasEquippedEntry } from '@/lib/inventory/equipped-set';
import { loadInventoryPool } from '@/lib/inventory/pool';

export type InventoryArrivalSource = 'chat-start' | 'participant-added' | 'merge';

export interface ApplyInventoryDefaultsOptions {
  source: InventoryArrivalSource;
  userId: string;
  /** A continuation's (or a merge's) source chat: its lists are copied. */
  sourceChatId?: string | null;
}

/** The ids a character's defaults name, kits included (equip expands them). */
async function defaultIdsFor(repos: RepositoryContainer, chat: EquipChat, characterId: string): Promise<string[]> {
  const pool = await loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
  return pool
    .resolved()
    .filter((item) => item.equippedByDefault && !item.isArchetype && !item.archivedAt)
    .map((item) => item.id);
}

/** Equip a character's defaults leniently and silently. The caller holds the chat's lock. */
async function equipDefaults(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  userId: string,
): Promise<EquipResult | null> {
  const ids = await defaultIdsFor(repos, chat, characterId);
  if (ids.length === 0) return null;
  return equipItemsHoldingLock(repos, chat, characterId, ids, { userId, provenance: 'operator', announce: false }, { lenient: true });
}

/** Apply arrival defaults for each character. */
export async function applyInventoryDefaults(
  repos: RepositoryContainer,
  chatId: string,
  characterIds: readonly string[],
  opts: ApplyInventoryDefaultsOptions,
): Promise<void> {
  try {
    await applyDefaultsUnguarded(repos, chatId, characterIds, opts);
  } catch (error) {
    logger.warn('[InventoryArrival] Failed to apply arrival defaults', {
      chatId,
      source: opts.source,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function applyDefaultsUnguarded(
  repos: RepositoryContainer,
  chatId: string,
  characterIds: readonly string[],
  opts: ApplyInventoryDefaultsOptions,
): Promise<void> {
  const chat = (await repos.chats.findById(chatId)) as EquipChat | null;
  if (!chat) {
    logger.debug('[InventoryArrival] No such chat; nothing to apply', { chatId, source: opts.source, context: 'inventory' });
    return;
  }
  const sourceChat = opts.sourceChatId ? ((await repos.chats.findById(opts.sourceChatId)) as EquipChat | null) : null;

  for (const characterId of Array.from(new Set(characterIds))) {
    try {
      // One character's arrival is one critical section on the chat's carried
      // set, so an equip landing mid-arrival is never rewound.
      await withChatInventoryLock(chat.id, () => arriveUnderLock(repos, chat, sourceChat, characterId, opts));
    } catch (error) {
      logger.warn('[InventoryArrival] Failed to apply arrival defaults for a character', {
        chatId,
        characterId,
        source: opts.source,
        context: 'inventory',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function arriveUnderLock(
  repos: RepositoryContainer,
  chat: EquipChat,
  sourceChat: EquipChat | null,
  characterId: string,
  opts: ApplyInventoryDefaultsOptions,
): Promise<void> {
  const chatId = chat.id;
  // Read inside the lock: an earlier character's write, or an equip, changed it.
  const current = ((await repos.chats.findById(chatId)) as EquipChat | null) ?? chat;
  if (hasEquippedEntry(current, characterId)) {
    logger.debug('[InventoryArrival] Character already has an entry; defaults not revisited', {
      chatId,
      characterId,
      source: opts.source,
      context: 'inventory',
    });
    return;
  }
  if (sourceChat && hasEquippedEntry(sourceChat, characterId)) {
    const ids = equippedIdsOf(sourceChat, characterId);
    await repos.chats.setEquippedInventory(chatId, characterId, ids);
    logger.debug('[InventoryArrival] Copied the source chat\'s carried objects', {
      op: 'arrival',
      chatId,
      sourceChatId: sourceChat.id,
      characterId,
      source: opts.source,
      equipped: ids,
      context: 'inventory',
    });
    return;
  }
  const result = await equipDefaults(repos, current, characterId, opts.userId);
  if (!result || result.equipped.length === 0) {
    // Record the arrival, so a later re-seat does not apply defaults again.
    await repos.chats.setEquippedInventory(chatId, characterId, []);
  }
  logger.debug('[InventoryArrival] Applied arrival defaults', {
    op: 'arrival',
    chatId,
    characterId,
    source: opts.source,
    equipped: result?.equipped.map((item) => item.id) ?? [],
    created: result?.created.map((item) => item.id) ?? [],
    skipped: result?.skipped ?? [],
    context: 'inventory',
  });
}

/**
 * Clear a character's entry and apply the defaults again — the operator's
 * *Reset to defaults*. Silent, as arrival is: it restores the starting state
 * rather than making a gesture. Returns the ids now carried.
 */
export async function resetInventoryToDefaults(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  userId: string,
): Promise<string[]> {
  // The clear, the defaults and the trailing write are one critical section,
  // so an equip cannot land between them and be rewound.
  return withChatInventoryLock(chat.id, () => resetUnderLock(repos, chat, characterId, userId));
}

async function resetUnderLock(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  userId: string,
): Promise<string[]> {
  await repos.chats.setEquippedInventory(chat.id, characterId, null);
  const fresh = ((await repos.chats.findById(chat.id)) as EquipChat | null) ?? chat;
  const result = await equipDefaults(repos, fresh, characterId, userId);
  if (!result || result.equipped.length === 0) await repos.chats.setEquippedInventory(chat.id, characterId, []);
  const after = ((await repos.chats.findById(chat.id)) as EquipChat | null) ?? fresh;
  logger.debug('[InventoryArrival] Reset to defaults', {
    op: 'reset-defaults',
    chatId: chat.id,
    characterId,
    equipped: equippedIdsOf(after, characterId),
    context: 'inventory',
  });
  return equippedIdsOf(after, characterId);
}
