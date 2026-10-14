/**
 * Outfit-change side effects — what follows any change to what a character
 * has on in a chat.
 *
 * Two effects, and every surface that changes an outfit fires them here:
 *
 *   - the character's per-chat avatar is refreshed, when the chat has opted in
 *     (`triggerAvatarGenerationIfEnabled`);
 *   - Aurora's wardrobe announcement is queued. Inside a model turn the
 *     orchestrator hands the tools a per-turn `pendingWardrobeAnnouncements`
 *     set, so N wardrobe edits in one response collapse into one
 *     announcement, drained at turn end by
 *     {@link flushPendingWardrobeAnnouncements}. Without the set (the
 *     operator's `?action=equip`) the announcement is enqueued at once; the
 *     job itself is debounced.
 *
 * The opening of a chat and a seat joining mid-chat refresh the avatar only
 * ({@link refreshAvatarForOutfit}) — the Host's opening whisper says what
 * everyone is wearing there.
 *
 * Server-only.
 *
 * @module lib/wardrobe/outfit-change-effects
 */

import { logger } from '@/lib/logger';
import { enqueueWardrobeOutfitAnnouncement } from '@/lib/background-jobs/queue-service';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';

/** Who changed whose outfit, and the turn's announcement set if there is one. */
export interface OutfitChangeContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Per-turn announcement queue the orchestrator threads through the tools. */
  pendingWardrobeAnnouncements?: Set<string>;
}

/** Refresh the character's per-chat avatar if the chat auto-updates avatars. Never throws. */
export async function refreshAvatarForOutfit(
  repos: RepositoryContainer,
  context: Pick<OutfitChangeContext, 'userId' | 'chatId' | 'characterId'>,
  sourceContext: string,
): Promise<void> {
  await triggerAvatarGenerationIfEnabled(repos, {
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId,
    callerContext: sourceContext,
  });
}

/** Enqueue one Aurora announcement now. Never throws. */
export async function scheduleWardrobeAnnouncement(
  sourceContext: string,
  args: { userId: string; chatId: string; characterId: string },
): Promise<void> {
  try {
    await enqueueWardrobeOutfitAnnouncement(args.userId, {
      chatId: args.chatId,
      characterId: args.characterId,
    });
    logger.debug('Wardrobe outfit announcement scheduled', {
      context: sourceContext,
      chatId: args.chatId,
      characterId: args.characterId,
    });
  } catch (error) {
    logger.warn('Failed to schedule wardrobe outfit announcement', {
      context: sourceContext,
      chatId: args.chatId,
      characterId: args.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Note that a character's outfit changed. With a turn's announcement set the
 * character joins it; without one the announcement is enqueued now.
 */
export async function recordPendingWardrobeAnnouncement(
  context: OutfitChangeContext,
  sourceContext: string,
): Promise<void> {
  if (context.pendingWardrobeAnnouncements) {
    context.pendingWardrobeAnnouncements.add(context.characterId);
    return;
  }
  await scheduleWardrobeAnnouncement(sourceContext, context);
}

/**
 * Both effects of an outfit change. Call ONCE per gesture (or per tool call,
 * however many operations it applied), and only when something landed.
 */
export async function notifyWardrobeChanged(
  repos: RepositoryContainer,
  context: OutfitChangeContext,
  sourceContext: string,
): Promise<void> {
  await refreshAvatarForOutfit(repos, context, sourceContext);
  await recordPendingWardrobeAnnouncement(context, sourceContext);
}

/**
 * Drain the turn's announcement set, one announcement per character.
 * Idempotent: the set is cleared, so a second drain in the same turn is a no-op.
 */
export async function flushPendingWardrobeAnnouncements(
  context: Pick<OutfitChangeContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements'>,
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
