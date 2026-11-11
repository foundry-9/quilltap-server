/**
 * System Tools — the background-job queue view and its controls.
 *
 * Served by `app/api/v1/system/tools/route.ts`:
 *   GET  ?action=tasks-queue      - queue status, active jobs, processor status
 *   POST ?action=tasks-queue      - start / stop the processor (body `{ action }`)
 *   GET  ?action=job-concurrency  - the global concurrency cap
 *   POST ?action=job-concurrency  - set the global concurrency cap (1-32)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { RequestContext } from '@/lib/api/middleware';
import { serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import type { BackgroundJob } from '@/lib/schemas/types';
import { startProcessor, stopProcessor, getProcessorStatus, wakeProcessor } from '@/lib/background-jobs/processor';
import { getMaxConcurrentJobs, setMaxConcurrentJobs } from '@/lib/instance-settings';

// ============================================================================
// Schemas
// ============================================================================

/**
 * POST ?action=tasks-queue body. The `{ action }` body discriminator is kept
 * for now (a conformance item in refactor-4-13-api-input-schemas §4.6); an
 * unknown value is a 400.
 */
export const tasksQueueControlBodySchema = z.object({
  action: z.enum(['start', 'stop'], { error: 'Invalid action. Must be "start" or "stop"' }),
});

/** POST ?action=job-concurrency body. */
export const jobConcurrencyBodySchema = z.object({
  concurrency: z.number().int().min(1).max(32),
});

// ============================================================================
// Helpers
// ============================================================================

function estimateTokensForJob(job: BackgroundJob): number {
  const baseTokens = 500;

  switch (job.type) {
    case 'MEMORY_EXTRACTION': {
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 300;
    }
    case 'CONTEXT_SUMMARY': {
      return baseTokens + 2000;
    }
    case 'TITLE_UPDATE': {
      return baseTokens + 300;
    }
    case 'CHAT_DANGER_CLASSIFICATION': {
      return baseTokens + 1000;
    }
    case 'SCENE_STATE_TRACKING': {
      return baseTokens + 800;
    }
    case 'LLM_LOG_CLEANUP':
    case 'EMBEDDING_GENERATE':
    case 'EMBEDDING_REFIT':
    case 'EMBEDDING_REINDEX_ALL':
    case 'CHARACTER_AVATAR_GENERATION':
    case 'CONVERSATION_RENDER': {
      // These jobs do not consume LLM text-generation tokens
      return 0;
    }
    case 'STORY_BACKGROUND_GENERATION': {
      // Image generation job — no LLM text tokens
      return 0;
    }
    default:
      return baseTokens;
  }
}

function getJobTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    MEMORY_EXTRACTION: 'Memory Extraction',
    CONTEXT_SUMMARY: 'Context Summary',
    TITLE_UPDATE: 'Title Update',
    LLM_LOG_CLEANUP: 'LLM Log Cleanup',
    EMBEDDING_GENERATE: 'Embedding Generation',
    EMBEDDING_REFIT: 'Vocabulary Refit',
    EMBEDDING_REINDEX_ALL: 'Re-embed All Memories',
    STORY_BACKGROUND_GENERATION: 'Story Background',
    CHAT_DANGER_CLASSIFICATION: 'Danger Classification',
    SCENE_STATE_TRACKING: 'Scene State Tracking',
    CHARACTER_AVATAR_GENERATION: 'Avatar Generation',
    CONVERSATION_RENDER: 'Conversation Render',
  };
  return typeNames[type] || type;
}

// ============================================================================
// Handlers
// ============================================================================

export async function handleTasksQueue(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    logger.debug('[System Tools v1] Fetching tasks queue status', { userId: user.id });

    const repo = repos.backgroundJobs;
    const stats = await repo.getStats(user.id);

    const pendingJobs = await repo.findByUserId(user.id, 'PENDING');
    const processingJobs = await repo.findByUserId(user.id, 'PROCESSING');
    const failedJobs = await repo.findByUserId(user.id, 'FAILED');
    const pausedJobs = await repo.findByUserId(user.id, 'PAUSED');

    const jobMap = new Map<string, BackgroundJob>();
    for (const job of [
      ...processingJobs,
      ...pendingJobs,
      ...failedJobs.filter((j: BackgroundJob) => j.attempts < j.maxAttempts),
      ...pausedJobs,
    ]) {
      if (!jobMap.has(job.id)) {
        jobMap.set(job.id, job);
      }
    }
    const activeJobs = Array.from(jobMap.values());

    activeJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    // Build a character name cache for jobs that only have characterId
    const characterNameCache = new Map<string, string>();
    for (const job of activeJobs) {
      const payload = job.payload as Record<string, unknown>;
      if (payload.characterId && !payload.characterName) {
        const charId = payload.characterId as string;
        if (!characterNameCache.has(charId)) {
          try {
            const character = await repos.characters.findById(charId);
            if (character) {
              characterNameCache.set(charId, character.name);
            }
          } catch {
            // Character lookup failed, skip
          }
        }
      }
    }

    let totalEstimatedTokens = 0;
    const jobDetails = activeJobs.map((job) => {
      const estimatedTokens = estimateTokensForJob(job);
      totalEstimatedTokens += estimatedTokens;

      const payload = job.payload as Record<string, unknown>;

      // Resolve character name from payload or cache
      const characterName = (payload.characterName as string | undefined)
        || characterNameCache.get(payload.characterId as string)
        || undefined;

      return {
        id: job.id,
        type: job.type,
        typeName: getJobTypeName(job.type),
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        lastError: job.lastError,
        estimatedTokens,
        chatId: payload.chatId as string | undefined,
        characterName,
      };
    });

    const processorStatus = getProcessorStatus();
    const maxConcurrentJobs = await getMaxConcurrentJobs();
    return successResponse({
      stats: {
        pending: stats.pending,
        processing: stats.processing,
        failed: stats.failed,
        completed: stats.completed,
        dead: stats.dead,
        paused: stats.paused,
        activeTotal: activeJobs.length,
      },
      jobs: jobDetails,
      totalEstimatedTokens,
      processorStatus,
      maxConcurrentJobs,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error fetching tasks queue status',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch queue status');
  }
}

/**
 * Start or stop the processor: `POST ?action=tasks-queue-start` /
 * `?action=tasks-queue-stop`. With no `mode` (the deprecated
 * `POST ?action=tasks-queue` `{ action }`), the body names it.
 */
export function handleTasksQueueControl(mode?: 'start' | 'stop') {
  return async (req: NextRequest, context: RequestContext) => {
  const { user } = context;

  try {
    const { action } = mode ? { action: mode } : tasksQueueControlBodySchema.parse(await req.json());

    logger.info('[System Tools v1] Tasks queue control action', {
      userId: user.id,
      action,
    });

    if (action === 'start') {
      startProcessor();
    } else {
      stopProcessor();
    }

    const processorStatus = getProcessorStatus();
    return successResponse({
      success: true,
      action,
      processorStatus,
    });
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    logger.error(
      '[System Tools v1] Error controlling tasks queue',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to control queue');
  }
  };
}

export async function handleJobConcurrency(_req: NextRequest, context: RequestContext) {
  const { user } = context;
  try {
    logger.debug('[System Tools v1] Reading job concurrency cap', { userId: user.id });
    const concurrency = await getMaxConcurrentJobs();
    return successResponse({ success: true, concurrency });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error reading job concurrency cap',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to read job concurrency');
  }
}

export async function handleJobConcurrencyControl(req: NextRequest, context: RequestContext) {
  const { user } = context;
  // A missing or malformed body is an absent cap, which the schema refuses.
  const body: unknown = await req.json().catch(() => ({}));
  const { concurrency } = jobConcurrencyBodySchema.parse(body);

  try {
    await setMaxConcurrentJobs(concurrency);
    // Nudge the dispatcher so the new cap applies immediately rather than on the
    // next 2 s poll.
    wakeProcessor();

    logger.info('[System Tools v1] Background-job concurrency cap updated', {
      userId: user.id,
      concurrency,
    });
    return successResponse({ success: true, concurrency });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error setting job concurrency cap',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to set job concurrency');
  }
}
