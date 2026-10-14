/**
 * Persisted outfit changes — load, compute, commit.
 *
 * Every gesture that changes what a character has on in a chat comes through
 * {@link applyDisplacement}: it loads the character's current slots, runs the
 * pure gesture from `slot-ops.ts` (`computeDisplacedSlots`, the one mode →
 * primitive table), and commits through `wardrobeWear.commitEquippedOutfit`
 * — the wear ledger's chokepoint — telling it which composite (if any) the
 * gesture dissolved, since the stored leaves alone cannot say an outfit was
 * worn.
 *
 * The item lookup that lets a composite dissolve comes from the caller's
 * wearable pool (`pool.byId`); without one a composite is stored whole, which
 * still renders correctly via read-time expansion.
 *
 * Server-only. The pure math lives in `slot-ops.ts` for the client.
 *
 * @module wardrobe/outfit-displacement
 */

import { logger } from '@/lib/logger';
import { cloneEquippedSlots, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import {
  analyzeComposite,
  computeDisplacedSlots,
  wornBundlesForMode,
  type ComputeDisplacedOptions,
} from '@/lib/wardrobe/slot-ops';
import type {
  CommitEquippedOutfitInput,
  CommitEquippedOutfitResult,
  EquipSource,
} from '@/lib/database/repositories/wardrobe-wear.repository';

/** Minimal repository surface for a persisted outfit change. */
export interface DisplacementRepos {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
  };
  /** The equip chokepoint: writes the slots and credits the wear ledger. */
  wardrobeWear: {
    commitEquippedOutfit(input: CommitEquippedOutfitInput): Promise<CommitEquippedOutfitResult>;
  };
}

async function loadSlots(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const current = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return current ? cloneEquippedSlots(current) : makeEmptyEquippedSlots();
}

/** Log a composite that could not dissolve cleanly — the client-safe math can't. */
function logCompositeIssues(options: ComputeDisplacedOptions, characterId: string): void {
  if (!options.item || !options.itemsById) return;
  const { cycles, truncated, unresolved } = analyzeComposite(options.item, options.itemsById);
  if (cycles > 0 || truncated) {
    logger.warn('[applyDisplacement] Malformed composite graph; expansion truncated', {
      context: 'wardrobe',
      characterId,
      itemId: options.item.id,
      cycles,
      truncated,
    });
  }
  if (unresolved) {
    logger.warn('[applyDisplacement] Composite resolved to no wearable parts; wearing it whole', {
      context: 'wardrobe',
      characterId,
      itemId: options.item.id,
      componentCount: options.item.componentItemIds?.length ?? 0,
    });
  }
}

/**
 * Apply one gesture to a character's slots in a chat and commit it. Returns
 * the slots it computed (from the job child the chokepoint's write is
 * buffered, so its echo would be synthetic).
 *
 * The take-off modes (`remove_from_slot`, `clear_slot`) always commit as
 * `'take-off'`; the put-on modes use `source`.
 */
export async function applyDisplacement(
  repos: DisplacementRepos,
  chatId: string,
  characterId: string,
  options: ComputeDisplacedOptions,
  source: Extract<EquipSource, 'ui' | 'tool'> = 'ui',
): Promise<EquippedSlots> {
  const current = await loadSlots(repos, chatId, characterId);
  logCompositeIssues(options, characterId);
  const nextSlots = computeDisplacedSlots(current, options);
  const takeOff = options.mode === 'remove_from_slot' || options.mode === 'clear_slot';
  await repos.wardrobeWear.commitEquippedOutfit({
    chatId,
    characterId,
    nextSlots,
    wornBundles: wornBundlesForMode(options),
    source: takeOff ? 'take-off' : source,
  });
  logger.debug('[applyDisplacement] Outfit change committed', {
    context: 'wardrobe',
    chatId,
    characterId,
    mode: options.mode,
    itemId: options.item?.id ?? options.itemId ?? null,
    slot: options.slot ?? null,
    source: takeOff ? 'take-off' : source,
  });
  return nextSlots;
}
