/**
 * Carina Memory Extraction Job Handler
 *
 * Forms memories for a Carina answerer from a single isolated reference Q&A.
 *
 * A Carina answer is posted as a `systemSender: 'carina'` message, which the
 * per-turn transcript builder deliberately skips (every systemSender message is
 * excluded) — and the answerer is frequently not even a participant in the
 * chat. So the ordinary MEMORY_EXTRACTION path never sees it. This handler is
 * the dedicated route: one extraction context (the answerer hydrated beside the
 * chat's cast, the chat's project and summary as background, bug 222) and the
 * `self-turn` pass over the answer's own one-slice transcript
 * (`runCarinaExtraction`), with the `carina` provenance. Only SELF memories
 * form — the answerer remembers what it was asked and what it answered,
 * nothing about the asker.
 */

import { BackgroundJob, type MessageEvent } from '@/lib/schemas/types';
import { runCarinaExtraction } from '@/lib/memory/extraction';
import { logger } from '@/lib/logger';
import type { CarinaMemoryExtractionPayload } from '../queue-service';
import { extractionContextForJob, finishExtractionJob } from './memory-extraction';

export async function handleCarinaMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CarinaMemoryExtractionPayload;
  const ctx = await extractionContextForJob(job, payload.chatId, payload.connectionProfileId, {
    extraCharacterIds: [payload.answererId],
  });
  if (!ctx) return;

  if (!ctx.cast.has(payload.answererId)) {
    logger.warn('[CarinaMemoryExtraction] Answerer character not found; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      answererId: payload.answererId,
    });
    return;
  }

  const carinaMessage = (await ctx.messages()).find((m): m is MessageEvent => m.id === payload.carinaMessageId);
  if (!carinaMessage) {
    logger.warn('[CarinaMemoryExtraction] Carina message not found; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      carinaMessageId: payload.carinaMessageId,
    });
    return;
  }

  const result = await runCarinaExtraction(ctx, carinaMessage, payload.answererId);
  if (!result) {
    logger.info('[CarinaMemoryExtraction] Carina message has no answer text; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      carinaMessageId: payload.carinaMessageId,
    });
    return;
  }

  logger.info('[CarinaMemoryExtraction] Reference answer processed', {
    jobId: job.id,
    chatId: payload.chatId,
    carinaMessageId: carinaMessage.id,
    answererId: payload.answererId,
    projectId: ctx.project.id,
    created: result.createdIds.length,
    reinforced: result.reinforcedIds.length,
  });
  // The debug lines go on the carina message itself.
  await finishExtractionJob(job, ctx, result, {
    taskLabel: 'carina-memory-extraction',
    debugMessageId: result.sourceMessageId,
  });
}
