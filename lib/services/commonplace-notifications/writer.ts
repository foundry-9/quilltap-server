/**
 * Writer for Commonplace Book chat whispers.
 *
 * The Commonplace Book is the personified memory system. When a character is
 * about to take a turn, what they "remember" — narrative recap, relevant
 * memories, inter-character memories — used to be spliced into the system
 * prompt. We now hand that material to the Commonplace Book to whisper into
 * the conversation as a targeted ASSISTANT-role message that only the
 * responding character can see.
 *
 * Targeting is via `targetParticipantIds`: a single participant ID = private
 * to that character + sender. `null` would be public, but Commonplace Book
 * whispers are always private — they're recall, not announcement.
 *
 * Errors never propagate — turn processing must never fail because a memory
 * whisper couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { MessageEvent } from '@/lib/schemas/types';

export type CommonplaceWhisperKind =
  | 'memory-recap'
  | 'relevant-memories'
  | 'inter-character-memories'
  | 'consolidated';

/**
 * Memory content parts for a single turn's recall. Each section is the raw
 * formatted text computed by the memory injector (with its existing markdown
 * headers like `## Relevant Memories`).
 */
export interface CommonplaceParts {
  /** Narrative recap of what the character remembers (chat start / character join only). */
  recap?: string;
  /** Semantic-search results that bear on the current moment. */
  relevant?: string;
  /** Memories about other present characters (multi-character chats only). */
  interChar?: string;
}

/**
 * Build the persona-voiced consolidated whisper for the chat transcript / UI.
 * The Commonplace Book speaks once, bundling whichever sections are non-empty.
 */
export function buildCommonplacePersonaWhisper(parts: CommonplaceParts): string {
  const sections: string[] = [];
  const recap = parts.recap?.trim();
  const relevant = parts.relevant?.trim();
  const interChar = parts.interChar?.trim();

  if (recap) {
    sections.push(
      `*The Commonplace Book lays open at your bookmark; here is the gist of what you have noted so far —*\n\n${recap}`,
    );
  }
  if (relevant) {
    sections.push(
      `*The Commonplace Book turns to the entries that bear on this moment.*\n\n${relevant}`,
    );
  }
  if (interChar) {
    sections.push(
      `*The Commonplace Book opens to the pages where you have noted those present.*\n\n${interChar}`,
    );
  }
  return sections.join('\n\n').trim();
}

/**
 * Build the plain second-person framing for the LLM context. No Staff persona
 * — just direct "you remember" prompts so the model receives recall as a
 * clean instruction rather than a meta-narrative.
 */
export function buildCommonplaceLLMContext(parts: CommonplaceParts): string {
  const sections: string[] = [];
  const recap = parts.recap?.trim();
  const relevant = parts.relevant?.trim();
  const interChar = parts.interChar?.trim();

  if (recap) {
    sections.push(`You remember the gist of what has happened so far:\n\n${recap}`);
  }
  if (relevant) {
    sections.push(`You remember the following entries that bear on this moment:\n\n${relevant}`);
  }
  if (interChar) {
    sections.push(`You also recall about the others present:\n\n${interChar}`);
  }
  return sections.join('\n\n').trim();
}

/**
 * @deprecated Kept temporarily during the Phase B revision. Prefer
 * `buildCommonplacePersonaWhisper` for UI persistence and
 * `buildCommonplaceLLMContext` for the LLM call.
 */
export function voiceCommonplaceContent(
  kind: 'memory-recap' | 'relevant-memories' | 'inter-character-memories',
  body: string,
): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return '';
  switch (kind) {
    case 'memory-recap':
      return buildCommonplacePersonaWhisper({ recap: trimmed });
    case 'relevant-memories':
      return buildCommonplacePersonaWhisper({ relevant: trimmed });
    case 'inter-character-memories':
      return buildCommonplacePersonaWhisper({ interChar: trimmed });
  }
}

interface PostParams {
  chatId: string;
  /** Participant ID of the character this whisper is targeted at, if any. Null/undefined = public. */
  targetParticipantId?: string | null;
  /** Pre-formatted body text. The persona voicing is the caller's responsibility. */
  content: string;
  kind: CommonplaceWhisperKind;
}

export async function postCommonplaceWhisper(
  params: PostParams,
): Promise<MessageEvent | null> {
  const { chatId, targetParticipantId, content, kind } = params;

  if (!content || content.trim().length === 0) {
    logger.debug('[CommonplaceWhisper] Empty content, skipping', {
      context: 'commonplace-notifications',
      chatId,
      kind,
    });
    return null;
  }

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[CommonplaceWhisper] Chat not found, skipping', {
        context: 'commonplace-notifications',
        chatId,
        kind,
      });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'commonplaceBook',
      systemKind: kind,
      targetParticipantIds: targetParticipantId ? [targetParticipantId] : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[CommonplaceWhisper] Whisper posted', {
      context: 'commonplace-notifications',
      chatId,
      messageId,
      kind,
      targetParticipantId,
      contentLength: content.length,
    });

    return message;
  } catch (error) {
    logger.error('[CommonplaceWhisper] Failed to post whisper', {
      context: 'commonplace-notifications',
      chatId,
      kind,
      targetParticipantId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
