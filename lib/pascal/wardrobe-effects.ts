/**
 * Wardrobe effects — where a custom tool's `wardrobe` gestures land.
 *
 * A separate applier from `side-effects.ts` on purpose. That one is a
 * read-once, batch-commit over whole-object stores; this one is a sequence of
 * gestures through the outfit chokepoint, each of which loads the current
 * slots and commits on its own. Different doctrines, different files.
 *
 * ## Doctrine
 *
 * - **No new writer.** Every change goes through `wearItem` /
 *   `takeOffWearable` (`lib/wardrobe/wear-ops.ts`) or `applyDisplacement`
 *   itself, and the side effects of a change (avatar refresh, Aurora's
 *   announcement) through `notifyWardrobeChanged` — once, after the loop,
 *   and only when something actually changed.
 * - **The rolling character wears it**, and nobody else. A run nobody made
 *   dresses nobody.
 * - **One pool per run**, the same one a `wardrobe_*` tool call reads
 *   (`loadToolPool`). References resolve by id, then case-insensitive title.
 * - **Sequential, and safe in the job child.** Gestures go one by one so each
 *   sees the last: in the parent because the write landed, in the child
 *   because `chats.getEquippedOutfitForCharacter` answers from the per-job
 *   equipped-outfit overlay. Never batch the slot math locally — the wear
 *   ledger credits one wear per committed transition.
 * - **Source is `'tool'`.** A Pascal effect is a tool wearing something.
 * - **Fail-soft per item, never per run.** An item that cannot be resolved,
 *   or whose commit throws, is skipped with a log; the rest proceed. Never
 *   throws.
 *
 * @module lib/pascal/wardrobe-effects
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import type { WearablePool } from '@/lib/wardrobe/pool';
import { applyDisplacement } from '@/lib/wardrobe/outfit-displacement';
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects';
import { turnContainersOf, type WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';
import {
  findInPool,
  loadCurrentSlots,
  resolveWearable,
  takeOffWearable,
  wardrobeItemNotFoundMessage,
  wearItem,
} from '@/lib/wardrobe/wear-ops';
import { loadToolPool } from '@/lib/tools/handlers/wardrobe-handler-shared';
import type { ResolvedWardrobeGesture } from './custom-tools';
import type { AppliedEffect } from './side-effects';

const CONTEXT = 'pascal.wardrobe-effects';

/** The `target` an applied wardrobe gesture records in `pascalMeta.effects`. */
export type WardrobeEffectTarget = 'wardrobe.wear' | 'wardrobe.take_off' | 'wardrobe.clear_slot';

/** What one landed wardrobe gesture records as its `next`. */
export interface WardrobeEffectRecord {
  /** The item that went on or came off. Absent on `clear_slot`. */
  item?: { id: string; title: string };
  /** The one slot named: `add_to_slot`, `clear_slot`, or a restricted `take_off`. */
  slot?: WardrobeItemType;
  slotsAffected: WardrobeItemType[];
  effect: 'layered' | 'replaced' | 'removed' | 'cleared';
  /** The character's slots after this change. */
  slots: EquippedSlots;
}

/** An applied effect with the index of the definition effect that produced it, for ordering. */
export interface IndexedAppliedEffect {
  index: number;
  applied: AppliedEffect;
}

export interface ApplyWardrobeEffectsParams extends WardrobeTurnContainers {
  userId: string;
  chatId: string;
  toolName: string;
  /** The rolling character. null → every gesture skips fail-soft. */
  characterId: string | null;
  gestures: Array<{ index: number; wardrobe: ResolvedWardrobeGesture }>;
}

/**
 * Apply a run's wardrobe gestures to the rolling character. Returns one entry
 * per change that landed (an item put on or taken off, a slot cleared), in
 * effect order, each tagged with its effect's index. Never throws.
 */
export async function applyWardrobeEffects(params: ApplyWardrobeEffectsParams): Promise<IndexedAppliedEffect[]> {
  const { userId, chatId, toolName, characterId, gestures } = params;
  if (gestures.length === 0) return [];

  if (!characterId) {
    // A run nobody made dresses nobody — the asymmetry a metadata write keeps.
    logger.debug('Custom tool: no rolling character, wardrobe effects skipped', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      gestures: gestures.length,
    });
    return [];
  }

  const repos = getRepositories();

  let pool: WearablePool;
  let slots: EquippedSlots;
  try {
    pool = await loadToolPool(repos, chatId, characterId);
    slots = await loadCurrentSlots(repos, chatId, characterId);
  } catch (error) {
    logger.warn('Custom tool wardrobe effects skipped — the wardrobe could not be read', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      characterId,
      error: getErrorMessage(error),
    });
    return [];
  }

  const skip = (index: number, reason: string, detail: Record<string, unknown> = {}): void => {
    logger.debug('Custom tool wardrobe effect not applied', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      characterId,
      effectIndex: index,
      reason,
      ...detail,
    });
  };

  const applied: IndexedAppliedEffect[] = [];

  /** Record a change when it changed something; a no-op is logged and dropped. */
  const land = (
    index: number,
    target: WardrobeEffectTarget,
    previous: EquippedSlots,
    record: WardrobeEffectRecord
  ): void => {
    if (sameSlots(previous, record.slots)) {
      skip(index, 'the outfit was already so', { item: record.item?.title, slot: record.slot });
      return;
    }
    applied.push({ index, applied: { target, previous, next: record } });
  };

  for (const { index, wardrobe: gesture } of gestures) {
    if (gesture.action === 'clear_slot') {
      const slot = gesture.slot;
      if (!slot) {
        skip(index, 'clear_slot names no slot');
        continue;
      }
      const previous = slots;
      try {
        slots = await applyDisplacement(repos, chatId, characterId, { mode: 'clear_slot', slot });
      } catch (error) {
        warnFailed(chatId, toolName, index, { slot }, error);
        continue;
      }
      land(index, 'wardrobe.clear_slot', previous, { slot, slotsAffected: [slot], effect: 'cleared', slots });
      continue;
    }

    for (const ref of gesture.items) {
      if (gesture.action === 'wear') {
        const mode = gesture.mode ?? 'wear';
        const resolution = resolveWearable(pool, { itemId: ref, itemTitle: ref }, mode, gesture.slot);
        if (!resolution.ok) {
          skip(index, resolution.message, { reference: ref });
          continue;
        }
        const { item } = resolution;
        const previous = slots;
        try {
          const outcome = await wearItem(repos, chatId, pool, item, mode, gesture.slot, 'tool');
          slots = outcome.slots;
          land(index, 'wardrobe.wear', previous, {
            item: { id: item.id, title: item.title },
            ...(mode === 'add_to_slot' && gesture.slot ? { slot: gesture.slot } : {}),
            slotsAffected: outcome.slotsAffected,
            effect: outcome.effect,
            slots,
          });
        } catch (error) {
          warnFailed(chatId, toolName, index, { item: item.title }, error);
        }
        continue;
      }

      // take_off — archived items may come off; archiving never undresses anyone.
      const item = findInPool(pool, { itemId: ref, itemTitle: ref });
      if (!item) {
        skip(index, wardrobeItemNotFoundMessage(ref, ref), { reference: ref });
        continue;
      }
      const previous = slots;
      try {
        const outcome = await takeOffWearable(repos, chatId, pool, item, gesture.slot);
        slots = outcome.slots;
        land(index, 'wardrobe.take_off', previous, {
          item: { id: item.id, title: item.title },
          ...(gesture.slot ? { slot: gesture.slot } : {}),
          slotsAffected: outcome.slotsAffected,
          effect: 'removed',
          slots,
        });
      } catch (error) {
        warnFailed(chatId, toolName, index, { item: item.title }, error);
      }
    }
  }

  if (applied.length > 0) {
    await notifyWardrobeChanged(
      repos,
      {
        userId,
        chatId,
        characterId,
        provenance: { source: 'pascal', actorCharacterId: characterId, toolName },
        ...turnContainersOf(params),
      },
      CONTEXT
    );
    logger.debug('Custom tool wardrobe effects applied', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      characterId,
      applied: applied.map(({ applied: a }) => a.target),
      announcement: params.pendingWardrobeAnnouncements ? 'joined the turn' : 'enqueued now',
    });
  }

  return applied;
}

function warnFailed(
  chatId: string,
  toolName: string,
  index: number,
  detail: Record<string, unknown>,
  error: unknown
): void {
  logger.warn('Custom tool wardrobe effect failed; that change was dropped', {
    context: CONTEXT,
    chatId,
    tool: toolName,
    effectIndex: index,
    ...detail,
    error: getErrorMessage(error),
  });
}

function sameSlots(a: EquippedSlots, b: EquippedSlots): boolean {
  return WARDROBE_SLOT_TYPES.every((slot) => {
    const x = a[slot] ?? [];
    const y = b[slot] ?? [];
    return x.length === y.length && x.every((id, i) => id === y[i]);
  });
}
