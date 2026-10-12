/**
 * Fresh message ids for a chat imported under a fresh chat id.
 *
 * `chat_messages.id` is a global primary key, not a per-chat one. A chat the
 * importer creates under a new id (the `duplicate` conflict strategy, or any
 * import without `preserveIds`) therefore cannot reuse its bundle's message
 * ids whenever those messages may already exist — the original chat beside
 * its duplicate, or a second import of the same bundle (bug 228). So every
 * message is reminted, and every reference *to* a message inside the chat
 * row or the message rows follows it through one old → new map:
 *
 * - `message.swipeGroupId` — `swipe-<messageId>` (what regenerate-swipe
 *   writes) is rewritten; any other key (SillyTavern's `swipe-<index>`) is an
 *   opaque, per-chat grouping key and is kept.
 * - `chat.summaryAnchorMessageIds` — if any anchor names no message in the
 *   bundle, the running summary is cleared with its anchors and fold cursor,
 *   exactly as `?action=rebuild-summary` does, so the ordinary cadence
 *   refolds rather than trusting a summary with a partial anchor set.
 * - `chat.otherExtractionWatermarkMessageId` /
 *   `chat.episodeExtractionWatermarkMessageId` — nulled when unresolvable,
 *   which simply lets the next fold-grain pass catch up.
 * - `chat.courierCheckpoints[*].lastResolvedMessageId` — a checkpoint whose
 *   message is gone (or that cannot be read) is dropped, so the next Courier
 *   turn sends full context.
 *
 * Sidecars outside the chat row (informs, annotations, memories, file links)
 * resolve through {@link remapImportedMessageId}, keyed by their source chat.
 *
 * @module import/quilltap-import/message-id-remap
 */

import { randomUUID } from 'crypto';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';
import type { IdMappingState } from './types';

const SWIPE_PREFIX = 'swipe-';

type MessageRefFields =
  | 'summaryAnchorMessageIds'
  | 'otherExtractionWatermarkMessageId'
  | 'episodeExtractionWatermarkMessageId'
  | 'courierCheckpoints'
  | 'contextSummary'
  | 'lastSummaryTurn';

/** The chat-row fields that name messages, rewritten for the new ids. */
export type ChatMessageRefPatch = Partial<Pick<ChatMetadata, MessageRefFields>>;

export interface RemintedChatMessages {
  /** The bundle's messages, each under a fresh id. Order is preserved. */
  messages: MessageEvent[];
  /** Chat-row fields to spread over the chat before `create`. Only fields present on the source chat appear. */
  chatPatch: ChatMessageRefPatch;
  /**
   * Source message id → new message id, for remapping references. A source id
   * that occurs twice in one bundle chat maps to its first occurrence; every
   * occurrence still gets its own new id in `messages`.
   */
  idMap: Map<string, string>;
  /** Message references in the chat row that named no message in the bundle. */
  droppedRefs: number;
  /** Whether the running summary was cleared because an anchor did not resolve. */
  summaryCleared: boolean;
}

function remapSwipeGroupId(groupId: string, idMap: ReadonlyMap<string, string>): string {
  if (!groupId.startsWith(SWIPE_PREFIX)) return groupId;
  const mapped = idMap.get(groupId.slice(SWIPE_PREFIX.length));
  return mapped ? `${SWIPE_PREFIX}${mapped}` : groupId;
}

/** A bundle may carry a JSON column as its serialized string; read either. */
function readJsonObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Remint a chat's message ids and rewrite the chat's own message references.
 * Pure: mints ids with `mintId` (default `randomUUID`) and never touches the
 * database.
 */
export function remintChatMessageIds(
  chat: Partial<Pick<ChatMetadata, MessageRefFields>>,
  messages: MessageEvent[],
  mintId: () => string = randomUUID
): RemintedChatMessages {
  const idMap = new Map<string, string>();
  const newIds = messages.map((message) => {
    const newId = mintId();
    if (message.id && !idMap.has(message.id)) idMap.set(message.id, newId);
    return newId;
  });

  const reminted = messages.map((message, index) => ({
    ...message,
    id: newIds[index],
    ...(message.swipeGroupId ? { swipeGroupId: remapSwipeGroupId(message.swipeGroupId, idMap) } : {}),
  }));

  const chatPatch: ChatMessageRefPatch = {};
  let droppedRefs = 0;
  let summaryCleared = false;

  if (Array.isArray(chat.summaryAnchorMessageIds)) {
    const anchors = chat.summaryAnchorMessageIds.map((id) => idMap.get(id));
    const unresolved = anchors.filter((id) => !id).length;
    if (unresolved > 0) {
      droppedRefs += unresolved;
      summaryCleared = true;
      chatPatch.contextSummary = null;
      chatPatch.summaryAnchorMessageIds = [];
      chatPatch.lastSummaryTurn = 0;
    } else {
      chatPatch.summaryAnchorMessageIds = anchors as string[];
    }
  }

  for (const field of ['otherExtractionWatermarkMessageId', 'episodeExtractionWatermarkMessageId'] as const) {
    const watermark = chat[field];
    if (!watermark) continue;
    const mapped = idMap.get(watermark) ?? null;
    if (!mapped) droppedRefs++;
    chatPatch[field] = mapped;
  }

  if (chat.courierCheckpoints != null) {
    const checkpoints = readJsonObject(chat.courierCheckpoints);
    const next: Record<string, unknown> = {};
    for (const [characterId, raw] of Object.entries(checkpoints ?? {})) {
      const checkpoint = readJsonObject(raw);
      const lastId = checkpoint?.lastResolvedMessageId;
      const mapped = typeof lastId === 'string' ? idMap.get(lastId) : undefined;
      if (!checkpoint || !mapped) {
        droppedRefs++;
        continue;
      }
      next[characterId] = { ...checkpoint, lastResolvedMessageId: mapped };
    }
    if (!checkpoints) droppedRefs++;
    chatPatch.courierCheckpoints = Object.keys(next).length > 0 ? next : null;
  }

  return { messages: reminted, chatPatch, idMap, droppedRefs, summaryCleared };
}

/**
 * Resolve a sidecar's message reference against the chat it belongs to.
 *
 * - The source chat was not reminted (kept its ids, was skipped, or is not in
 *   this import): the id is returned unchanged.
 * - The source chat was reminted and the message landed: its new id.
 * - The source chat was reminted and the message did not land (absent from
 *   the bundle, or its insert failed): `null` — there is nothing to point at.
 */
export function remapImportedMessageId(
  idMaps: Pick<IdMappingState, 'messages'>,
  sourceChatId: string | null | undefined,
  messageId: string
): string | null {
  const chatMap = sourceChatId ? idMaps.messages.get(sourceChatId) : undefined;
  if (!chatMap) return messageId;
  return chatMap.get(messageId) ?? null;
}
