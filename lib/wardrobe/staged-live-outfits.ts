/**
 * Staged Live-tab outfit edits
 *
 * The Wardrobe dialog's "Wearing now" tab stages every gesture locally and
 * commits once, on Done. Two moments in that lifecycle have to reckon with a
 * worn snapshot that has not arrived yet, and both live here so they can be
 * reasoned about — and tested — away from the dialog's render logic.
 *
 *  - `rebaseStagedGestures` replays the gestures made during the window before
 *    the snapshot landed onto the true worn slots, so a fast click is neither
 *    overwritten by the first seed nor committed against an empty base.
 *  - `classifyStagedOutfits` separates "nothing changed" from "we never learned
 *    what clean was", which the flush used to treat identically — reporting
 *    success for an outfit it never sent (Bug 61).
 *
 * The wear ledger adds one more thing staging must remember: which outfits
 * (bundles) a staged gesture put on. The dialog dissolves a bundle to its
 * leaves client-side, so the slots it flushes cannot say an outfit was worn;
 * the ids travel beside them as `wornBundleIds` on the `set_all`, and the
 * server expands and intersects them with what actually went on. They live
 * and die with the staged slots — a rebase recomputes them from the replayed
 * gestures, and a commit or reset clears them.
 *
 * @module lib/wardrobe/staged-live-outfits
 */

import {
  addIdToSlot,
  cloneEquippedSlots,
  equippedSlotsEqual,
  isComposite,
  removeIdFromSlot,
} from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { addItemToSlot, wearItemIntoSlots } from '@/lib/wardrobe/slot-ops'
import { breakApartBundleInSlots, takeOffBundleFromSlots } from '@/lib/wardrobe/bundle-mutations'
import type { EquippedBundle } from '@/lib/wardrobe/group-equipped'

/** A staging gesture: pure, and safe to replay against a different base. */
export type SlotsMutator = (prev: EquippedSlots) => EquippedSlots

/**
 * A recorded gesture: the slot mutation, plus the bundles it put on (empty for
 * anything that is not wearing an outfit). Recorded while the worn snapshot is
 * still in flight so both halves can be replayed onto it together.
 */
export interface StagedGesture {
  mutate: SlotsMutator
  wornBundleIds: readonly string[]
}

/**
 * The bundle ids a put-on gesture for `item` claims: the item's own id when it
 * is a bundle (has components), nothing otherwise. A claim, not a fact — the
 * server credits it only if one of the bundle's leaves actually went on.
 */
export function wornBundleIdsFor(item: {
  id: string
  componentItemIds?: readonly string[] | null
}): string[] {
  return isComposite(item) ? [item.id] : []
}

/** Append bundle ids to an accumulated list, de-duplicated, first-seen order. */
export function appendWornBundleIds(
  prev: readonly string[] | undefined,
  ids: readonly string[],
): string[] {
  const out = [...(prev ?? [])]
  for (const id of ids) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Replay gestures staged before the worn snapshot arrived onto that snapshot,
 * and rebuild the accumulated bundle ids from exactly the gestures replayed.
 *
 * With no snapshot to build on, the dialog stages onto an empty fallback purely
 * so the click paints. Committing that would clear every slot the user never
 * touched, so the gestures are recorded and replayed here the moment the real
 * slots land. Mutators are pure, so applying them twice (once for the
 * optimistic paint, once here) is safe. Whatever was accumulated against the
 * empty fallback is discarded with it — the staged state and its bundle claims
 * reset together.
 */
export function rebaseStagedGestures(
  wornSlots: EquippedSlots,
  pending: readonly StagedGesture[],
): { slots: EquippedSlots; wornBundleIds: string[] } {
  return {
    slots: pending.reduce<EquippedSlots>((slots, g) => g.mutate(slots), cloneEquippedSlots(wornSlots)),
    wornBundleIds: pending.reduce<string[]>(
      (ids, g) => appendWornBundleIds(ids, g.wornBundleIds),
      [],
    ),
  }
}

/**
 * The body of one `set_all` equip. `wornBundleIds` is omitted when empty so a
 * plain slot edit sends exactly what it always did.
 */
export function buildSetAllEquipBody(
  characterId: string,
  slots: EquippedSlots,
  wornBundleIds?: readonly string[],
): { characterId: string; mode: 'set_all'; slots: EquippedSlots; wornBundleIds?: string[] } {
  return {
    characterId,
    mode: 'set_all',
    slots,
    ...(wornBundleIds && wornBundleIds.length > 0 ? { wornBundleIds: [...wornBundleIds] } : {}),
  }
}

/** What the Done flush should do with each character's staged slots. */
export interface StagedOutfitClassification {
  /**
   * Characters whose staged slots differ from their captured baseline, with
   * the bundles their staged gestures put on (present only when non-empty).
   */
  dirty: Array<{ characterId: string; slots: EquippedSlots; wornBundleIds?: string[] }>
  /**
   * Characters staged against no baseline at all — their worn snapshot never
   * arrived, so the edit can be neither confirmed as a change nor safely sent
   * (the staged slots were built on an empty fallback). The caller must surface
   * these rather than counting them as clean.
   */
  unresolved: string[]
}

/**
 * Split staged outfits into the ones to commit and the ones we cannot judge.
 *
 * A character with a baseline and matching slots is simply clean and appears in
 * neither list.
 */
export function classifyStagedOutfits(
  staged: Record<string, EquippedSlots>,
  baselines: Record<string, EquippedSlots>,
  wornBundleIdsByChar: Record<string, readonly string[]> = {},
): StagedOutfitClassification {
  const dirty: StagedOutfitClassification['dirty'] = []
  const unresolved: string[] = []

  for (const [characterId, slots] of Object.entries(staged)) {
    const baseline = baselines[characterId]
    if (!baseline) {
      unresolved.push(characterId)
      continue
    }
    if (!equippedSlotsEqual(slots, baseline)) {
      const wornBundleIds = wornBundleIdsByChar[characterId] ?? []
      dirty.push(
        wornBundleIds.length > 0
          ? { characterId, slots, wornBundleIds: [...wornBundleIds] }
          : { characterId, slots },
      )
    }
  }

  return { dirty, unresolved }
}

// ============================================================================
// COMPOSER GESTURES
//
// The six things an outfit composer can do to a slot bag, as replayable
// gestures. Every surface that stages an outfit (the dialog's Live tab and
// Outfit Builder, the chat-start composer) builds its handlers from these via
// `useComposerHandlers`, so the three surfaces cannot drift.
// ============================================================================

const plain = (mutate: SlotsMutator): StagedGesture => ({ mutate, wornBundleIds: [] })

/**
 * Wear an item across every slot it covers, honouring its `replace` flag
 * (`wearItemIntoSlots`). An id the pool doesn't know is appended to the slot
 * the gesture started in. Wearing an outfit claims its id for the wear ledger.
 */
export function wearGesture(
  slot: WardrobeItemType,
  itemId: string,
  itemsById: ReadonlyMap<string, WardrobeItem>,
): StagedGesture {
  const item = itemsById.get(itemId)
  if (!item) return plain((prev) => addIdToSlot(prev, slot, itemId))
  return {
    mutate: (prev) => wearItemIntoSlots(prev, item, itemsById),
    wornBundleIds: wornBundleIdsFor(item),
  }
}

/** Layer an item into one slot only (`addItemToSlot`). */
export function addToSlotGesture(
  slot: WardrobeItemType,
  item: WardrobeItem,
  itemsById: ReadonlyMap<string, WardrobeItem>,
): StagedGesture {
  return {
    mutate: (prev) => addItemToSlot(prev, slot, item, itemsById),
    wornBundleIds: wornBundleIdsFor(item),
  }
}

/** Take one id out of one slot. */
export function removeFromSlotGesture(slot: WardrobeItemType, itemId: string): StagedGesture {
  return plain((prev) => removeIdFromSlot(prev, slot, itemId))
}

/** Empty one slot. */
export function clearSlotGesture(slot: WardrobeItemType): StagedGesture {
  return plain((prev) => removeIdFromSlot(prev, slot))
}

/** Take a legacy whole-composite card off every slot it occupies. */
export function takeOffBundleGesture(bundle: EquippedBundle): StagedGesture {
  return plain((prev) => takeOffBundleFromSlots(prev, bundle))
}

/** Dissolve a legacy whole-composite card into its leaves. */
export function breakApartBundleGesture(
  bundle: EquippedBundle,
  itemsById: ReadonlyMap<string, WardrobeItem>,
): StagedGesture {
  return plain((prev) => breakApartBundleInSlots(prev, bundle, itemsById))
}
