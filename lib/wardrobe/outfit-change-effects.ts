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
 * Beside each announcement the outfit history is settled
 * (`repos.wardrobeHistory.settle`): one entry per announcement, never per
 * slot gesture. Inside a turn the intent waits in `pendingWardrobeHistory`
 * (last intent per character wins) and is drained with the announcements;
 * outside one it is settled at once. A rollback sets `historyIntent` to move
 * the cursor instead of appending. Create both turn containers with
 * {@link newWardrobeTurnContainers}.
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
import type {
  WardrobeHistoryIntent,
  WardrobeHistoryProvenance,
} from '@/lib/schemas/chat-wardrobe-history.types';
import type { WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';

/** Who changed whose outfit, and the turn's containers if there are any. */
export interface OutfitChangeContext extends WardrobeTurnContainers {
  userId: string;
  chatId: string;
  characterId: string;
  /** Who is changing the outfit. Required: no caller may forget it. */
  provenance: WardrobeHistoryProvenance;
  /** Rollback only: move the cursor instead of appending. Everyone else leaves it unset. */
  historyIntent?: WardrobeHistoryIntent;
}

export {
  newWardrobeTurnContainers,
  turnContainersOf,
  type WardrobeTurnContainers,
} from '@/lib/wardrobe/turn-containers';

/** The slice of the repositories the history half of the effects needs. */
type HistoryRepos = Pick<RepositoryContainer, 'wardrobeHistory'>;

/** Settle one history intent. `settle` itself never throws; this guards a missing repo too. */
async function settleHistory(
  repos: HistoryRepos,
  chatId: string,
  characterId: string,
  intent: WardrobeHistoryIntent,
  sourceContext: string,
): Promise<void> {
  try {
    await repos.wardrobeHistory.settle(chatId, characterId, intent);
  } catch (error) {
    logger.warn('Failed to settle wardrobe history', {
      context: sourceContext,
      chatId,
      characterId,
      intent,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Refresh the character's per-chat avatar if the chat auto-updates avatars:
 * the character's appearance changed — their outfit, or what they carry (the
 * Inventory calls this too). Never throws.
 */
export async function refreshAvatarForAppearance(
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

/** The outfit's name for {@link refreshAvatarForAppearance}. */
export const refreshAvatarForOutfit = refreshAvatarForAppearance;

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
 * Note that a character's outfit changed. With a turn's containers the
 * character joins the announcement set and its history intent replaces any
 * earlier one this turn; without them the announcement is enqueued and the
 * history settled now — the announcement first, then the entry, neither
 * waiting on the other's success.
 */
export async function recordPendingWardrobeAnnouncement(
  repos: HistoryRepos,
  context: OutfitChangeContext,
  sourceContext: string,
): Promise<void> {
  const intent: WardrobeHistoryIntent = context.historyIntent ?? { kind: 'append', provenance: context.provenance };
  if (context.pendingWardrobeAnnouncements) {
    context.pendingWardrobeAnnouncements.add(context.characterId);
    if (context.pendingWardrobeHistory) {
      context.pendingWardrobeHistory.set(context.characterId, intent);
    } else {
      // A turn set without its history map (a caller that predates the
      // factory): record now rather than lose the entry.
      await settleHistory(repos, context.chatId, context.characterId, intent, sourceContext);
    }
    return;
  }
  await scheduleWardrobeAnnouncement(sourceContext, context);
  await settleHistory(repos, context.chatId, context.characterId, intent, sourceContext);
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
  await recordPendingWardrobeAnnouncement(repos, context, sourceContext);
}

/**
 * Drain the turn's containers: for each character, settle its history intent,
 * then schedule its one announcement. Idempotent: both containers are
 * cleared, so a second drain in the same turn is a no-op.
 *
 * @param repos Defaults to the process's repositories (the job child's proxy
 *   in the child, where `settle` is buffered for the parent to replay).
 */
export async function flushPendingWardrobeAnnouncements(
  context: Pick<OutfitChangeContext, 'userId' | 'chatId' | 'pendingWardrobeAnnouncements' | 'pendingWardrobeHistory'>,
  repos?: HistoryRepos,
): Promise<void> {
  const pending = context.pendingWardrobeAnnouncements;
  if (!pending || pending.size === 0) return;
  const characterIds = Array.from(pending);
  const intents = new Map(context.pendingWardrobeHistory ?? []);
  pending.clear();
  context.pendingWardrobeHistory?.clear();
  const historyRepos = repos ?? (await import('@/lib/repositories/factory')).getRepositories();
  for (const characterId of characterIds) {
    // Every character in the set has an intent; the default keeps the drain
    // total if one somehow does not.
    const intent: WardrobeHistoryIntent = intents.get(characterId)
      ?? { kind: 'append', provenance: { source: 'character', actorCharacterId: characterId } };
    await settleHistory(historyRepos, context.chatId, characterId, intent, 'orchestrator-turn-end');
    await scheduleWardrobeAnnouncement('orchestrator-turn-end', {
      userId: context.userId,
      chatId: context.chatId,
      characterId,
    });
  }
}
