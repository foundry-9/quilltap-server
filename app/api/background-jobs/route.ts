/**
 * Background Jobs API
 * GET /api/background-jobs - Get queue statistics and recent jobs
 * POST /api/background-jobs - Create a job (for testing/admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { getQueueStats, enqueueJob, ensureProcessorRunning, getProcessorStatus } from '@/lib/background-jobs';
import { BackgroundJobTypeEnum } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { badRequest, serverError } from '@/lib/api/responses';

/**
 * GET /api/background-jobs
 * Get queue statistics and optionally recent jobs for the current user
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }: AuthenticatedContext) => {
  try {
    const { searchParams } = new URL(req.url);
    const includeJobs = searchParams.get('includeJobs') === 'true';
    const chatId = searchParams.get('chatId');

    logger.debug('[BackgroundJobs API] GET request', {
      userId: user.id,
      includeJobs,
      chatId,
    });

    // Ensure processor is running
    ensureProcessorRunning();

    // Get stats
    const stats = await getQueueStats(user.id);
    const processorStatus = getProcessorStatus();

    const response: Record<string, unknown> = {
      stats,
      processor: processorStatus,
    };

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
    logger.error('[BackgroundJobs API] Error in GET', { error: errorMessage });
    return serverError(errorMessage);
  }
});

/**
 * POST /api/background-jobs
 * Create a new background job (mainly for testing/admin)
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user }: AuthenticatedContext) => {
  try {
    const body = await req.json();
    const { type, payload, priority, maxAttempts } = body;

    // Validate type
    const typeValidation = BackgroundJobTypeEnum.safeParse(type);
    if (!typeValidation.success) {
      return badRequest(`Invalid job type. Must be one of: ${BackgroundJobTypeEnum.options.join(', ')}`);
    }

    if (!payload || typeof payload !== 'object') {
      return badRequest('Payload is required and must be an object');
    }

    logger.info('[BackgroundJobs API] Creating job', {
      userId: user.id,
      type,
    });

    // Ensure processor is running
    ensureProcessorRunning();

    const jobId = await enqueueJob(user.id, type, payload, {
      priority: typeof priority === 'number' ? priority : undefined,
      maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : undefined,
    });

    return NextResponse.json({ jobId, message: 'Job created successfully' }, { status: 201 });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs API] Error in POST', { error: errorMessage });
    return serverError(errorMessage);
  }
});
