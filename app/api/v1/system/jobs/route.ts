/**
 * System Jobs API v1 - Collection Endpoint
 *
 * GET /api/v1/system/jobs - Get queue statistics and recent jobs
 * POST /api/v1/system/jobs - Create a new background job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { getQueueStats, getActiveCountsByType, getActivitySnapshot, enqueueJob, ensureProcessorRunning, getProcessorStatus } from '@/lib/background-jobs';
import { BackgroundJobTypeEnum } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { created, serverError } from '@/lib/api/responses';
import { z } from 'zod';

/**
 * GET /api/v1/system/jobs - Get queue statistics and optionally recent jobs
 *
 * Query params:
 * - includeJobs: 'true' to include recent jobs
 * - includeByType: 'true' to include the per-job-type active breakdown
 * - chatId: Filter pending jobs for a specific chat
 *
 * `activeByKind` is always present and is what the toolbar chips poll: it
 * merges active job rows with the non-job work registered in the activity
 * registry, grouped by activity kind. The per-type breakdown costs a full
 * read of every active row, so it is opt-in via `includeByType`.
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  try {
    const { searchParams } = req.nextUrl;
    const includeJobs = searchParams.get('includeJobs') === 'true';
    const includeByType = searchParams.get('includeByType') === 'true' || includeJobs;
    const chatId = searchParams.get('chatId');

    // A read only reads: the processor is started at boot and by every
    // enqueue, never by this poll (which also used to undo an operator's
    // "stop" from the tasks queue).

    // Get stats
    const stats = await getQueueStats(user.id);
    const { active: activeByKind, started: startedByKind } = await getActivitySnapshot(user.id);
    const processorStatus = getProcessorStatus();

    const response: Record<string, unknown> = {
      stats,
      activeByKind,
      startedByKind,
      processor: processorStatus,
    };

    // Per-type breakdown reads every active row, so it stays opt-in.
    if (includeByType) {
      response.activeByType = await getActiveCountsByType(user.id);
    }

    // Optionally include recent jobs
    if (includeJobs) {
      const jobs = await repos.backgroundJobs.findByUserId(user.id);
      response.jobs = jobs.slice(0, 50); // Limit to 50 most recent
    }

    // If chatId specified, get pending jobs for that chat
    if (chatId) {
      const pendingJobs = await repos.backgroundJobs.findPendingForChat(chatId);
      response.pendingForChat = pendingJobs;
    }

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[System Jobs v1] Error in GET', { error: errorMessage });
    return serverError(errorMessage);
  }
});

/**
 * The POST envelope. The job type is checked against the enum and the payload
 * must be an object; what each type's payload must hold is not yet schema'd
 * per type (the handlers read it defensively), so this endpoint stays an
 * operator tool rather than a general API.
 */
const CreateJobSchema = z
  .object({
    type: BackgroundJobTypeEnum,
    payload: z.record(z.string(), z.unknown(), { error: 'Payload is required and must be an object' }),
    priority: z.number().int().optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
  })
  .strict();

/**
 * POST /api/v1/system/jobs - Create a new background job
 *
 * Body: {
 *   type: BackgroundJobType,
 *   payload: object,
 *   priority?: integer,
 *   maxAttempts?: integer 1–20
 * }
 */
export const POST = createContextHandler(async (req: NextRequest, { user }: RequestContext) => {
  // A malformed body is the middleware's 400.
  const { type, payload, priority, maxAttempts } = CreateJobSchema.parse(await req.json());

  logger.info('[System Jobs v1] Creating job', { userId: user.id, type });

  ensureProcessorRunning();

  // `enqueueJob` is typed per job; this endpoint takes any type by design.
  const jobId = await enqueueJob(user.id, type, payload as never, { priority, maxAttempts });

  return created({ jobId, message: 'Job created successfully' });
});
