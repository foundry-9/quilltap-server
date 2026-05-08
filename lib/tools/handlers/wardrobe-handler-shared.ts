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
    findByIds(ids: string[]): Promise<WardrobeItem[]>;
  };
}

export function emptyEquippedState(): EquippedSlots {
  return { ...EMPTY_EQUIPPED_SLOTS };
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
): Promise<string> {
  const resolved = await resolveEquippedOutfitForCharacter(repos, characterId, slots);
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
