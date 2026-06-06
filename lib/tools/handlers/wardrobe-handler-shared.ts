import { logger } from '@/lib/logger';
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';
import type { ToolExecutionContext } from '@/lib/chat/tool-executor';

interface WardrobeReposForSummary {
  chats: {
    getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null>;
  };
  wardrobe: {
    findByCharacterId(characterId: string, includeArchived?: boolean): Promise<WardrobeItem[]>;
    findByIdsForCharacter(
      characterId: string,
      ids: string[],
      opts?: { projectMountPointIds?: string[] },
    ): Promise<WardrobeItem[]>;
  };
}

export function emptyEquippedState(): EquippedSlots {
  return { ...EMPTY_EQUIPPED_SLOTS };
}

/**
 * What a wardrobe mutation did to the slots it touched, reported back to the
 * LLM so it knows whether existing items survived.
 *
 *   - `layered`  — the item was added on top; whatever was already in those
 *                  slots stayed (the item's `replace` flag is off).
 *   - `replaced` — those slots were cleared and set to just this item.
 *   - `removed`  — a named item was taken off; any other layers stayed.
 *   - `cleared`  — the slot(s) were emptied entirely.
 */
export type WardrobeEffect = 'layered' | 'replaced' | 'removed' | 'cleared';

/**
 * One-sentence, model-facing description of what a wardrobe mutation just did.
 * Phrased identically across the wardrobe tools so the LLM gets a consistent
 * read on layer-vs-replace.
 */
export function describeWardrobeEffect(
  effect: WardrobeEffect,
  slots: readonly string[],
  itemTitle?: string | null,
): string {
  const slotList = slots.length > 0 ? slots.join(', ') : 'the slot';
  const those = slots.length > 1 ? 'those slots' : 'that slot';
  const title = itemTitle ? `"${itemTitle}"` : 'the item';
  switch (effect) {
    case 'layered':
      return `Layered ${title} into ${slotList}. The item's replace flag is off, so whatever was already in ${those} was kept.`;
    case 'replaced':
      return `Replaced ${slotList} with ${title} — anything previously in ${those} was cleared.`;
    case 'removed':
      return itemTitle
        ? `Took ${title} off ${slotList}; any other layers there stayed.`
        : `Cleared ${slotList}.`;
    case 'cleared':
      return `Cleared ${slotList} entirely.`;
  }
}

export async function loadCurrentWardrobeState(
  repos: WardrobeReposForSummary,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return equippedOutfit ?? emptyEquippedState();
}

/**
 * Build the human-readable `coverage_summary` returned to the LLM in wardrobe
 * tool results. Delegates to `resolveEquippedOutfitForCharacter` so the LLM
 * sees the same canonical resolution Aurora uses — composites expanded
 * (loading components via `findByCharacterId`, not just `findByIds` on
 * equipped slot IDs) and multi-slot atomic items routed by their own `types`.
 */
export async function buildWardrobeCoverageSummaryFromState(
  repos: WardrobeReposForSummary,
  characterId: string,
  slots: EquippedSlots,
  opts?: { projectMountPointIds?: string[] },
): Promise<string> {
  const resolved = await resolveEquippedOutfitForCharacter(repos, characterId, slots, {
    projectMountPointIds: opts?.projectMountPointIds,
  });
  return describeOutfit(resolved.outfitValues);
}

export async function scheduleWardrobeAnnouncement(
  sourceContext: string,
  args: {
    userId: string;
    chatId: string;
    characterId: string;
    extraLogFields?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(args.userId, {
      chatId: args.chatId,
      characterId: args.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: sourceContext,
      chatId: args.chatId,
      characterId: args.characterId,
      ...(args.extraLogFields ?? {}),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record that the given character's wardrobe was modified during this turn.
 *
 * If the tool execution context has a `pendingWardrobeAnnouncements` Set
 * (the orchestrator initializes one per turn), the characterId is added to
 * it and Aurora's notification is deferred until the orchestrator drains the
 * Set at end-of-turn — collapsing N wardrobe edits in a single LLM response
 * into a single announcement.
 *
 * If the Set is missing (legacy callers without orchestrator threading), the
 * announcement is enqueued immediately so behavior degrades safely.
 */
export async function recordPendingWardrobeAnnouncement(
  context: Pick<ToolExecutionContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'>,
  args: {
    sourceContext: string;
    characterId: string;
    extraLogFields?: Record<string, unknown>;
  },
): Promise<void> {
  if (context.pendingWardrobeAnnouncements) {
    context.pendingWardrobeAnnouncements.add(args.characterId);
    return;
  }
  await scheduleWardrobeAnnouncement(args.sourceContext, {
    userId: context.userId,
    chatId: context.chatId,
    characterId: args.characterId,
    extraLogFields: args.extraLogFields,
  });
}

/**
 * Drain the per-turn `pendingWardrobeAnnouncements` Set, scheduling one
 * Aurora announcement per character. Idempotent — clearing the Set after the
 * drain means later calls in the same turn produce no duplicate announcements.
 *
 * Safe to call when the Set is missing or empty (no-op).
 */
export async function flushPendingWardrobeAnnouncements(
  context: Pick<ToolExecutionContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'>,
): Promise<void> {
  const pending = context.pendingWardrobeAnnouncements;
  if (!pending || pending.size === 0) return;
  const characterIds = Array.from(pending);
  pending.clear();
  for (const characterId of characterIds) {
    await scheduleWardrobeAnnouncement('orchestrator-turn-end', {
      userId: context.userId,
      chatId: context.chatId,
      characterId,
    });
  }
}
