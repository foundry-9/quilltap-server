/**
 * Writer for Carina (inline LLM query) reference answers.
 *
 * A Carina answer is posted as an ASSISTANT message tagged
 * `systemSender: 'carina'` / `systemKind: 'carina-response'`. The
 * `systemSender` tag keeps it out of per-turn memory extraction (see
 * `buildTurnTranscript`, which skips any `systemSender` message), and the
 * `carinaMeta.answererId` lets the Salon render the message with the answerer
 * character's OWN avatar — there is no dedicated Carina staff avatar.
 *
 * Errors never propagate — a failure to post the answer is logged and surfaced
 * to the caller as a null id rather than thrown.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

export interface PostCarinaResponseParams {
  chatId: string;
  /** The answerer's reply text. */
  answer: string;
  /** Resolved answerer character id (drives avatar resolution + continuity). */
  answererId: string;
  /** The verbatim question that was asked (stored for follow-up continuity). */
  question: string;
  /** Answerer's participant id when they are a participant in this chat; else null. */
  participantId: string | null;
  /** True when the original query used `?` (whisper to the asker only). */
  whisper: boolean;
  /** Participant id of the asker — the whisper target when `whisper` is true. */
  askerParticipantId: string | null;
}

/**
 * Persist a Carina reference answer. Returns the posted message (so callers can
 * splice it into the current turn's in-memory context), or null on failure
 * (logged, never thrown).
 */
export async function postCarinaResponse(
  params: PostCarinaResponseParams,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const targetParticipantIds =
      params.whisper && params.askerParticipantId ? [params.askerParticipantId] : null;

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: params.answer,
      // The answer carries no Carina-persona framing, so the opaque body is the
      // same text — opaque characters see the reference answer verbatim.
      opaqueContent: params.answer,
      attachments: [],
      createdAt: now,
      participantId: params.participantId,
      systemSender: 'carina',
      systemKind: 'carina-response',
      targetParticipantIds,
      carinaMeta: { answererId: params.answererId, question: params.question },
    };

    await repos.chats.addMessage(params.chatId, message);

    logger.info('[Carina] Reference answer posted', {
      context: 'carina',
      chatId: params.chatId,
      messageId,
      answererId: params.answererId,
      whispered: Boolean(targetParticipantIds),
    });

    return message;
  } catch (error) {
    logger.error('[Carina] Failed to post reference answer', {
      context: 'carina',
      chatId: params.chatId,
      answererId: params.answererId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
