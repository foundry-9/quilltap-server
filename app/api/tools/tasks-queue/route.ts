/**
 * Tasks Queue API Route
 *
 * Provides status information about the background jobs (cheap LLM) queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { BackgroundJobsRepository } from '@/lib/mongodb/repositories/background-jobs.repository';
import { BackgroundJob } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { startProcessor, stopProcessor, getProcessorStatus } from '@/lib/background-jobs/processor';

/**
 * Rough estimate of tokens for a job based on its type and payload
 * These are approximations based on typical prompt/context sizes
 */
function estimateTokensForJob(job: BackgroundJob): number {
  const baseTokens = 500; // Base system prompt overhead

  switch (job.type) {
    case 'MEMORY_EXTRACTION': {
      // Memory extraction includes: system prompt (~200), user message, assistant message, extraction instructions (~300)
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 300;
    }
    case 'INTER_CHARACTER_MEMORY': {
      // Similar to memory extraction but with character context
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 400; // Extra for character context
    }
    case 'CONTEXT_SUMMARY': {
      // Context summaries process multiple messages, estimate higher
      return baseTokens + 2000; // Rough estimate for context window
    }
    case 'TITLE_UPDATE': {
      // Title updates are lightweight, just need recent context
      return baseTokens + 300;
    }
    default:
      return baseTokens;
  }
}

/**
 * Get human-readable job type name
 */
function getJobTypeName(type: string): string {
  switch (type) {
    case 'MEMORY_EXTRACTION':
      return 'Memory Extraction';
    case 'INTER_CHARACTER_MEMORY':
      return 'Character Memory';
    case 'CONTEXT_SUMMARY':
      return 'Context Summary';
    case 'TITLE_UPDATE':
      return 'Title Update';
    default:
      return type;
  }
}

/**
 * GET /api/tools/tasks-queue
 * Returns queue statistics and pending/processing jobs
 */
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access to tasks queue API');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Fetching tasks queue status', { userId: session.user.id });

    const repo = new BackgroundJobsRepository();

    // Get overall stats for the user
    const stats = await repo.getStats(session.user.id);

    // Get pending, processing, failed, and paused jobs for the user
    const pendingJobs = await repo.findByUserId(session.user.id, 'PENDING');
    const processingJobs = await repo.findByUserId(session.user.id, 'PROCESSING');
    const failedJobs = await repo.findByUserId(session.user.id, 'FAILED');
    const pausedJobs = await repo.findByUserId(session.user.id, 'PAUSED');

    // Combine active jobs (pending + processing + failed that will retry + paused)
    const activeJobs = [...processingJobs, ...pendingJobs, ...failedJobs.filter(j => j.attempts < j.maxAttempts), ...pausedJobs];

    // Sort by priority (descending) then scheduledAt (ascending)
    activeJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    // Calculate estimated tokens
    let totalEstimatedTokens = 0;
    const jobDetails = activeJobs.map(job => {
      const estimatedTokens = estimateTokensForJob(job);
      totalEstimatedTokens += estimatedTokens;

      // Extract relevant info from payload for display
      const payload = job.payload as Record<string, unknown>;

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
        // Include some payload details for context
        chatId: payload.chatId as string | undefined,
        characterName: payload.characterName as string | undefined,
      };
    });

    const processorStatus = getProcessorStatus();

    logger.debug('Tasks queue status retrieved', {
      userId: session.user.id,
      activeJobCount: activeJobs.length,
      totalEstimatedTokens,
      processorRunning: processorStatus.running,
    });

    return NextResponse.json({
      stats: {
        pending: stats.pending,
        processing: stats.processing,
        failed: stats.failed,
        completed: stats.completed,
        dead: stats.dead,
        activeTotal: activeJobs.length,
      },
      jobs: jobDetails,
      totalEstimatedTokens,
      processorStatus,
    });
  } catch (error) {
    logger.error('Error fetching tasks queue status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to fetch queue status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tools/tasks-queue
 * Control the queue processor (start/stop)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access to tasks queue control API');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (!action || !['start', 'stop'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "start" or "stop"' },
        { status: 400 }
      );
    }

    logger.info('Tasks queue control action', {
      userId: session.user.id,
      action,
    });

    if (action === 'start') {
      startProcessor();
    } else {
      stopProcessor();
    }

    const processorStatus = getProcessorStatus();

    logger.debug('Tasks queue processor status updated', {
      userId: session.user.id,
      action,
      running: processorStatus.running,
    });

    return NextResponse.json({
      success: true,
      action,
      processorStatus,
    });
  } catch (error) {
    logger.error('Error controlling tasks queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to control queue' },
      { status: 500 }
    );
  }
}
