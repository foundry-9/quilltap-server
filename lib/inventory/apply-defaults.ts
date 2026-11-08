/**
 * Arrival defaults — what a character carries when they arrive in a chat.
 *
 * Called beside `applyOutfitSelections` at each of its call sites (chat
 * start, a seat added or reactivated, a merge) with the same `source`:
 *
 *   - for a character the operator let choose (`choose`, the characters whose
 *     outfit mode is `llm_choose`) with no entry yet, the Green Room picks
 *     what they carry in from what they can reach (`green-room.ts`) and it
 *     is equipped leniently and silently; a failed or timed-out choice falls
 *     through to the rules below. This wins over a source chat's list — the
 *     operator asked for a fresh choice for this scene;
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
import { inventoryChangeContext } from '@/lib/inventory/equip-effects';
import {
  equipItemsHoldingLock,
  loadEquipChat,
  withChatInventoryLock,
  writeCarriedSet,
  type EquipChat,
  type EquipResult,
} from '@/lib/inventory/equip';
import { equippedIdsOf, hasEquippedEntry } from '@/lib/inventory/equipped-set';
import { loadInventoryPool } from '@/lib/inventory/pool';
import { chooseArrivalInventory, type InventoryGreenRoomOptions } from '@/lib/inventory/green-room';

export type InventoryArrivalSource = 'chat-start' | 'participant-added' | 'merge';

export interface ApplyInventoryDefaultsOptions {
  source: InventoryArrivalSource;
  userId: string;
  /** A continuation's (or a merge's) source chat: its lists are copied. */
  sourceChatId?: string | null;
  /** The Green Room's inventory pass, for the characters who choose their own. */
  choose?: InventoryGreenRoomOptions;
}

/**
 * Equip a character's defaults — every reachable object flagged
 * `equippedByDefault` that is not an archetype (kits included; equip expands
 * them) — leniently and silently. The caller holds the chat's lock, so the
 * pool read here is the one equip plans against. Records an empty entry when
 * nothing was carried, so a later re-seat does not apply defaults again.
 */
async function equipDefaults(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  userId: string,
): Promise<EquipResult | null> {
  const pool = await loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
  const ids = pool
    .resolved()
    .filter((item) => item.equippedByDefault && !item.isArchetype)
    .map((item) => item.id);
  const result = ids.length > 0
    ? await equipItemsHoldingLock(repos, chat, characterId, ids, inventoryChangeContext(userId, 'operator', { announce: false }), { lenient: true, pool })
    : null;
  if (!result || result.equipped.length === 0) await writeCarriedSet(repos, chat.id, characterId, []);
  return result;
}

/**
 * Equip what the Green Room chose — leniently (an object over its cap is
 * dropped, one that can no longer be carried is skipped) and silently, as the
 * character's own choice, so the project roster still holds. Records an empty
 * entry for an empty-handed choice. Returns false when the equip failed, so
 * the caller falls back to the defaults. The caller holds the chat's lock.
 */
async function equipGreenRoomPicks(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  ids: readonly string[],
  opts: ApplyInventoryDefaultsOptions,
): Promise<boolean> {
  try {
    const result = ids.length > 0
      ? await equipItemsHoldingLock(repos, chat, characterId, ids, inventoryChangeContext(opts.userId, 'character', { announce: false }), { lenient: true })
      : null;
    if (!result || result.equipped.length === 0) await writeCarriedSet(repos, chat.id, characterId, []);
    logger.debug('[InventoryArrival] Equipped the Green Room\'s choice', {
      op: 'arrival',
      chatId: chat.id,
      characterId,
      source: opts.source,
      chosen: ids,
      equipped: result?.equipped.map((item) => item.id) ?? [],
      created: result?.created.map((item) => item.id) ?? [],
      skipped: result?.skipped ?? [],
      context: 'inventory',
    });
    return true;
  } catch (error) {
    logger.warn('[InventoryArrival] Could not equip the Green Room\'s choice; applying the defaults', {
      chatId: chat.id,
      characterId,
      source: opts.source,
      context: 'inventory',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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
  const chat = await loadEquipChat(repos, chatId);
  if (!chat) {
    logger.debug('[InventoryArrival] No such chat; nothing to apply', { chatId, source: opts.source, context: 'inventory' });
    return;
  }
  const sourceChat = opts.sourceChatId ? await loadEquipChat(repos, opts.sourceChatId) : null;
  const arriving = Array.from(new Set(characterIds));

  // The Green Room's choices, concurrently and outside the lock — each is a
  // model round trip, and holding the chat's lock across them would hold up
  // every other gesture. Only a character with no entry yet is asked; the
  // entry is checked again under the lock before anything is written.
  const choosing = new Set(opts.choose?.characterIds ?? []);
  const picks = new Map<string, string[] | null>();
  if (opts.choose && choosing.size > 0) {
    const askFor = arriving.filter((id) => choosing.has(id) && !hasEquippedEntry(chat, id));
    if (askFor.length > 0) {
      opts.choose.progress?.status('Packing everyone’s pockets…');
      const choices = await Promise.all(
        askFor.map((id) => chooseArrivalInventory(repos, chat, id, opts.userId, opts.choose!)),
      );
      askFor.forEach((id, i) => picks.set(id, choices[i]));
    }
  }

  for (const characterId of arriving) {
    try {
      // One character's arrival is one critical section on the chat's carried
      // set, so an equip landing mid-arrival is never rewound.
      const picked = picks.get(characterId) ?? null;
      await withChatInventoryLock(chat.id, () => arriveUnderLock(repos, chat, sourceChat, characterId, opts, picked));
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
  /** The Green Room's choice, when it made one; null applies the rules below. */
  picked: string[] | null = null,
): Promise<void> {
  const chatId = chat.id;
  // Read inside the lock: an earlier character's write, or an equip, changed it.
  const current = (await loadEquipChat(repos, chatId)) ?? chat;
  if (hasEquippedEntry(current, characterId)) {
    logger.debug('[InventoryArrival] Character already has an entry; defaults not revisited', {
      chatId,
      characterId,
      source: opts.source,
      context: 'inventory',
    });
    return;
  }
  if (picked && (await equipGreenRoomPicks(repos, current, characterId, picked, opts))) return;
  if (sourceChat && hasEquippedEntry(sourceChat, characterId)) {
    const ids = equippedIdsOf(sourceChat, characterId);
    await writeCarriedSet(repos, chatId, characterId, ids);
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
  await writeCarriedSet(repos, chat.id, characterId, null);
  const fresh = (await loadEquipChat(repos, chat.id)) ?? chat;
  await equipDefaults(repos, fresh, characterId, userId);
  const after = (await loadEquipChat(repos, chat.id)) ?? fresh;
  logger.debug('[InventoryArrival] Reset to defaults', {
    op: 'reset-defaults',
    chatId: chat.id,
    characterId,
    equipped: equippedIdsOf(after, characterId),
    context: 'inventory',
  });
  return equippedIdsOf(after, characterId);
}
