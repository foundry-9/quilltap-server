/**
 * Established Fact Memories Job Handler
 *
 * A machine-delivered established fact (the Salon's Deus Ex Machina tab) is a
 * Host row with no speaker: there is nothing for LLM extraction to interpret,
 * and every Staff row is skipped by it anyway. So each one is admitted
 * deterministically, verbatim, as one MANUAL memory per LLM seat that is not
 * removed — absent and silent seats included, because everybody knows it.
 *
 * `source: 'MANUAL'` because the operator wrote it: it never folds into an
 * extracted row, and a chat wipe (`retireChatMemories`, `keep: 'manual'`)
 * spares it. Admission runs in the parent over the `admitMemory` host-RPC, as
 * for every memory a job forms; its own dedup handles a repeat. One seat's
 * failure (a missing character, an embedding failure) is a `warn` and never
 * stops the others.
 *
 * Design of record: docs/developer/features/deus-ex-machina.md.
 */

import { type BackgroundJob, type MessageEvent } from '@/lib/schemas/types';
import { admitCandidate } from '@/lib/memory/admission';
import { MemoryCandidateSchema, type MemoryCandidateInput } from '@/lib/memory/candidate';
import { isEstablishedFactAnnouncement } from '@/lib/chat/established-fact';
import { getRepositories } from '@/lib/repositories/factory';
import { getErrorMessage } from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import type { EstablishedFactMemoriesPayload } from '../queue-service';

/** Importance of an established-fact memory: settled truth the operator vouched for. */
export const ESTABLISHED_FACT_MEMORY_IMPORTANCE = 0.8;

/** The candidate a seat's character admits for one fact. Exported for tests. */
export function establishedFactCandidate(input: {
  fact: string;
  holderId: string;
  chatId: string;
  projectId: string | null;
  messageId: string;
  createdAt?: string | null;
}): MemoryCandidateInput {
  const anchor = input.createdAt ? Date.parse(input.createdAt) : NaN;
  return {
    content: input.fact,
    summary: input.fact,
    keywords: [],
    targeting: { temporal: 'present', scope: 'wide', context: 'information' },
    importance: ESTABLISHED_FACT_MEMORY_IMPORTANCE,
    kind: 'semantic',
    when: null,
    entities: [],
    tags: [],
    subject: { holderId: input.holderId, aboutId: null },
    provenance: {
      source: 'MANUAL',
      witnessedContext: 'manual',
      chatId: input.chatId,
      projectId: input.projectId,
      sourceMessageId: input.messageId,
      anchorTimeMs: Number.isFinite(anchor) ? anchor : Date.now(),
      pass: 'established-fact',
    },
  };
}

export async function handleEstablishedFactMemories(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EstablishedFactMemoriesPayload;
  const repos = getRepositories();

  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[EstablishedFactMemories] Chat not found; skipping', { jobId: job.id, chatId: payload.chatId });
    return;
  }

  const messages = await repos.chats.getMessages(payload.chatId);
  const message = messages.find(
    (m): m is MessageEvent => m.type === 'message' && m.id === payload.messageId,
  );
  if (!message || !isEstablishedFactAnnouncement(message)) {
    // Deleted before the job ran, or not a fact row at all: nothing to know.
    logger.warn('[EstablishedFactMemories] Fact message not found; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      messageId: payload.messageId,
    });
    return;
  }
  const fact = message.content.trim();
  if (!fact) return;

  // Every LLM seat that is not removed. Absent and silent seats know it too;
  // a user-controlled seat is the operator's, and forms no memory here.
  const seats = chat.participants.filter(
    p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.status !== 'removed' && !!p.characterId,
  );

  let admitted = 0;
  let notAdmitted = 0;
  for (const seat of seats) {
    const characterId = seat.characterId as string;
    try {
      const character = await repos.characters.findByIdRaw(characterId);
      if (!character || character.archivedAt) {
        notAdmitted++;
        logger.warn('[EstablishedFactMemories] Seat character missing or archived; skipping seat', {
          jobId: job.id,
          chatId: payload.chatId,
          participantId: seat.id,
          characterId,
        });
        continue;
      }

      const candidate = MemoryCandidateSchema.parse(establishedFactCandidate({
        fact,
        holderId: characterId,
        chatId: payload.chatId,
        projectId: chat.projectId ?? null,
        messageId: message.id,
        createdAt: message.createdAt,
      }));
      const outcome = await admitCandidate(candidate, { occurredAt: null, narrativeTime: null }, { userId: job.userId });

      if (outcome.memory) {
        admitted++;
        logger.debug('[EstablishedFactMemories] Seat admitted the fact', {
          jobId: job.id,
          chatId: payload.chatId,
          participantId: seat.id,
          characterId,
          memoryId: outcome.memory.id,
          action: outcome.action.kind,
        });
      } else {
        notAdmitted++;
        logger.warn('[EstablishedFactMemories] Seat did not admit the fact', {
          jobId: job.id,
          chatId: payload.chatId,
          participantId: seat.id,
          characterId,
          reason: outcome.action.kind === 'reject' ? outcome.action.reason : outcome.action.kind,
        });
      }
    } catch (error) {
      notAdmitted++;
      logger.warn('[EstablishedFactMemories] Admission failed for a seat; continuing', {
        jobId: job.id,
        chatId: payload.chatId,
        participantId: seat.id,
        characterId,
        error: getErrorMessage(error),
      });
    }
  }

  logger.info('[EstablishedFactMemories] Established fact admitted to the cast', {
    jobId: job.id,
    chatId: payload.chatId,
    messageId: message.id,
    seats: seats.length,
    admitted,
    notAdmitted,
  });
}
