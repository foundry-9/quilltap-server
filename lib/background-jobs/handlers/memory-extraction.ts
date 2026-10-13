/**
 * Memory Extraction Job Handler
 *
 * One MEMORY_EXTRACTION job is one unit of work for the extraction pipeline
 * (`lib/memory/extraction/`): it builds the extraction context once and runs
 * the passes its `pass` names.
 *
 *  - `'turn'` (the default) — the turn the payload's opener (and, in
 *    autonomous rooms, anchor) locate, through `self-turn` and `other-turn`.
 *  - `'other-fold'` / `'episode-fold'` — a fold pass's catch-up over the
 *    chat's backlog past that pass's cursor. A job that leaves slices unread
 *    enqueues its successor, keyed on the cursor it advanced to.
 *
 * A pass lost to a cheap-LLM timeout is work that never happened, and nothing
 * else re-queues it, so the job fails for a retry rather than reporting a
 * clean finish over the hole (bug 107).
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  buildExtractionContext,
  ExtractionContextError,
  runFoldCatchup,
  runTurnExtraction,
  type ExtractionContext,
  type PassResult,
} from '@/lib/memory/extraction';
import { CheapLLMTaskLostError } from '@/lib/memory/cheap-llm-tasks';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import { logger } from '@/lib/logger';
import {
  enqueueMemoryExtraction,
  memoryExtractionPassOf,
  type MemoryExtractionPayload,
} from '../queue-service';

/**
 * What every extraction job does after its passes: fail for a retry when a
 * pass was lost to a timeout, keep the debug lines on the message they
 * describe, and book the cheap-LLM tokens.
 */
export async function finishExtractionJob(
  job: BackgroundJob,
  ctx: ExtractionContext,
  result: PassResult,
  opts: { taskLabel: string; debugMessageId?: string | null },
): Promise<void> {
  const chatId = ctx.chat.id;
  if (result.timedOut > 0) {
    logger.error('[MemoryExtraction] Extraction passes lost to a cheap-LLM timeout; failing the job for retry', {
      jobId: job.id,
      chatId,
      task: opts.taskLabel,
      passesLostToTimeout: result.timedOut,
    });
    throw new CheapLLMTaskLostError(opts.taskLabel, `${result.timedOut} pass(es) timed out`);
  }

  if (opts.debugMessageId && result.debugLogs.length > 0) {
    try {
      await getRepositories().chats.updateMessage(chatId, opts.debugMessageId, { debugMemoryLogs: result.debugLogs });
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to store debug logs', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (result.usage.promptTokens || result.usage.completionTokens) {
    const profile = ctx.route.connectionProfile;
    try {
      const costResult = await estimateMessageCost(
        profile.provider,
        profile.modelName,
        result.usage.promptTokens,
        result.usage.completionTokens,
        job.userId,
      );
      await createMemoryExtractionEvent(chatId, result.usage, profile.provider, profile.modelName, costResult.cost);
    } catch (e) {
      logger.warn('[MemoryExtraction] Failed to emit token tracking event', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * The context for an extraction job, or null when the chat is gone (nothing
 * to do). A missing connection profile is a job failure.
 */
export async function extractionContextForJob(
  job: BackgroundJob,
  chatId: string,
  connectionProfileId: string,
  extra: { extraCharacterIds?: string[]; backfill?: boolean } = {},
): Promise<ExtractionContext | null> {
  const connectionProfile = await getRepositories().connections.findById(connectionProfileId);
  if (!connectionProfile) throw new Error(`Connection profile not found: ${connectionProfileId}`);
  try {
    return await buildExtractionContext(chatId, job.userId, { connectionProfile, ...extra });
  } catch (error) {
    if (error instanceof ExtractionContextError && error.reason === 'no-chat') {
      logger.warn('[MemoryExtraction] Chat not found at job execution; skipping', { jobId: job.id, chatId });
      return null;
    }
    throw error;
  }
}

export async function handleMemoryExtraction(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryExtractionPayload;
  const pass = memoryExtractionPassOf(payload);
  const ctx = await extractionContextForJob(job, payload.chatId, payload.connectionProfileId, {
    backfill: payload.backfill === true,
  });
  if (!ctx) return;

  if (pass !== 'turn') {
    const ignoreIdle = payload.ignoreIdle === true || payload.foldOtherIgnoreIdle === true;
    const result = await runFoldCatchup(ctx, pass, { ignoreIdle });
    logger.info('[MemoryExtraction] Fold catch-up processed', {
      jobId: job.id,
      chatId: payload.chatId,
      pass,
      skippedReason: result.skippedReason ?? null,
      slices: result.slices,
      created: result.createdIds.length,
      reinforced: result.reinforcedIds.length,
      cursorAdvancedTo: result.cursorAdvancedTo,
      slicesDeferred: result.slicesDeferred,
    });
    await finishExtractionJob(job, ctx, result, { taskLabel: `${pass}-catchup` });
    // The rest of a long backlog is the next job's, keyed on the cursor this
    // one advanced to so successive steps never dedupe into each other.
    // A slice deferred by the rate limit waits for the next fold or sweep, not
    // a successor that would meet the same cap at once.
    if (result.slicesDeferred > 0 && result.cursorAdvancedTo && result.skippedReason !== 'rate-limited') {
      await enqueueMemoryExtraction(job.userId, {
        chatId: payload.chatId,
        turnOpenerMessageId: null,
        extractionAnchorMessageId: null,
        connectionProfileId: payload.connectionProfileId,
        pass,
        cursor: result.cursorAdvancedTo,
        ...(ignoreIdle ? { ignoreIdle: true } : {}),
        ...(payload.backfill ? { backfill: true } : {}),
      });
      logger.debug('[MemoryExtraction] Fold catch-up continues in a follow-up job', {
        jobId: job.id,
        chatId: payload.chatId,
        pass,
        from: result.cursorAdvancedTo,
        slicesDeferred: result.slicesDeferred,
      });
    }
    return;
  }

  const result = await runTurnExtraction(ctx, {
    turnOpenerMessageId: payload.turnOpenerMessageId,
    extractionAnchorMessageId: payload.extractionAnchorMessageId ?? null,
  });
  if (!result.hadContributions) {
    logger.info('[MemoryExtraction] Turn has no character contributions; skipping', {
      jobId: job.id,
      chatId: payload.chatId,
      turnOpenerMessageId: payload.turnOpenerMessageId,
    });
    return;
  }
  logger.info('[MemoryExtraction] Turn processed', {
    jobId: job.id,
    chatId: payload.chatId,
    turnOpenerMessageId: payload.turnOpenerMessageId,
    extractionAnchorMessageId: payload.extractionAnchorMessageId ?? null,
    candidates: result.admitted.length,
    created: result.createdIds.length,
    reinforced: result.reinforcedIds.length,
  });
  // The debug lines go on the turn's latest assistant message, where the
  // debug panel shows what the turn's extraction did.
  await finishExtractionJob(job, ctx, result, { taskLabel: 'memory-extraction', debugMessageId: result.sourceMessageId });
}
