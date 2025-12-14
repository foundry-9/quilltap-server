/**
 * Background Job Processor
 *
 * Processes queued background jobs one at a time using setInterval polling.
 * Jobs are claimed atomically from MongoDB and executed by type-specific handlers.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { BackgroundJob } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getHandler } from './handlers';

/** Processor state */
let processorRunning = false;
let processorInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/** Default polling interval in ms */
const DEFAULT_POLL_INTERVAL = 2000;

/** Rate limit delay between job completions in ms */
const RATE_LIMIT_DELAY = 500;

/**
 * Start the job processor
 * @param intervalMs - Polling interval in milliseconds (default: 2000)
 */
export function startProcessor(intervalMs: number = DEFAULT_POLL_INTERVAL): void {
  if (processorRunning) {
    logger.debug('[JobQueue] Processor already running');
    return;
  }

  processorRunning = true;
  processorInterval = setInterval(() => {
    processNextJob().catch((error) => {
      logger.error('[JobQueue] Error in processor interval', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  logger.info('[JobQueue] Processor started', { intervalMs });

  // Also reset any stuck jobs on startup
  resetStuckJobs().catch((error) => {
    logger.error('[JobQueue] Error resetting stuck jobs on startup', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Stop the job processor
 */
export function stopProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
  }
  processorRunning = false;
  logger.info('[JobQueue] Processor stopped');
}

/**
 * Check if the processor is running
 */
export function isProcessorRunning(): boolean {
  return processorRunning;
}

/**
 * Process the next available job
 * Returns true if a job was processed, false if no jobs were available
 */
export async function processNextJob(): Promise<boolean> {
  // Prevent concurrent processing
  if (isProcessing) {
    logger.debug('[JobQueue] Already processing a job, skipping');
    return false;
  }

  isProcessing = true;

  try {
    const repos = getRepositories();
    const job = await repos.backgroundJobs.claimNextJob();

    if (!job) {
      logger.debug('[JobQueue] No jobs available');
      // Auto-stop when queue is empty
      if (processorRunning) {
        stopProcessor();
        logger.info('[JobQueue] Processor auto-stopped - queue is empty');
      }
      return false;
    }

    logger.info('[JobQueue] Processing job', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
    });

    try {
      const handler = getHandler(job.type);
      await handler(job);

      await repos.backgroundJobs.markCompleted(job.id);
      logger.info('[JobQueue] Job completed successfully', {
        jobId: job.id,
        type: job.type,
      });

      // Rate limit delay to avoid overwhelming LLM providers
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await repos.backgroundJobs.markFailed(job.id, errorMessage);

      logger.warn('[JobQueue] Job failed', {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        error: errorMessage,
      });

      return true; // Job was processed (even though it failed)
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Process multiple jobs in sequence
 * Useful for manually triggering batch processing
 * @param maxJobs - Maximum number of jobs to process (default: 10)
 */
export async function processJobs(maxJobs: number = 10): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i++) {
    const wasProcessed = await processNextJob();
    if (!wasProcessed) {
      break; // No more jobs available
    }
    processed++;

    // Check if job succeeded by looking at the result
    // (processNextJob always returns true if a job was claimed)
    // We can't easily tell here, so we just count processed
  }

  logger.info('[JobQueue] Batch processing completed', {
    processed,
    succeeded,
    failed,
  });

  return { processed, succeeded, failed };
}

/**
 * Reset stuck processing jobs
 * Jobs that have been in PROCESSING state for too long are reset to FAILED
 */
export async function resetStuckJobs(timeoutMinutes: number = 10): Promise<number> {
  const repos = getRepositories();
  const count = await repos.backgroundJobs.resetStuckJobs(timeoutMinutes);
  if (count > 0) {
    logger.info('[JobQueue] Reset stuck jobs', { count, timeoutMinutes });
  }
  return count;
}

/**
 * Ensure the processor is running
 * Starts it if not already running, otherwise does nothing
 */
export function ensureProcessorRunning(): void {
  if (!processorRunning) {
    startProcessor();
  }
}

/**
 * Get processor status
 */
export function getProcessorStatus(): {
  running: boolean;
  processing: boolean;
} {
  return {
    running: processorRunning,
    processing: isProcessing,
  };
}
