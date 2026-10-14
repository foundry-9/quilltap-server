/**
 * Writer for ad-hoc announcement bubbles (Insert Announcement composer button).
 *
 * The operator may post a public bubble authored by:
 *   - a Staff member (canonical avatar + name),
 *   - a workspace character not currently in this chat, or
 *   - a free-text custom display name (placeholder avatar).
 *
 * By default the result is persisted to chat_messages as a broadcast
 * (`targetParticipantIds = null`), indistinguishable in behaviour from an automated
 * Staff announcement: visible to all participants (present and silent), and included
 * verbatim in every character's LLM transcript via normal message history.
 *
 * When the operator names an audience, the same bubble is persisted as a *whisper* —
 * `targetParticipantIds` carries the chosen participant ids and the ordinary whisper
 * machinery takes over: only those participants' LLM contexts include it
 * (`filterWhisperMessages`), and the Salon shows it to the operator with the usual
 * whisper chrome. Callers must have already verified that every id is a current
 * participant of this chat.
 *
 * `postInformRecord` (below) shares the shape but not the purpose: it writes the
 * operator-facing *record* of an Inform. That record is stripped from every
 * model's context — the inform itself is delivered as its own system block on
 * the prompt path — so it carries no framing at all.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

export type StaffSender =
  | 'lantern'
  | 'aurora'
  | 'librarian'
  | 'concierge'
  | 'prospero'
  | 'host'
  | 'commonplaceBook'
  | 'ariel'
  | 'suparna'
  | 'pascal';

export type AnnouncerSender =
  | { kind: 'staff'; staffId: StaffSender }
  | { kind: 'character'; characterId: string }
  | { kind: 'custom'; displayName: string };

export interface AdhocAnnouncementParams {
  chatId: string;
  /** Plain Markdown body of the announcement bubble. */
  contentMarkdown: string;
  sender: AnnouncerSender;
  /**
   * Participant ids the announcement is whispered to. Null / empty posts a
   * public broadcast (the historical behaviour). Every id must already have
   * been verified as a current participant of this chat by the caller.
   */
  targetParticipantIds?: string[] | null;
}

/**
 * Post a user-authored announcement bubble. Returns the persisted message
 * (so callers can also surface it to the current turn's LLM context without
 * a one-turn lag), or null on failure / when content is empty.
 *
 * Errors never propagate — this matches the established Staff-announcer
 * convention (Host, Librarian, Lantern) and avoids tearing the composer UX
 * over a transient repo failure.
 */
export async function postAdhocAnnouncement(
  params: AdhocAnnouncementParams,
): Promise<MessageEvent | null> {
  const trimmed = params.contentMarkdown?.trim() ?? '';
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(params.chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    // Normalize an empty audience to null so "public" has exactly one
    // representation on the row — every whisper check downstream tests for a
    // non-empty array, and a stored `[]` would read as "whispered to nobody".
    const targets = params.targetParticipantIds?.length ? [...params.targetParticipantIds] : null;

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: trimmed,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemKind: 'announcement',
      targetParticipantIds: targets,
      systemSender: params.sender.kind === 'staff' ? params.sender.staffId : null,
      customAnnouncer:
        params.sender.kind === 'character'
          ? { kind: 'character', characterId: params.sender.characterId }
          : params.sender.kind === 'custom'
            ? { kind: 'custom', displayName: params.sender.displayName }
            : null,
    };

    await repos.chats.addMessage(params.chatId, message);

    logger.info('[Announcer] Ad-hoc announcement posted', {
      context: 'announcer',
      chatId: params.chatId,
      messageId,
      senderKind: params.sender.kind,
      audience: targets ? 'whisper' : 'public',
      targetCount: targets?.length ?? 0,
      staffId: params.sender.kind === 'staff' ? params.sender.staffId : undefined,
      characterId: params.sender.kind === 'character' ? params.sender.characterId : undefined,
      displayName: params.sender.kind === 'custom' ? params.sender.displayName : undefined,
    });

    return message;
  } catch (error) {
    logger.error('[Announcer] Failed to post ad-hoc announcement', {
      context: 'announcer',
      chatId: params.chatId,
      senderKind: params.sender.kind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export interface InformRecordParams {
  chatId: string;
  /** Exactly what the operator typed. Persisted verbatim (trimmed only). */
  contentMarkdown: string;
  /**
   * Chat participant ids the record is whispered to, or null when the batch
   * covered every eligible seat (a public record). Callers must have already
   * verified every id against the chat's current participants.
   */
  targetParticipantIds: string[] | null;
}

/**
 * Post the transcript **record** for an Inform.
 *
 * This message documents the post for the operator; it is never delivered to a
 * model (the inform itself arrives as its own system block, built on the prompt
 * path). So there is deliberately no framing here: no "The Host informs the
 * company", no preamble, no persona voicing — the body is what was typed and
 * nothing else. `opaqueContent` mirrors `content` for exactly that reason: the
 * dual-body convention is honoured, and there is simply no persona to strip.
 *
 * Public when `targetParticipantIds` is null, whispered to the named seats
 * otherwise — the same distinction an ad-hoc announcement draws.
 *
 * Returns the persisted message, or null on empty content / unknown chat /
 * failure. Errors never propagate: the established Staff-announcer convention,
 * and a lost record must not cost the operator the batch itself.
 */
export async function postInformRecord(
  params: InformRecordParams,
): Promise<MessageEvent | null> {
  const trimmed = params.contentMarkdown?.trim() ?? '';
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(params.chatId);
    if (!chat) {
      logger.warn('[Announcer] Inform record skipped — unknown chat', {
        context: 'announcer',
        chatId: params.chatId,
      });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    // Same normalization as the ad-hoc announcer: "public" has exactly one
    // representation on the row, because a stored `[]` reads as "whispered to
    // nobody" to every downstream whisper check.
    const targets = params.targetParticipantIds?.length ? [...params.targetParticipantIds] : null;

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: trimmed,
      opaqueContent: trimmed,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'host',
      systemKind: 'inform',
      targetParticipantIds: targets,
      customAnnouncer: null,
    };

    await repos.chats.addMessage(params.chatId, message);

    logger.debug('[Announcer] Inform record posted', {
      context: 'announcer',
      chatId: params.chatId,
      messageId,
      audience: targets ? 'whisper' : 'public',
      targetCount: targets?.length ?? 0,
    });

    return message;
  } catch (error) {
    logger.error('[Announcer] Failed to post inform record', {
      context: 'announcer',
      chatId: params.chatId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
