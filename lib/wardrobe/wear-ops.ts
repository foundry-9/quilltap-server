/**
 * Wear operations — the shared front half of every "put it on" / "take it
 * off" gesture, for the wardrobe tools and the chat's `?action=equip` alike.
 *
 *   - {@link resolveWearable} turns a reference (id, or title for the tools)
 *     into an item the character may wear in the requested way, or one
 *     refusal with one set of words: not found, archived (bug 191), or a slot
 *     the item doesn't cover.
 *   - {@link wearItem} maps a put-on mode to its gesture, applies it through
 *     `applyDisplacement`, and says what happened (layered / replaced) and
 *     where.
 *
 * Take-off is narrower on purpose. The route's `remove_from_slot` takes one
 * item out of one named slot; the `wardrobe_take_off` tool's `remove` takes
 * an item out of every slot it covers, which is that same gesture looped
 * over the item's slots (`takeOffItem`). {@link takeOffWearable} is the
 * by-reference form the tool and Pascal's wardrobe effects share: a single
 * garment comes off its slots, and a composite comes off by its LEAVES —
 * worn composites are stored dissolved, so filtering the composite's own id
 * out of a slot would remove nothing.
 *
 * Server-only.
 *
 * @module lib/wardrobe/wear-ops
 */

import { WARDROBE_SLOT_TYPES, cloneEquippedSlots, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import { applyDisplacement, type DisplacementRepos } from '@/lib/wardrobe/outfit-displacement';
import { componentGraph, type WearablePool } from '@/lib/wardrobe/pool';
import type { WardrobeItemWithOrigin } from '@/lib/wardrobe/wardrobe-container';
import { wearRefusal } from '@/lib/wardrobe/wearable';

/** The put-on modes. `equip` is the route's deprecated alias for `wear`. */
export type PutOnMode = 'wear' | 'replace' | 'add_to_slot';

export interface WearableRef {
  itemId?: string | null;
  /** Tools only: a case-insensitive title, own items first. */
  itemTitle?: string | null;
}

export type WearableResolution =
  | { ok: true; item: WardrobeItemWithOrigin }
  | { ok: false; reason: 'not_found' | 'archived' | 'slot'; message: string };

/** The not-found wording every wardrobe surface uses. */
export function wardrobeItemNotFoundMessage(
  itemId: string | null | undefined,
  itemTitle: string | null | undefined,
): string {
  return `Wardrobe item not found${itemId ? ` with ID "${itemId}"` : ''}${itemTitle ? ` with title "${itemTitle}"` : ''}`;
}

/** Find an item in the pool by id, then by title. Archived items are found. */
export function findInPool(pool: WearablePool, ref: WearableRef): WardrobeItemWithOrigin | null {
  if (ref.itemId) {
    const byId = pool.get(ref.itemId);
    if (byId) return byId;
  }
  if (ref.itemTitle) {
    return pool.findByTitle(ref.itemTitle) ?? null;
  }
  return null;
}

/**
 * Resolve a reference to an item the character may put on in `mode` (and,
 * for `add_to_slot`, into `slot`).
 */
export function resolveWearable(
  pool: WearablePool,
  ref: WearableRef,
  mode: PutOnMode,
  slot?: WardrobeItemType,
): WearableResolution {
  const item = findInPool(pool, ref);
  if (!item) {
    return { ok: false, reason: 'not_found', message: wardrobeItemNotFoundMessage(ref.itemId, ref.itemTitle) };
  }
  const refusal = wearRefusal(item);
  if (refusal) return { ok: false, reason: 'archived', message: refusal };
  if (mode === 'add_to_slot' && slot && !item.types.includes(slot)) {
    return {
      ok: false,
      reason: 'slot',
      message: `Item "${item.title}" (types: ${item.types.join(', ')}) cannot be added to the "${slot}" slot`,
    };
  }
  return { ok: true, item };
}

export interface WearOutcome {
  slots: EquippedSlots;
  effect: 'layered' | 'replaced';
  slotsAffected: WardrobeItemType[];
}

/** Put a resolved item on in `mode` and commit it. */
export async function wearItem(
  repos: DisplacementRepos,
  chatId: string,
  pool: WearablePool,
  item: WardrobeItemWithOrigin,
  mode: PutOnMode,
  slot: WardrobeItemType | undefined,
  source: 'ui' | 'tool',
): Promise<WearOutcome> {
  const slots = await applyDisplacement(
    repos,
    chatId,
    pool.characterId,
    { mode, item, slot, itemsById: pool.byId },
    source,
  );
  if (mode === 'add_to_slot') {
    return { slots, effect: 'layered', slotsAffected: slot ? [slot] : [] };
  }
  const effect = mode === 'replace' || item.replace ? 'replaced' : 'layered';
  return { slots, effect, slotsAffected: [...item.types] };
}

/**
 * Take one item off the given slots (the tool's `remove`: every slot the item
 * covers, or the one it names). Other layers in those slots stay.
 */
export async function takeOffItem(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  itemId: string,
  slots: readonly WardrobeItemType[],
): Promise<void> {
  for (const slot of slots) {
    await applyDisplacement(repos, chatId, characterId, { mode: 'remove_from_slot', slot, itemId });
  }
}

export interface TakeOffOutcome {
  /** The slots after the last commit, or what was loaded when nothing was committed. */
  slots: EquippedSlots;
  /** Every slot a removal was committed against, in slot order. */
  slotsAffected: WardrobeItemType[];
}

/**
 * Take a resolved item off, by reference — the `wardrobe_take_off` tool's
 * `remove` and Pascal's `take_off` effect both come through here.
 *
 * - A single garment comes off every slot it covers, or only `slot` when one
 *   is named (`takeOffItem`) — other layers stay.
 * - A composite comes off by its leaves: every item in its component graph
 *   (the composite itself included, in case it was stored whole) is taken out
 *   of each slot it currently occupies, restricted to `slot` when one is
 *   named. A composite with nothing of it on commits nothing.
 *
 * Archived items may be taken off; archiving never undresses anyone.
 */
export async function takeOffWearable(
  repos: DisplacementRepos,
  chatId: string,
  pool: WearablePool,
  item: WardrobeItemWithOrigin,
  slot?: WardrobeItemType,
): Promise<TakeOffOutcome> {
  const characterId = pool.characterId;

  if ((item.componentItemIds ?? []).length === 0) {
    const slotsAffected: WardrobeItemType[] = slot ? [slot] : [...(item.types as WardrobeItemType[])];
    let slots: EquippedSlots | null = null;
    for (const s of slotsAffected) {
      slots = await applyDisplacement(repos, chatId, characterId, { mode: 'remove_from_slot', slot: s, itemId: item.id });
    }
    return { slots: slots ?? (await loadCurrentSlots(repos, chatId, characterId)), slotsAffected };
  }

  const current = await loadCurrentSlots(repos, chatId, characterId);
  const graphIds = new Set(componentGraph(pool, [item.id]).keys());
  const candidateSlots = slot ? [slot] : [...WARDROBE_SLOT_TYPES];

  let slots = current;
  const slotsAffected: WardrobeItemType[] = [];
  for (const s of candidateSlots) {
    const worn = (current[s] ?? []).filter((id) => graphIds.has(id));
    for (const id of worn) {
      slots = await applyDisplacement(repos, chatId, characterId, { mode: 'remove_from_slot', slot: s, itemId: id });
    }
    if (worn.length > 0) slotsAffected.push(s);
  }
  return { slots, slotsAffected };
}

/** The character's slots in a chat right now (empty when none are stored). */
export async function loadCurrentSlots(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const current = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return current ? cloneEquippedSlots(current) : makeEmptyEquippedSlots();
}
