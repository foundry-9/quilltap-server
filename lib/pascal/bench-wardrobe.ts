/**
 * The proving bench's wardrobe lens — which garment a dry run's wardrobe
 * gestures WOULD have found, had the character in the bench's chair rolled.
 *
 * The bench's doctrine is "the very same machinery a live chat uses", so this
 * resolves through the applier's own front half: `loadWearablePool` for the
 * pool, `findInPool` for a take-off (archived items may come off) and
 * `resolveWearable` for a put-on (which carries the archived and slot
 * refusals in their own words). It never calls `wearItem`,
 * `applyDisplacement` or `notifyWardrobeChanged`: a read, and nothing else.
 *
 * The pool has no project tier — the bench has no chat — exactly as
 * `loadToolPool` resolves a run in a chat with no project.
 *
 * Server-only.
 *
 * Design of record: docs/developer/features/complete/pascal-wardrobe-effect-picker.md §4.1
 *
 * @module lib/pascal/bench-wardrobe
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { loadWearablePool, type WearablePool } from '@/lib/wardrobe/pool';
import { findInPool, resolveWearable, wardrobeItemNotFoundMessage } from '@/lib/wardrobe/wear-ops';
import type { WardrobeItemWithOrigin } from '@/lib/wardrobe/wardrobe-container';
import { isApplicableWardrobeEffect, type ResolvedEffect } from './custom-tools';
import type { PreviewWardrobeItemResolution, PreviewWardrobeResolution } from './workbench';

const CONTEXT = 'custom-tools.preview';

function foundOf(ref: string, item: WardrobeItemWithOrigin): PreviewWardrobeItemResolution {
  return {
    ref,
    found: {
      id: item.id,
      title: item.title,
      types: [...item.types],
      origin: item.origin,
      imageFileId: item.imageFileId ?? null,
    },
  };
}

/** Resolve every wardrobe gesture's items against an already-loaded pool. Pure. */
export function resolveBenchWardrobeAgainst(
  pool: WearablePool,
  effects: readonly ResolvedEffect[],
): PreviewWardrobeResolution[] {
  const out: PreviewWardrobeResolution[] = [];
  for (const effect of effects) {
    if (!isApplicableWardrobeEffect(effect)) continue;
    const { index, wardrobe } = effect;
    // A cleared slot names no item; there is nothing to find.
    if (wardrobe.action === 'clear_slot') continue;
    const items = wardrobe.items.map((ref): PreviewWardrobeItemResolution => {
      const lookup = { itemId: ref, itemTitle: ref };
      if (wardrobe.action === 'take_off') {
        const item = findInPool(pool, lookup);
        return item
          ? foundOf(ref, item)
          : { ref, found: null, reason: 'not_found', message: wardrobeItemNotFoundMessage(null, ref) };
      }
      const resolution = resolveWearable(pool, lookup, wardrobe.mode ?? 'wear', wardrobe.slot);
      if (resolution.ok) return foundOf(ref, resolution.item);
      return {
        ref,
        found: null,
        reason: resolution.reason,
        message: resolution.reason === 'not_found' ? wardrobeItemNotFoundMessage(null, ref) : resolution.message,
      };
    });
    out.push({ index, items });
  }
  return out;
}

/**
 * The bench's wardrobe resolution for `characterId`, or undefined when the
 * run carries no wardrobe gesture or the wardrobe could not be read (logged
 * `warn`, fail-soft — the roll result still returns).
 */
export async function resolveBenchWardrobe(
  repos: Pick<RepositoryContainer, 'wardrobe' | 'projects' | 'chats'>,
  characterId: string,
  effects: readonly ResolvedEffect[] | undefined,
  toolName: string,
): Promise<PreviewWardrobeResolution[] | undefined> {
  const gestures = (effects ?? []).filter(
    (effect) => isApplicableWardrobeEffect(effect) && effect.wardrobe.action !== 'clear_slot',
  );
  if (gestures.length === 0) return undefined;

  let pool: WearablePool;
  try {
    // No project mounts and no chat: the lens has no project tier.
    pool = await loadWearablePool(repos, characterId, [], { operator: true });
  } catch (error) {
    logger.warn('Workbench preview: wardrobe resolution skipped — the wardrobe could not be read', {
      context: CONTEXT,
      tool: toolName,
      characterId,
      error: getErrorMessage(error),
    });
    return undefined;
  }

  const resolution = resolveBenchWardrobeAgainst(pool, gestures);
  const all = resolution.flatMap((entry) => entry.items);
  logger.debug('Workbench preview: wardrobe gestures resolved against the chair', {
    context: CONTEXT,
    tool: toolName,
    characterId,
    found: all.filter((entry) => entry.found !== null).length,
    missing: all.filter((entry) => entry.found === null).length,
  });
  return resolution;
}
