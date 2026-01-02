/**
 * Background Jobs Process Trigger API
 * POST /api/background-jobs/process - Trigger job processing
 * GET  /api/background-jobs/process - Get processor status (health check)
 *
 * This endpoint can be called by external cron jobs or health checks
 * to ensure the processor is running and trigger immediate processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import {
  startProcessor,
  isProcessorRunning,
  processNextJob,
  processJobs,
  resetStuckJobs,
  getProcessorStatus,
  cleanupOldJobs,
} from '@/lib/background-jobs';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

/**
 * POST /api/background-jobs/process
 * Trigger job processing
 *
 * Query params:
 * - batch=true: Process multiple jobs in sequence
 * - maxJobs=N: Maximum jobs to process in batch mode (default: 10)
 * - cleanup=true: Also cleanup old completed jobs
 * - reset=true: Reset stuck jobs before processing
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user }: AuthenticatedContext) => {
  try {
    const { searchParams } = new URL(req.url);
    const batchMode = searchParams.get('batch') === 'true';
    const maxJobs = parseInt(searchParams.get('maxJobs') || '10', 10);
    const cleanup = searchParams.get('cleanup') === 'true';
    const reset = searchParams.get('reset') === 'true';

    logger.info('[BackgroundJobs Process] Trigger received', {
      userId: user.id,
      batchMode,
      maxJobs,
      cleanup,
      reset,
    });

    const result: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
    };

    // Reset stuck jobs if requested
    if (reset) {
      const resetCount = await resetStuckJobs();
      result.stuckJobsReset = resetCount;
    }

    // Start processor if not running
    if (!isProcessorRunning()) {
      startProcessor();
      result.processorStarted = true;
    }

    // Process jobs
    if (batchMode) {
      const batchResult = await processJobs(maxJobs);
      result.processed = batchResult.processed;
      result.succeeded = batchResult.succeeded;
      result.failed = batchResult.failed;
    } else {
      const wasProcessed = await processNextJob();
      result.jobProcessed = wasProcessed;
    }

    // Cleanup old jobs if requested
    if (cleanup) {
      const cleanedUp = await cleanupOldJobs(7); // 7 days
      result.cleanedUp = cleanedUp;
    }

    result.processorStatus = getProcessorStatus();

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs Process] Error', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
});

/**
 * GET /api/background-jobs/process
 * Get processor status (useful for health checks)
 */
export async function GET() {
  try {
    const status = getProcessorStatus();
    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[BackgroundJobs Process] Error in status check', { error: errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
