/**
 * Slot Operations — the pure math of putting things on and taking them off.
 *
 * Every "put it on" gesture obeys a single rule, keyed on the item's `replace`
 * flag and applied to *each* slot the item's `types` designate:
 *
 *   - `replace: false` (the default for both leaf garments and additive
 *     composites) — the item is *layered* into the slot: its id is appended,
 *     keeping whatever is already there.
 *   - `replace: true` — the item *replaces* the slot: the slot becomes just
 *     `[item.id]`. Used for full-outfit swaps and "clear everything"
 *     composites like Naked.
 *
 * Composites (items with `componentItemIds`) dissolve as they go on: the
 * leaves are stored in the slots their own `types` declare and the composite's
 * id never lands in equipped state, so what you're wearing always reads as
 * garments rather than as one opaque card over empty slot rows. Dissolution is
 * deliberately *total* — `expandComposites` walks to leaves, so a composite
 * nested inside a composite dissolves too. It is also fail-safe: a composite
 * whose parts can't be resolved (they live in a store this caller can't see)
 * is stored whole, the pre-4.8.1 behaviour, and read-time `expandComposites`
 * still covers it. Wearing something never resolves to wearing nothing.
 *
 * Pure and client-safe — no I/O and no logger, so the wardrobe dialog's
 * optimistic updates import exactly the code the server runs. The persisted
 * primitives (load → this → commit) live in `outfit-displacement.ts`; the
 * server logs a malformed graph through {@link analyzeComposite}.
 *
 * @module lib/wardrobe/slot-ops
 */

import { expandComposites } from '@/lib/wardrobe/expand-composites';
import {
  WARDROBE_SLOT_TYPES,
  addIdToSlot,
  cloneEquippedSlots,
  isComposite,
  makeEmptyEquippedSlots,
  removeIdFromSlot,
} from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * The minimum an item has to expose to be dissolved or worn. Stated
 * structurally so the server's full `WardrobeItem` and the client's lighter
 * summaries both satisfy it without conversion.
 */
export interface WearableNode {
  id: string;
  types: readonly string[];
  componentItemIds?: readonly string[];
  replace?: boolean;
}

/** Item lookup used to resolve a composite's components. */
export type WearableLookup = ReadonlyMap<string, WearableNode>;

/** A dissolved leaf: the id to store, and the slots it occupies. */
export interface DissolvedLeaf {
  id: string;
  slots: WardrobeItemType[];
}

/** A dissolved composite and the leaves it contributed, for the ledger's composite credit. */
export type WornBundle = { id: string; leafIds: string[] };

const SLOT_SET = new Set<string>(WARDROBE_SLOT_TYPES);

/** The recognized slots an item covers, filtering out anything unknown. */
function slotsOf(item: WearableNode): WardrobeItemType[] {
  return item.types.filter((t): t is WardrobeItemType => SLOT_SET.has(t));
}

/** What dissolving a composite found — the leaves, plus what went wrong on the way. */
export interface CompositeAnalysis {
  /** Null = wear the item as its own id (not a composite, no lookup, or nothing resolved). */
  leaves: DissolvedLeaf[] | null;
  cycles: number;
  truncated: boolean;
  /** True when the item is a composite and a lookup was given but no part was wearable. */
  unresolved: boolean;
}

/**
 * Dissolve a composite and report how it went. The server logs from this; the
 * client only needs {@link dissolveCompositeToLeaves}.
 */
export function analyzeComposite(item: WearableNode, itemsById?: WearableLookup): CompositeAnalysis {
  if (!itemsById || !isComposite(item)) {
    return { leaves: null, cycles: 0, truncated: false, unresolved: false };
  }

  const { leafIds, cycles, truncated } = expandComposites(item.componentItemIds ?? [], itemsById);

  const leaves: DissolvedLeaf[] = [];
  for (const leafId of leafIds) {
    // A component pointing back at its own composite would have the composite
    // wear itself. `expandComposites` truncates the cycle; drop the echo here.
    if (leafId === item.id) continue;
    const leaf = itemsById.get(leafId);
    if (!leaf) continue;
    const slots = slotsOf(leaf);
    if (slots.length === 0) continue;
    leaves.push({ id: leafId, slots });
  }

  return {
    leaves: leaves.length > 0 ? leaves : null,
    cycles: cycles.length,
    truncated,
    unresolved: leaves.length === 0,
  };
}

/**
 * Expand a composite into the leaf garments that should be worn in its place,
 * or `null` — "wear this item as its own id" — when the item isn't a
 * composite, no lookup was supplied, or not one component resolved to
 * something wearable.
 */
export function dissolveCompositeToLeaves(
  item: WearableNode,
  itemsById?: WearableLookup,
): DissolvedLeaf[] | null {
  return analyzeComposite(item, itemsById).leaves;
}

/**
 * Lay a dissolved composite's leaves into a slots snapshot. Each leaf lands in
 * every slot its *own* `types` declare. `clearCoveredSlots` is the composite's
 * `replace` gesture, and it clears the union of the composite's own `types`
 * and every slot its leaves occupy — an assembled outfit that brings boots
 * swaps the boots already on rather than layering over them.
 */
export function layLeavesIntoSlots(
  currentSlots: EquippedSlots,
  composite: WearableNode,
  leaves: readonly DissolvedLeaf[],
  options: { clearCoveredSlots: boolean },
): EquippedSlots {
  let slots: EquippedSlots = cloneEquippedSlots(currentSlots);

  if (options.clearCoveredSlots) {
    const covered = new Set<WardrobeItemType>(slotsOf(composite));
    for (const leaf of leaves) {
      for (const slot of leaf.slots) covered.add(slot);
    }
    for (const slot of covered) slots[slot] = [];
  }

  for (const leaf of leaves) {
    for (const slot of leaf.slots) slots = addIdToSlot(slots, slot, leaf.id);
  }

  return slots;
}

/**
 * Dissolve every composite already sitting in a slots snapshot, reporting
 * which ones it dissolved and the leaves each contributed — the claim the wear
 * ledger needs to credit an outfit as worn.
 *
 * For the snapshot builders (the default outfit, the cheap LLM's chat-start
 * pick, a manual selection) which compose slots directly instead of going
 * through the wear primitives. Layer order is preserved: a composite's leaves
 * are substituted where its id sat; leaves covering a slot it never occupied
 * are appended to that slot. Composites that can't be resolved stay as they are.
 *
 * `only` restricts the pass to the named composites — the "Break apart" gesture
 * on one legacy outfit card, which must dissolve exactly as wearing it would.
 */
export function dissolveCompositesInSlots(
  currentSlots: EquippedSlots,
  itemsById: WearableLookup,
  only?: ReadonlySet<string>,
): { slots: EquippedSlots; wornBundles: WornBundle[] } {
  const dissolved = new Map<string, DissolvedLeaf[]>();
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const id of currentSlots[slot] ?? []) {
      if (dissolved.has(id)) continue;
      if (only && !only.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;
      const leaves = dissolveCompositeToLeaves(item, itemsById);
      if (leaves) dissolved.set(id, leaves);
    }
  }

  if (dissolved.size === 0) return { slots: currentSlots, wornBundles: [] };

  const next: EquippedSlots = makeEmptyEquippedSlots();

  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const id of currentSlots[slot] ?? []) {
      const leaves = dissolved.get(id);
      if (!leaves) {
        if (!next[slot].includes(id)) next[slot].push(id);
        continue;
      }
      for (const leaf of leaves) {
        if (leaf.slots.includes(slot) && !next[slot].includes(leaf.id)) {
          next[slot].push(leaf.id);
        }
      }
    }
  }

  // A leaf whose slot the composite never claimed still belongs in that slot.
  for (const leaves of dissolved.values()) {
    for (const leaf of leaves) {
      for (const slot of leaf.slots) {
        if (!next[slot].includes(leaf.id)) next[slot].push(leaf.id);
      }
    }
  }

  const wornBundles = Array.from(dissolved, ([id, leaves]) => ({
    id,
    leafIds: leaves.map((leaf) => leaf.id),
  }));
  return { slots: next, wornBundles };
}

/**
 * The composite credit a put-on gesture claims: the composite and the leaves
 * it dissolved into, or nothing when the item is a leaf or could not dissolve.
 */
export function wornBundlesFor(
  item: WearableNode,
  itemsById: WearableLookup | undefined,
  onlySlot?: WardrobeItemType,
): WornBundle[] {
  const leaves = dissolveCompositeToLeaves(item, itemsById);
  if (!leaves) return [];
  const contributed = onlySlot ? leaves.filter((leaf) => leaf.slots.includes(onlySlot)) : leaves;
  if (contributed.length === 0) return [];
  return [{ id: item.id, leafIds: contributed.map((leaf) => leaf.id) }];
}

/**
 * Flag-driven wear: for each slot in `item.types`, replace the slot with
 * `[item.id]` when `item.replace` is true, otherwise append `item.id`. A
 * composite goes on as its parts; `replace` still clears the slots it lands in.
 */
export function wearItemIntoSlots(
  currentSlots: EquippedSlots,
  item: WearableNode,
  itemsById?: WearableLookup,
): EquippedSlots {
  const leaves = dissolveCompositeToLeaves(item, itemsById);
  if (leaves) {
    return layLeavesIntoSlots(currentSlots, item, leaves, {
      clearCoveredSlots: item.replace === true,
    });
  }

  let slots = cloneEquippedSlots(currentSlots);
  for (const slotType of slotsOf(item)) {
    slots = item.replace ? { ...slots, [slotType]: [item.id] } : addIdToSlot(slots, slotType, item.id);
  }
  return slots;
}

/** Force-swap: clear each slot in `item.types` and put the item there, ignoring the flag. */
function replaceItemIntoSlots(
  currentSlots: EquippedSlots,
  item: WearableNode,
  itemsById?: WearableLookup,
): EquippedSlots {
  const leaves = dissolveCompositeToLeaves(item, itemsById);
  if (leaves) {
    return layLeavesIntoSlots(currentSlots, item, leaves, { clearCoveredSlots: true });
  }

  const slots = cloneEquippedSlots(currentSlots);
  for (const slotType of slotsOf(item)) {
    slots[slotType] = [item.id];
  }
  return slots;
}

/**
 * Single-slot layering. A composite contributes the parts that cover this slot
 * rather than its own id; if none do, the composite's id goes in so the
 * gesture is never silently a no-op.
 */
export function addItemToSlot(
  currentSlots: EquippedSlots,
  slot: WardrobeItemType,
  item: WearableNode,
  itemsById?: WearableLookup,
): EquippedSlots {
  const leaves = dissolveCompositeToLeaves(item, itemsById);
  const forSlot = leaves?.filter((leaf) => leaf.slots.includes(slot)) ?? [];

  if (forSlot.length > 0) {
    let slots = cloneEquippedSlots(currentSlots);
    for (const leaf of forSlot) slots = addIdToSlot(slots, slot, leaf.id);
    return slots;
  }

  return addIdToSlot(currentSlots, slot, item.id);
}

/**
 * The five gestures, by name:
 *
 *   - `wear` — the flag-driven rule (`wearItemIntoSlots`).
 *   - `replace` — force-swap, ignoring the flag.
 *   - `add_to_slot` — layer onto one named slot.
 *   - `remove_from_slot` — take one item out of one slot (`itemId` omitted:
 *     clear the slot). Single-slot by design; the `wardrobe_remove` tool's
 *     "take it off everywhere" is a loop of these over the slots the item
 *     occupies.
 *   - `clear_slot` — empty one slot.
 */
export type DisplacementMode = 'wear' | 'replace' | 'add_to_slot' | 'remove_from_slot' | 'clear_slot';

export interface ComputeDisplacedOptions {
  mode: DisplacementMode;
  /** Required for `wear`, `replace`, and `add_to_slot`. */
  item?: WearableNode;
  /** Required for `add_to_slot`, `remove_from_slot`, `clear_slot`. */
  slot?: WardrobeItemType;
  /** Filter target for `remove_from_slot`; omit to clear the slot. */
  itemId?: string;
  /** Item lookup used to dissolve a composite as it goes on. */
  itemsById?: WearableLookup;
}

/** The one mode → primitive table. Returns a fresh slots object. */
export function computeDisplacedSlots(
  currentSlots: EquippedSlots,
  options: ComputeDisplacedOptions,
): EquippedSlots {
  const { mode, item, slot, itemId, itemsById } = options;
  switch (mode) {
    case 'wear':
      return item ? wearItemIntoSlots(currentSlots, item, itemsById) : cloneEquippedSlots(currentSlots);
    case 'replace':
      return item ? replaceItemIntoSlots(currentSlots, item, itemsById) : cloneEquippedSlots(currentSlots);
    case 'add_to_slot':
      return item && slot ? addItemToSlot(currentSlots, slot, item, itemsById) : cloneEquippedSlots(currentSlots);
    case 'remove_from_slot':
      return slot ? removeIdFromSlot(currentSlots, slot, itemId) : cloneEquippedSlots(currentSlots);
    case 'clear_slot':
      return slot ? removeIdFromSlot(currentSlots, slot) : cloneEquippedSlots(currentSlots);
  }
}

/** The slots a mode's gesture would credit to the wear ledger as worn composites. */
export function wornBundlesForMode(options: ComputeDisplacedOptions): WornBundle[] {
  const { mode, item, slot, itemsById } = options;
  if (!item) return [];
  if (mode === 'wear' || mode === 'replace') return wornBundlesFor(item, itemsById);
  if (mode === 'add_to_slot') return wornBundlesFor(item, itemsById, slot);
  return [];
}
