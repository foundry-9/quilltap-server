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
 * The fields come from the id-field table (`lib/backup/id-fields.ts`), shared
 * with backup restore:
 *
 * - `message.swipeGroupId` — `swipe-<messageId>` (what regenerate-swipe
 *   writes) is rewritten; any other key (SillyTavern's `swipe-<index>`) is an
 *   opaque, per-chat grouping key and is kept.
 * - `chat.summaryAnchorMessageIds` — an anchor naming no message in the
 *   bundle is dropped from the array (decision §8.2 of the 4.13 import/restore
 *   spec); the anchors that landed are kept.
 * - `chat.otherExtractionWatermarkMessageId` /
 *   `chat.episodeExtractionWatermarkMessageId` /
 *   `chat.turnExtractionWatermarkMessageId` (the bundle's carriage of the
 *   extraction cursors) — nulled when unresolvable, which simply lets the
 *   next pass catch up (a reopened turn then reads from its opener).
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
import { BUNDLE_CURSOR_FIELDS, type BundleCursorFields } from '@/lib/memory/extraction/cursor-bundle';
import { remapEntity, type IdResolver, type IdTarget } from '@/lib/backup/id-fields';

const MESSAGE_TARGETS: ReadonlySet<IdTarget> = new Set<IdTarget>(['message']);

type MessageRefFields =
  | 'summaryAnchorMessageIds'
  | 'courierCheckpoints';

/**
 * The chat-row fields that name messages, rewritten for the new ids — plus the
 * fold passes' cursors, which a bundle carries on the chat under their legacy
 * field names (`lib/memory/extraction/cursor-bundle.ts`).
 */
export type ChatMessageRefPatch = Partial<Pick<ChatMetadata, MessageRefFields>> & BundleCursorFields;

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
  chat: Partial<Pick<ChatMetadata, MessageRefFields>> & BundleCursorFields,
  messages: MessageEvent[],
  mintId: () => string = randomUUID
): RemintedChatMessages {
  const idMap = new Map<string, string>();
  const newIds = messages.map((message) => {
    const newId = mintId();
    if (message.id && !idMap.has(message.id)) idMap.set(message.id, newId);
    return newId;
  });

  // Every reference to a message follows it through the id-field table
  // (`lib/backup/id-fields.ts`): `swipe-<id>` keys, summary anchors and the
  // fold cursors. Only message targets are rewritten here.
  const resolveMessage: IdResolver = (target, id) => (target === 'message' ? idMap.get(id) : undefined);
  const messageTargets = { side: 'import' as const, targets: MESSAGE_TARGETS };

  const reminted = messages.map((message, index) => ({
    ...(remapEntity('message', message, resolveMessage, messageTargets).row as MessageEvent),
    id: newIds[index],
  }));

  const chatPatch: ChatMessageRefPatch = {};
  const remappedChat = remapEntity('chat', chat as Record<string, unknown>, resolveMessage, messageTargets);
  let droppedRefs = remappedChat.unresolved.length;
  // Decision §8.2: an anchor naming no message is dropped from the array; the
  // summary keeps the anchors that did land.
  if (Array.isArray(chat.summaryAnchorMessageIds) && remappedChat.row) {
    chatPatch.summaryAnchorMessageIds = (remappedChat.row as typeof chat).summaryAnchorMessageIds;
  }
  for (const field of Object.values(BUNDLE_CURSOR_FIELDS)) {
    if (!chat[field]) continue;
    chatPatch[field] = ((remappedChat.row as BundleCursorFields | null)?.[field] ?? null) as never;
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

  return { messages: reminted, chatPatch, idMap, droppedRefs };
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
