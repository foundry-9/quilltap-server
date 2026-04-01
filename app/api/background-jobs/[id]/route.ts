/**
 * Individual Background Job API
 * GET    /api/background-jobs/[id] - Get job details
 * DELETE /api/background-jobs/[id] - Delete a job
 * PATCH  /api/background-jobs/[id] - Pause/resume a job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { ensureProcessorRunning } from '@/lib/background-jobs';
import { getErrorMessage } from '@/lib/errors';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/background-jobs/[id]
 * Get detailed information about a specific job
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    logger.debug('[BackgroundJobs API] GET job by ID', { jobId: id, userId: session.user.id });

    const repos = getRepositories();
    const job = await repos.backgroundJobs.findById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure user owns this job
    if (job.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(job);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs API] Error in GET by ID', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/background-jobs/[id]
 * Delete a specific job
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    logger.debug('[BackgroundJobs API] DELETE job', { jobId: id, userId: session.user.id });

    const repos = getRepositories();
    const job = await repos.backgroundJobs.findById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure user owns this job
    if (job.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Don't allow deleting jobs that are currently processing
    if (job.status === 'PROCESSING') {
      return NextResponse.json(
        { error: 'Cannot delete a job that is currently processing' },
        { status: 400 }
      );
    }

    const deleted = await repos.backgroundJobs.delete(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
    }

    logger.info('[BackgroundJobs API] Job deleted', { jobId: id, userId: session.user.id });
    return NextResponse.json({ success: true, message: 'Job deleted' });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs API] Error in DELETE', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * PATCH /api/background-jobs/[id]
 * Pause or resume a job
 * Body: { action: 'pause' | 'resume' }
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await req.json();
    const { action } = body;

    if (!action || !['pause', 'resume'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "pause" or "resume"' },
        { status: 400 }
      );
    }

    logger.debug('[BackgroundJobs API] PATCH job', {
      jobId: id,
      userId: session.user.id,
      action,
    });

    const repos = getRepositories();
    const job = await repos.backgroundJobs.findById(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure user owns this job
    if (job.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let updatedJob;
    if (action === 'pause') {
      if (!['PENDING', 'FAILED'].includes(job.status)) {
        return NextResponse.json(
          { error: `Cannot pause a job with status "${job.status}". Only PENDING or FAILED jobs can be paused.` },
          { status: 400 }
        );
      }
      updatedJob = await repos.backgroundJobs.pause(id);
    } else {
      if (job.status !== 'PAUSED') {
        return NextResponse.json(
          { error: `Cannot resume a job with status "${job.status}". Only PAUSED jobs can be resumed.` },
          { status: 400 }
        );
      }
      updatedJob = await repos.backgroundJobs.resume(id);
      // Auto-start processor when resuming a job
      ensureProcessorRunning();
    }

    if (!updatedJob) {
      return NextResponse.json({ error: `Failed to ${action} job` }, { status: 500 });
    }

    logger.info('[BackgroundJobs API] Job action completed', {
      jobId: id,
      userId: session.user.id,
      action,
      newStatus: updatedJob.status,
    });

    return NextResponse.json(updatedJob);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs API] Error in PATCH', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
