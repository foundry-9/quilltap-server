/**
 * Inventory effects — where a custom tool's `inventory` gestures land.
 *
 * The third applier beside `side-effects.ts` (value writes) and
 * `wardrobe-effects.ts` (outfit gestures), and shaped like the second: a
 * sequence of gestures through the equip chokepoints, each of which loads the
 * current set and commits on its own.
 *
 * ## Doctrine (spec inventory-tools-and-pascal §5.6)
 *
 * 1. **No character, no gesture.** A run nobody made carries nothing.
 * 2. **One context per run** (`loadInventoryContext`), re-read after a gesture
 *    lands so the next one resolves against it; unloadable → warn, nothing.
 * 3. **Gestures in file order, items in list order.** References resolve
 *    through `resolveInventoryRef` (`lib/inventory/refs.ts`) — `equip` and
 *    `unequip` by `pickForGesture`, `pick_up` to archetypes only — and then
 *    ONE `equipItems` / `unequipItems` / `pickUpItems` call per gesture with
 *    the `'pascal'` provenance and the turn's pending set. A cap breach fails
 *    THAT gesture before any write (`pickUpItems` plans ahead of its
 *    instantiations, so no instance lands unequipped) and is recorded as
 *    skipped with the refusal's own words; the next gesture proceeds.
 *    Fail-soft per gesture, never per run; an unresolved reference is
 *    skipped with a debug log.
 * 4. **Sequential, and safe in the job child**: the chokepoints' reads of
 *    `chats.equippedInventory` answer through the per-job overlay.
 * 5. **Audit entries**, one per landed object: `inventory.equip`,
 *    `inventory.unequip`, `inventory.pick_up`, with the equipped ids before
 *    and after.
 * 6. **Never throws.**
 *
 * @module lib/pascal/inventory-effects
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { loadInventoryContext, type InventoryContext } from '@/lib/inventory/context';
import { equipItems, loadEquipChat, pickUpItems, unequipItems, type EquipChat } from '@/lib/inventory/equip';
import { inventoryChangeContext } from '@/lib/inventory/equip-effects';
import { pickForGesture, resolveInventoryRef, type ResolvedInventoryPool } from '@/lib/inventory/refs';
import { inventoryLabel } from '@/lib/inventory/resolve';
import type { WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';
import type { ResolvedInventoryGesture } from './custom-tools';
import type { IndexedAppliedEffect } from './wardrobe-effects';

const CONTEXT = 'pascal.inventory-effects';

/** The `target` an applied inventory gesture records in `pascalMeta.effects`. */
export type InventoryEffectTarget = 'inventory.equip' | 'inventory.unequip' | 'inventory.pick_up';

/** What one landed object records as its `next`. */
export interface InventoryEffectRecord {
  item: { id: string; title: string };
  /** True for an instance this gesture made (a pick-up, or a kit's archetype member). */
  created?: boolean;
  /** The character's equipped ids after this gesture. */
  equipped: string[];
}

export interface ApplyInventoryEffectsParams extends Pick<WardrobeTurnContainers, 'pendingInventoryAnnouncements'> {
  userId: string;
  chatId: string;
  toolName: string;
  /** The rolling character. null → every gesture skips. */
  characterId: string | null;
  gestures: Array<{ index: number; inventory: ResolvedInventoryGesture }>;
  /** The run's context, when the entrance already loaded it. */
  inventory?: InventoryContext | null;
}

type Loaded = InventoryContext & { pool: ResolvedInventoryPool; equippedIds: ReadonlySet<string> };

function isLoaded(ctx: InventoryContext | null | undefined): ctx is Loaded {
  return !!ctx && !!ctx.pool && !!ctx.equippedIds;
}

/**
 * Apply a run's inventory gestures to the rolling character. Returns one entry
 * per object that landed, in effect order, tagged with its effect's index.
 * Never throws.
 */
export async function applyInventoryEffects(params: ApplyInventoryEffectsParams): Promise<IndexedAppliedEffect[]> {
  const { userId, chatId, toolName, characterId, gestures } = params;
  if (gestures.length === 0) return [];

  if (!characterId) {
    logger.debug('Custom tool: no rolling character, inventory effects skipped', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      gestures: gestures.length,
    });
    return [];
  }

  const repos = getRepositories();
  let ctx: Loaded;
  let chat: EquipChat | null;
  try {
    ctx = isLoaded(params.inventory) ? params.inventory : await loadInventoryContext(repos, characterId, chatId);
    chat = await loadEquipChat(repos, chatId);
  } catch (error) {
    logger.warn('Custom tool inventory effects skipped — the inventory could not be read', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      characterId,
      error: getErrorMessage(error),
    });
    return [];
  }
  if (!chat) {
    logger.warn('Custom tool inventory effects skipped — no such chat', { context: CONTEXT, chatId, tool: toolName });
    return [];
  }

  const changeCtx = inventoryChangeContext(userId, 'pascal', params);

  const skip = (index: number, reason: string, detail: Record<string, unknown> = {}): void => {
    logger.debug('Custom tool inventory effect not applied', {
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
  const land = (
    index: number,
    target: InventoryEffectTarget,
    previous: string[],
    items: readonly ResolvedInventoryItem[],
    after: string[],
    created: ReadonlySet<string> = new Set(),
  ): void => {
    for (const item of items) {
      const next: InventoryEffectRecord = {
        item: { id: item.id, title: inventoryLabel(item) },
        ...(created.has(item.id) ? { created: true } : {}),
        equipped: after,
      };
      applied.push({ index, applied: { target, previous, next } });
    }
  };

  for (const { index, inventory: gesture } of gestures) {
    const before = Array.from(ctx.equippedIds).sort();
    try {
      if (gesture.action === 'pick_up') {
        const archetypeIds: string[] = [];
        for (const ref of gesture.items) {
          const archetype = resolveInventoryRef(ref, ctx.pool, ctx.equippedIds, { includeArchetypes: true })
            .find((m) => m.item.isArchetype)?.item;
          if (!archetype) {
            skip(index, 'no reachable archetype by that reference', { reference: ref });
            continue;
          }
          archetypeIds.push(archetype.id);
        }
        if (archetypeIds.length === 0) continue;
        const equip = gesture.equip !== false;
        const result = await pickUpItems(repos, chat, characterId, archetypeIds, changeCtx, { equip });
        const after = equip ? [...before, ...result.created.map((item) => item.id)].sort() : before;
        land(index, 'inventory.pick_up', before, result.created, after, new Set(result.created.map((item) => item.id)));
      } else {
        const ids: string[] = [];
        for (const ref of gesture.items) {
          const matches = resolveInventoryRef(ref, ctx.pool, ctx.equippedIds);
          const pick = pickForGesture(matches, gesture.action);
          if (!pick) {
            skip(index, matches.length === 0 ? 'no object by that reference' : `nothing to ${gesture.action}`, { reference: ref });
            continue;
          }
          if (!ids.includes(pick.item.id)) ids.push(pick.item.id);
        }
        if (ids.length === 0) continue;
        if (gesture.action === 'equip') {
          const result = await equipItems(repos, chat, characterId, ids, changeCtx);
          const after = [...before, ...result.equipped.map((item) => item.id)].sort();
          land(index, 'inventory.equip', before, result.equipped, after, new Set(result.created.map((item) => item.id)));
        } else {
          const result = await unequipItems(repos, chat, characterId, ids, changeCtx);
          const gone = new Set(result.unequipped.map((item) => item.id));
          land(index, 'inventory.unequip', before, result.unequipped, before.filter((id) => !gone.has(id)));
        }
      }
    } catch (error) {
      // A refusal (the cap, an archetype named for equip) fails THIS gesture
      // before anything was written; the next one proceeds.
      skip(index, getErrorMessage(error), { action: gesture.action, items: gesture.items });
      continue;
    }

    // The next gesture resolves against what this one left.
    try {
      ctx = await loadInventoryContext(repos, characterId, chatId);
    } catch (error) {
      logger.warn('Custom tool inventory effects stopped — the inventory could not be re-read', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        error: getErrorMessage(error),
      });
      break;
    }
  }

  logger.debug('Custom tool inventory effects applied', {
    context: CONTEXT,
    chatId,
    tool: toolName,
    characterId,
    applied: applied.map(({ applied: a }) => a.target),
    announcement: params.pendingInventoryAnnouncements ? 'joined the turn' : 'posted now',
  });
  return applied;
}
