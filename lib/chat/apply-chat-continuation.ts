/**
 * Continue-in-new-chat ("change of venue") backfill.
 *
 * When the Salon Tool Palette's "Continue Elsewhere" button forks a chat into
 * a fresh one, the create handler runs the normal init prelude (system prompt
 * only) and then calls this module to:
 *
 *   1. Post a Host bubble in the new chat linking back to the source chat.
 *   2. Replay the carryover window — the most recent Librarian summary plus
 *      every later message — into the new chat, with participant IDs remapped
 *      by characterId.
 *   3. Replicate turn state (isPaused, turnQueue, lastTurnParticipantId,
 *      activeTypingParticipantId, impersonatingParticipantIds,
 *      allLLMPauseTurnCount), again with participant ID remapping.
 *   4. Post a Host bubble at the tail of the source chat linking to the new
 *      chat.
 *
 * The create handler then runs the rest of init (Prospero project context,
 * Host scenario announcement, Host adds for additional LLMs, Aurora opening
 * outfit whispers, avatar generation triggers) — but skips the auto-generated
 * first character message, since the conversation is already underway.
 *
 * Errors during backfill are logged loudly. The Host tail bubble in the
 * source chat is intentionally posted last so we never link to a chat that
 * failed to populate.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatEvent, ChatMetadata, MessageEvent } from '@/lib/schemas/types';
import {
  postHostContinuationFromAnnouncement,
  postHostContinuationToAnnouncement,
} from '@/lib/services/host-notifications/writer';

type Repos = RepositoryContainer;

export interface ApplyChatContinuationParams {
  newChatId: string;
  sourceChatId: string;
  userId: string;
  repos: Repos;
}

export interface ApplyChatContinuationResult {
  /** Number of carryover messages successfully written to the new chat. */
  replayedMessageCount: number;
  /** Whether a Librarian summary anchored the carryover window. */
  hadLibrarianSummary: boolean;
  /** Whether the source-chat tail bubble was posted. */
  postedSourceTailBubble: boolean;
}

/**
 * Build a map from old participant ID → new participant ID using shared
 * characterId. Old participants whose character isn't in the new chat are
 * absent from the map (their messages will be dropped during replay).
 */
function buildParticipantIdMap(
  sourceParticipants: ChatMetadata['participants'],
  newParticipants: ChatMetadata['participants'],
): Map<string, string> {
  const newByCharacterId = new Map<string, string>();
  for (const p of newParticipants) {
    if (p.characterId) {
      newByCharacterId.set(p.characterId, p.id);
    }
  }
  const map = new Map<string, string>();
  for (const p of sourceParticipants) {
    if (!p.characterId) continue;
    const newId = newByCharacterId.get(p.characterId);
    if (newId) {
      map.set(p.id, newId);
    }
  }
  return map;
}

/**
 * Find the index of the most recent Librarian summary message in the source
 * stream. Returns -1 when no summary has been posted yet (e.g. early chats).
 */
function findLibrarianSummaryAnchorIndex(events: ChatEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (
      ev.type === 'message' &&
      ev.systemSender === 'librarian' &&
      ev.systemKind === 'summary'
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Project an old MessageEvent onto a fresh row for the new chat. Strips
 * fields that are bound to the old chat's lifecycle (raw LLM responses,
 * token counts, rendered HTML, recovery markers, summary anchors, etc.) and
 * remaps participant IDs through the supplied map.
 *
 * Returns null when the message has an old participantId that isn't in the
 * map (i.e. its author isn't in the new chat) or when its targetParticipantIds
 * remap leaves it pointed at nobody.
 */
function projectMessageForNewChat(
  source: MessageEvent,
  participantMap: Map<string, string>,
): MessageEvent | null {
  // Drop participant-authored messages whose character isn't in the new chat.
  let newParticipantId: string | null | undefined = source.participantId ?? null;
  if (source.participantId) {
    const mapped = participantMap.get(source.participantId);
    if (!mapped) return null;
    newParticipantId = mapped;
  }

  // Remap whisper targets through the same map. Drop unknown IDs. If the
  // original was a whisper but every target is gone, drop the message —
  // there's nobody left to tell.
  let newTargets: string[] | null | undefined = source.targetParticipantIds ?? null;
  if (Array.isArray(source.targetParticipantIds) && source.targetParticipantIds.length > 0) {
    const remapped = source.targetParticipantIds
      .map((oid) => participantMap.get(oid))
      .filter((nid): nid is string => typeof nid === 'string' && nid.length > 0);
    if (remapped.length === 0) return null;
    newTargets = remapped;
  }

  // Remap host event participantId when present (presence transitions).
  let newHostEvent: MessageEvent['hostEvent'] = source.hostEvent ?? null;
  if (source.hostEvent && typeof source.hostEvent === 'object') {
    const remapped: NonNullable<MessageEvent['hostEvent']> = { ...source.hostEvent };
    if (source.hostEvent.participantId) {
      const mappedHostPid = participantMap.get(source.hostEvent.participantId);
      if (!mappedHostPid) {
        // The old presence event referred to a participant who isn't in the
        // new chat. Drop the message rather than dangling.
        return null;
      }
      remapped.participantId = mappedHostPid;
    }
    newHostEvent = remapped;
  }

  return {
    type: 'message',
    id: randomUUID(),
    role: source.role,
    content: source.content,
    attachments: source.attachments ?? [],
    createdAt: new Date().toISOString(),
    participantId: newParticipantId,
    swipeGroupId: source.swipeGroupId ?? null,
    swipeIndex: source.swipeIndex ?? null,
    systemSender: source.systemSender ?? null,
    systemKind: source.systemKind ?? null,
    hostEvent: newHostEvent,
    targetParticipantIds: newTargets,
    isSilentMessage: source.isSilentMessage ?? null,
    dangerFlags: source.dangerFlags ?? null,
    // Intentionally NOT copied:
    // - rawResponse, tokenCount, promptTokens, completionTokens
    //   (LLM-call telemetry, bound to the old chat's API spend)
    // - debugMemoryLogs, thoughtSignature, recoveryType, renderedHtml
    //   (per-message debug/recovery state that doesn't transfer)
    // - provider, modelName (the new chat may be on a different connection)
    // - summaryAnchor (compactionGeneration is bogus in the new chat — its
    //   summarisation lifecycle starts fresh)
  };
}

/**
 * Replicate turn state from source chat to new chat with participant ID
 * remapping. Persists the remapped state via repos.chats.update().
 */
async function replicateTurnState(
  newChatId: string,
  sourceChat: ChatMetadata,
  participantMap: Map<string, string>,
  repos: Repos,
): Promise<void> {
  const remapId = (oldId: string | null | undefined): string | null => {
    if (!oldId) return null;
    return participantMap.get(oldId) ?? null;
  };

  // Parse the source turn queue, remap, drop unknowns, re-stringify.
  let newTurnQueue = '[]';
  try {
    const parsed = JSON.parse(sourceChat.turnQueue || '[]');
    if (Array.isArray(parsed)) {
      const remapped = parsed
        .map((id) => (typeof id === 'string' ? participantMap.get(id) : undefined))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      newTurnQueue = JSON.stringify(remapped);
    }
  } catch (err) {
    logger.warn('[ChatContinuation] Failed to parse source turnQueue, defaulting to empty', {
      sourceChatId: sourceChat.id,
      newChatId,
      error: getErrorMessage(err),
    });
  }

  const newImpersonating = (sourceChat.impersonatingParticipantIds || [])
    .map((id) => participantMap.get(id))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const update: Partial<ChatMetadata> = {
    isPaused: sourceChat.isPaused ?? false,
    lastTurnParticipantId: remapId(sourceChat.lastTurnParticipantId),
    activeTypingParticipantId: remapId(sourceChat.activeTypingParticipantId),
    impersonatingParticipantIds: newImpersonating,
    allLLMPauseTurnCount: sourceChat.allLLMPauseTurnCount ?? 0,
    turnQueue: newTurnQueue,
  };

  logger.debug('[ChatContinuation] Replicating turn state', {
    newChatId,
    sourceChatId: sourceChat.id,
    isPaused: update.isPaused,
    lastTurnParticipantId: update.lastTurnParticipantId,
    activeTypingParticipantId: update.activeTypingParticipantId,
    impersonatingCount: newImpersonating.length,
    turnQueueLength: JSON.parse(newTurnQueue).length,
  });

  await repos.chats.update(newChatId, update);
}

/**
 * Backfill, turn-state replication, and cross-link bubbles. Call this from
 * the create handler after the init prelude and before the scenario-and-staff
 * phase, so the carryover lands between the system prompt and the new
 * chat's Host scenario whisper.
 */
export async function applyChatContinuation(
  params: ApplyChatContinuationParams,
): Promise<ApplyChatContinuationResult> {
  const { newChatId, sourceChatId, repos } = params;

  logger.debug('[ChatContinuation] Beginning continuation', {
    newChatId,
    sourceChatId,
  });

  const sourceChat = await repos.chats.findById(sourceChatId);
  if (!sourceChat) {
    logger.warn('[ChatContinuation] Source chat not found, skipping continuation', {
      newChatId,
      sourceChatId,
    });
    return { replayedMessageCount: 0, hadLibrarianSummary: false, postedSourceTailBubble: false };
  }

  const newChat = await repos.chats.findById(newChatId);
  if (!newChat) {
    logger.error('[ChatContinuation] New chat not found, aborting continuation', {
      newChatId,
      sourceChatId,
    });
    return { replayedMessageCount: 0, hadLibrarianSummary: false, postedSourceTailBubble: false };
  }

  const participantMap = buildParticipantIdMap(sourceChat.participants, newChat.participants);
  logger.debug('[ChatContinuation] Built participant map', {
    newChatId,
    sourceChatId,
    sourceParticipantCount: sourceChat.participants.length,
    newParticipantCount: newChat.participants.length,
    mappedCount: participantMap.size,
  });

  // 1. Post the Host link bubble in the new chat first, so the carryover
  //    appears beneath it.
  await postHostContinuationFromAnnouncement({
    chatId: newChatId,
    sourceChatId,
    sourceTitle: sourceChat.title ?? null,
  });

  // 2. Find the carryover anchor and replay messages.
  const sourceEvents = await repos.chats.getMessages(sourceChatId);
  const messageEvents = sourceEvents.filter((e): e is MessageEvent => e.type === 'message');
  const anchorIndex = findLibrarianSummaryAnchorIndex(messageEvents);
  const hadLibrarianSummary = anchorIndex >= 0;
  const carryover = anchorIndex >= 0 ? messageEvents.slice(anchorIndex) : messageEvents;

  logger.debug('[ChatContinuation] Carryover window resolved', {
    newChatId,
    sourceChatId,
    sourceMessageCount: messageEvents.length,
    hadLibrarianSummary,
    carryoverCount: carryover.length,
  });

  let replayedMessageCount = 0;
  for (const source of carryover) {
    const projected = projectMessageForNewChat(source, participantMap);
    if (!projected) continue;
    try {
      await repos.chats.addMessage(newChatId, projected);
      replayedMessageCount++;
    } catch (err) {
      logger.error('[ChatContinuation] Failed to replay carried message', {
        newChatId,
        sourceChatId,
        sourceMessageId: source.id,
        error: getErrorMessage(err),
      });
    }
  }

  logger.debug('[ChatContinuation] Replayed messages', {
    newChatId,
    sourceChatId,
    replayedMessageCount,
    skippedCount: carryover.length - replayedMessageCount,
  });

  // 3. Replicate turn state.
  try {
    await replicateTurnState(newChatId, sourceChat, participantMap, repos);
  } catch (err) {
    logger.error('[ChatContinuation] Failed to replicate turn state', {
      newChatId,
      sourceChatId,
      error: getErrorMessage(err),
    });
  }

  // 4. Tail bubble in the source chat — last so we never link to a chat we
  //    failed to populate.
  let postedSourceTailBubble = false;
  try {
    const tail = await postHostContinuationToAnnouncement({
      chatId: sourceChatId,
      newChatId,
      newTitle: newChat.title ?? null,
    });
    postedSourceTailBubble = tail !== null;
  } catch (err) {
    logger.error('[ChatContinuation] Failed to post source-chat tail bubble', {
      newChatId,
      sourceChatId,
      error: getErrorMessage(err),
    });
  }

  logger.info('[ChatContinuation] Continuation complete', {
    newChatId,
    sourceChatId,
    replayedMessageCount,
    hadLibrarianSummary,
    postedSourceTailBubble,
  });

  return { replayedMessageCount, hadLibrarianSummary, postedSourceTailBubble };
}
