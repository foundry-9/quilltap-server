/**
 * Fresh message ids for a chat imported under a fresh chat id.
 *
 * `chat_messages.id` is a global primary key, not a per-chat one. A chat the
 * importer creates under a new id (the `duplicate` conflict strategy, or any
 * import without `preserveIds`) therefore cannot reuse its bundle's message
 * ids whenever those messages may already exist — the original chat beside
 * its duplicate, or a second import of the same bundle (bug 199). So every
 * message is reminted, and every reference *to* a message inside the chat
 * row or the message rows follows it through one old → new map:
 *
 * - `message.swipeGroupId` — `swipe-<messageId>` (regenerate-swipe) or a bare
 *   message id; anything else (SillyTavern's `swipe-<index>`) is an opaque,
 *   per-chat grouping key and is kept.
 * - `chat.summaryAnchorMessageIds` — anchors with no message in the bundle are
 *   dropped (they would name nothing in the new chat).
 * - `chat.otherExtractionWatermarkMessageId` — nulled when unresolvable, which
 *   simply lets the next fold-grain pass catch up.
 * - `chat.courierCheckpoints[*].lastResolvedMessageId` — a checkpoint whose
 *   message is gone is dropped, so the next Courier turn sends full context.
 *
 * Sidecars outside the chat row (informs, annotations, memories, file links)
 * read the returned map via `idMaps.messages`.
 *
 * @module import/quilltap-import/message-id-remap
 */

import { randomUUID } from 'crypto';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';

const SWIPE_PREFIX = 'swipe-';

/** The chat-row fields that name messages, rewritten for the new ids. */
export type ChatMessageRefPatch = Partial<
  Pick<ChatMetadata, 'summaryAnchorMessageIds' | 'otherExtractionWatermarkMessageId' | 'courierCheckpoints'>
>;

export interface RemintedChatMessages {
  /** The bundle's messages, each under a fresh id. Order is preserved. */
  messages: MessageEvent[];
  /** Chat-row fields to spread over the chat before `create`. Only fields present on the source chat appear. */
  chatPatch: ChatMessageRefPatch;
  /** Source message id → new message id. */
  idMap: Map<string, string>;
  /** References that named no message in the bundle and were dropped or nulled. */
  droppedRefs: number;
}

function remapSwipeGroupId(groupId: string, idMap: ReadonlyMap<string, string>): string {
  const bare = idMap.get(groupId);
  if (bare) return bare;
  if (groupId.startsWith(SWIPE_PREFIX)) {
    const mapped = idMap.get(groupId.slice(SWIPE_PREFIX.length));
    if (mapped) return `${SWIPE_PREFIX}${mapped}`;
  }
  return groupId;
}

/**
 * Remint a chat's message ids and rewrite the chat's own message references.
 * Pure: mints ids with `mintId` (default `randomUUID`) and never touches the
 * database.
 */
export function remintChatMessageIds(
  chat: Partial<Pick<ChatMetadata, 'summaryAnchorMessageIds' | 'otherExtractionWatermarkMessageId' | 'courierCheckpoints'>>,
  messages: MessageEvent[],
  mintId: () => string = randomUUID
): RemintedChatMessages {
  const idMap = new Map<string, string>();
  for (const message of messages) {
    if (message.id && !idMap.has(message.id)) idMap.set(message.id, mintId());
  }

  let droppedRefs = 0;

  const reminted = messages.map((message) => ({
    ...message,
    id: idMap.get(message.id) ?? mintId(),
    ...(message.swipeGroupId ? { swipeGroupId: remapSwipeGroupId(message.swipeGroupId, idMap) } : {}),
  }));

  const chatPatch: ChatMessageRefPatch = {};

  if (Array.isArray(chat.summaryAnchorMessageIds)) {
    const anchors: string[] = [];
    for (const id of chat.summaryAnchorMessageIds) {
      const mapped = idMap.get(id);
      if (mapped) anchors.push(mapped);
      else droppedRefs++;
    }
    chatPatch.summaryAnchorMessageIds = anchors;
  }

  if (chat.otherExtractionWatermarkMessageId) {
    const mapped = idMap.get(chat.otherExtractionWatermarkMessageId) ?? null;
    if (!mapped) droppedRefs++;
    chatPatch.otherExtractionWatermarkMessageId = mapped;
  }

  const checkpoints = chat.courierCheckpoints;
  if (checkpoints && typeof checkpoints === 'object' && !Array.isArray(checkpoints)) {
    const next: Record<string, unknown> = {};
    for (const [characterId, checkpoint] of Object.entries(checkpoints as Record<string, unknown>)) {
      const lastId =
        checkpoint && typeof checkpoint === 'object'
          ? (checkpoint as { lastResolvedMessageId?: unknown }).lastResolvedMessageId
          : undefined;
      const mapped = typeof lastId === 'string' ? idMap.get(lastId) : undefined;
      if (!mapped) {
        droppedRefs++;
        continue;
      }
      next[characterId] = { ...(checkpoint as Record<string, unknown>), lastResolvedMessageId: mapped };
    }
    chatPatch.courierCheckpoints = Object.keys(next).length > 0 ? next : null;
  }

  return { messages: reminted, chatPatch, idMap, droppedRefs };
}
