/**
 * Background Jobs API
 * GET /api/background-jobs - Get queue statistics and recent jobs
 * POST /api/background-jobs - Create a job (for testing/admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { getQueueStats, enqueueJob, ensureProcessorRunning, getProcessorStatus } from '@/lib/background-jobs';
import { BackgroundJobTypeEnum } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';

/**
 * GET /api/background-jobs
 * Get queue statistics and optionally recent jobs for the current user
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeJobs = searchParams.get('includeJobs') === 'true';
    const chatId = searchParams.get('chatId');

    logger.debug('[BackgroundJobs API] GET request', {
      userId: session.user.id,
      includeJobs,
      chatId,
    });

    // Ensure processor is running
    ensureProcessorRunning();

    // Get stats
    const stats = await getQueueStats(session.user.id);
    const processorStatus = getProcessorStatus();

    const response: Record<string, unknown> = {
      stats,
      processor: processorStatus,
    };

    // Optionally include recent jobs
    if (includeJobs) {
      const repos = getRepositories();
      const jobs = await repos.backgroundJobs.findByUserId(session.user.id);
      response.jobs = jobs.slice(0, 50); // Limit to 50 most recent
    }

    // If chatId specified, get pending jobs for that chat
    if (chatId) {
      const repos = getRepositories();
      const pendingJobs = await repos.backgroundJobs.findPendingForChat(chatId);
      response.pendingForChat = pendingJobs;
    }

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[BackgroundJobs API] Error in GET', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * POST /api/background-jobs
 * Create a new background job (mainly for testing/admin)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { type, payload, priority, maxAttempts } = body;

    // Validate type
    const typeValidation = BackgroundJobTypeEnum.safeParse(type);
    if (!typeValidation.success) {
      return NextResponse.json(
        { error: `Invalid job type. Must be one of: ${BackgroundJobTypeEnum.options.join(', ')}` },
        { status: 400 }
      );
    }

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json(
        { error: 'Payload is required and must be an object' },
        { status: 400 }
      );
    }

    logger.info('[BackgroundJobs API] Creating job', {
      userId: session.user.id,
      type,
    });

    // Ensure processor is running
    ensureProcessorRunning();

    const jobId = await enqueueJob(session.user.id, type, payload, {
      priority: typeof priority === 'number' ? priority : undefined,
      maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : undefined,
    });

    return NextResponse.json({ jobId, message: 'Job created successfully' }, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[BackgroundJobs API] Error in POST', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
