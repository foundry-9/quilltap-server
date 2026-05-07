/**
 * Background Job Processor
 *
 * Processes queued background jobs using setInterval polling.
 * Most job types run one at a time; EMBEDDING_GENERATE jobs run with
 * configurable concurrency to saturate local embedding providers.
 * Jobs are claimed atomically from the database and executed by type-specific handlers.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { BackgroundJob } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getHandler } from './handlers';
import { getErrorMessage } from '@/lib/errors';
import { getMemoryExtractionConcurrency } from '@/lib/instance-settings';

/** Processor state */
let processorRunning = false;
let processorInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/** Default polling interval in ms */
const DEFAULT_POLL_INTERVAL = 2000;

/** Rate limit delay between job completions in ms (for non-embedding jobs) */
const RATE_LIMIT_DELAY = 500;

/** Per-job execution timeout in ms (3 minutes) */
const JOB_EXECUTION_TIMEOUT_MS = 3 * 60 * 1000;

/** Per-job execution timeout for embedding jobs in ms (10 minutes).
 *  Local providers like Ollama can be slow under concurrent load. */
const EMBEDDING_TIMEOUT_MS = 10 * 60 * 1000;

/** Per-job execution timeout for memory housekeeping in ms (15 minutes).
 *  A user-level sweep walks every character's memories, and a single
 *  character with tens of thousands of entries can take well over the
 *  3-minute default — tripping the timeout forces retries, which re-run
 *  the whole sweep from scratch and thrash the main thread during startup. */
const HOUSEKEEPING_TIMEOUT_MS = 15 * 60 * 1000;

/** How often to check for stuck PROCESSING jobs (5 minutes) */
const STUCK_JOB_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Maximum number of EMBEDDING_GENERATE jobs that may execute concurrently.
 * Kept moderate to avoid overwhelming local providers like Ollama.
 */
const EMBEDDING_CONCURRENCY = 4;

/** Small delay between claiming successive concurrent jobs (ms) */
const CONCURRENT_CLAIM_DELAY = 50;

/** Stuck job recovery timer */
let stuckJobCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Per-type in-flight counters. Sequential jobs (anything not listed in
 * CONCURRENT_JOB_TYPES) don't need a counter — they go through the
 * `isProcessing` mutex instead.
 */
const inFlightByType = new Map<string, number>();

function inFlight(type: string): number {
  return inFlightByType.get(type) ?? 0;
}

function bumpInFlight(type: string, delta: number): void {
  inFlightByType.set(type, Math.max(0, inFlight(type) + delta));
}

/**
 * MEMORY_EXTRACTION concurrency. Defaults to 1 (sequential, original
 * behaviour) and is overridden at runtime from the user's chatSettings via
 * setMemoryExtractionConcurrencyOverride. The Memory Settings UI updates
 * this when the operator drags the slider.
 *
 * The first call to startProcessor seeds this from chatSettings so a saved
 * value survives a server restart without needing the operator to revisit
 * the slider.
 */
let memoryExtractionConcurrencyOverride = 1;
let memoryExtractionConcurrencySeeded = false;

async function seedMemoryExtractionConcurrencyFromSettings(): Promise<void> {
  if (memoryExtractionConcurrencySeeded) return;
  memoryExtractionConcurrencySeeded = true;
  try {
    const value = await getMemoryExtractionConcurrency();
    memoryExtractionConcurrencyOverride = value;
    logger.info('[JobQueue] Seeded memory extraction concurrency from instance settings', { value });
  } catch (error) {
    logger.warn('[JobQueue] Failed to seed memory extraction concurrency from instance settings', {
      error: getErrorMessage(error),
    });
  }
}

export function setMemoryExtractionConcurrencyOverride(value: number): void {
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(1, Math.min(32, Math.floor(value)));
  memoryExtractionConcurrencyOverride = clamped;
  logger.info('[JobQueue] Memory extraction concurrency override updated', { value: clamped });
}

export function getMemoryExtractionConcurrencyOverride(): number {
  return memoryExtractionConcurrencyOverride;
}

function concurrencyFor(type: string): number {
  if (type === 'EMBEDDING_GENERATE') return EMBEDDING_CONCURRENCY;
  if (type === 'MEMORY_EXTRACTION') return memoryExtractionConcurrencyOverride;
  return 1;
}

function totalConcurrentInFlight(): number {
  let total = 0;
  for (const type of CONCURRENT_JOB_TYPES) {
    total += inFlight(type);
  }
  return total;
}

/**
 * Timer that re-starts the processor when a FAILED job's `scheduledAt` comes due.
 * Without this, a retry-eligible job whose next retry is in the future would
 * strand the processor in an auto-stopped state until something new was enqueued.
 */
let wakeUpTimer: ReturnType<typeof setTimeout> | null = null;

/** Cap on how long we'll sleep before re-checking the queue (5 minutes). */
const MAX_WAKE_UP_DELAY_MS = 5 * 60 * 1000;

function clearWakeUpTimer(): void {
  if (wakeUpTimer) {
    clearTimeout(wakeUpTimer);
    wakeUpTimer = null;
  }
}

function armWakeUpTimer(scheduledAt: string): void {
  clearWakeUpTimer();
  const rawMs = new Date(scheduledAt).getTime() - Date.now();
  const delayMs = Math.min(Math.max(rawMs, 100), MAX_WAKE_UP_DELAY_MS);
  wakeUpTimer = setTimeout(() => {
    wakeUpTimer = null;
    logger.info('[JobQueue] Wake-up timer fired for scheduled retry', { scheduledAt });
    ensureProcessorRunning();
  }, delayMs);
}

/** Job types eligible for concurrent processing */
const CONCURRENT_JOB_TYPES = new Set(['EMBEDDING_GENERATE', 'MEMORY_EXTRACTION']);

/**
 * Start the job processor
 * @param intervalMs - Polling interval in milliseconds (default: 2000)
 */
export function startProcessor(intervalMs: number = DEFAULT_POLL_INTERVAL): void {
  if (processorRunning) {
    return;
  }

  // A pending wake-up timer is now redundant — we're starting up right away.
  clearWakeUpTimer();

  processorRunning = true;
  processorInterval = setInterval(() => {
    processNextJob().catch((error) => {
      logger.error('[JobQueue] Error in processor interval', {
        error: getErrorMessage(error),
      });
    });
  }, intervalMs);

  logger.info('[JobQueue] Processor started', {
    intervalMs,
    embeddingConcurrency: EMBEDDING_CONCURRENCY,
    memoryExtractionConcurrency: memoryExtractionConcurrencyOverride,
  });

  // Seed the runtime concurrency override from persisted chat settings so a
  // saved value survives a restart. Fire-and-forget; the worst case is one
  // poll cycle running at the default before the seeded value kicks in.
  seedMemoryExtractionConcurrencyFromSettings().catch((error) => {
    logger.warn('[JobQueue] Memory extraction concurrency seed failed', {
      error: getErrorMessage(error),
    });
  });

  // Reset ALL orphaned PROCESSING jobs on startup — no job can legitimately
  // be in PROCESSING state when the server just started.
  resetOrphanedJobs().catch((error) => {
    logger.error('[JobQueue] Error resetting orphaned jobs on startup', {
      error: getErrorMessage(error),
    });
  });

  // Periodically check for stuck jobs (in case an LLM call hangs)
  if (!stuckJobCheckInterval) {
    stuckJobCheckInterval = setInterval(() => {
      resetStuckJobs().catch((error) => {
        logger.error('[JobQueue] Error in periodic stuck job check', {
          error: getErrorMessage(error),
        });
      });
    }, STUCK_JOB_CHECK_INTERVAL_MS);
  }
}

/**
 * Stop the job processor
 */
export function stopProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
  }
  if (stuckJobCheckInterval) {
    clearInterval(stuckJobCheckInterval);
    stuckJobCheckInterval = null;
  }
  clearWakeUpTimer();
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
 * Execute a single job with timeout, mark it completed or failed.
 * Returns true if the job succeeded, false on failure.
 */
async function executeJob(job: BackgroundJob): Promise<boolean> {
  const repos = getRepositories();
  const timeoutMs =
    CONCURRENT_JOB_TYPES.has(job.type)
      ? EMBEDDING_TIMEOUT_MS
      : job.type === 'MEMORY_HOUSEKEEPING'
        ? HOUSEKEEPING_TIMEOUT_MS
        : JOB_EXECUTION_TIMEOUT_MS;

  try {
    const handler = getHandler(job.type);
    await Promise.race([
      handler(job),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Job execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);

    await repos.backgroundJobs.markCompleted(job.id);
    logger.info('[JobQueue] Job completed successfully', {
      jobId: job.id,
      type: job.type,
    });
    return true;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await repos.backgroundJobs.markFailed(job.id, errorMessage);

    logger.warn('[JobQueue] Job failed', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      error: errorMessage,
    });
    return false;
  }
}

/**
 * Process the next available job
 * Returns true if a job was processed, false if no jobs were available
 */
export async function processNextJob(): Promise<boolean> {
  // Prevent concurrent entry
  if (isProcessing) {
    return false;
  }

  isProcessing = true;

  try {
    const repos = getRepositories();
    const job = await repos.backgroundJobs.claimNextJob();

    if (!job) {
      // Auto-stop when queue is empty and no concurrent jobs remain in-flight
      if (processorRunning && totalConcurrentInFlight() === 0) {
        // Check for retry-eligible jobs scheduled in the future so we can wake
        // the processor back up in time — otherwise FAILED retries strand here
        // until something new is enqueued.
        const nextScheduledAt = await repos.backgroundJobs.findNextScheduledAt();
        stopProcessor();
        logger.info('[JobQueue] Processor auto-stopped - queue is empty', {
          nextScheduledAt: nextScheduledAt ?? null,
        });
        if (nextScheduledAt) {
          armWakeUpTimer(nextScheduledAt);
        }
      }
      return false;
    }

    logger.info('[JobQueue] Processing job', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
    });

    // Concurrent path: dispatch without awaiting, then try to fill more slots
    if (CONCURRENT_JOB_TYPES.has(job.type)) {
      runConcurrentJob(job);
      await fillConcurrentSlots();
      return true;
    }

    // Sequential path for everything else
    await executeJob(job);

    // Rate limit delay to avoid overwhelming LLM providers
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

    return true;
  } finally {
    isProcessing = false;
  }
}

/**
 * Fire a concurrent-eligible job without awaiting it. Tracks per-type
 * in-flight count so each type respects its own concurrency limit.
 */
function runConcurrentJob(job: BackgroundJob): void {
  const limit = concurrencyFor(job.type);
  bumpInFlight(job.type, +1);

  executeJob(job).finally(() => {
    bumpInFlight(job.type, -1);
    // Proactively fill the freed slot instead of waiting for the next
    // interval tick (up to 2s idle otherwise).
    if (processorRunning) {
      fillConcurrentSlots().catch((error) => {
        logger.error('[JobQueue] Error back-filling concurrent slot', {
          type: job.type,
          error: getErrorMessage(error),
        });
      });
    }
  });
}

/**
 * Re-entrancy guard for fillConcurrentSlots. When many short jobs finish at
 * once, each runConcurrentJob's finally hook calls fillConcurrentSlots —
 * along with the startProcessor interval. Without this flag, multiple
 * fills run in parallel, each independently checking inFlight before any
 * of them increments it, and the per-type cap gets blown wide open
 * (observed: 166 MEMORY_EXTRACTION jobs running with cap=32). Serializing
 * the fill loop turns those concurrent claims into one ordered sequence.
 */
let fillingConcurrentSlots = false;

/**
 * Claim and dispatch concurrent-eligible jobs until at least one type's
 * slots are full, or no more jobs are available.
 *
 * Sequential jobs that get claimed during back-fill are executed inline
 * (the same way the original embedding back-fill behaved) so we don't
 * leave them indefinitely stranded.
 */
async function fillConcurrentSlots(): Promise<void> {
  if (fillingConcurrentSlots) {
    // Another fill is already in progress; it will pick up any newly-freed
    // slots when it next loops. Re-entering here would race the in-flight
    // counter and overshoot the cap.
    return;
  }
  fillingConcurrentSlots = true;

  try {
    const repos = getRepositories();

    // Bail when every concurrent type is at its cap.
    const anySlotOpen = (): boolean => {
      for (const type of CONCURRENT_JOB_TYPES) {
        if (inFlight(type) < concurrencyFor(type)) return true;
      }
      return false;
    };

    while (anySlotOpen()) {
      const job = await repos.backgroundJobs.claimNextJob();
      if (!job) break;

      logger.info('[JobQueue] Processing job', {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
      });

      if (CONCURRENT_JOB_TYPES.has(job.type)) {
        // If the claimed job's type is already at its cap, run it inline so
        // we don't violate the cap or strand the job.
        if (inFlight(job.type) >= concurrencyFor(job.type)) {
          await executeJob(job);
          await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
          continue;
        }
        runConcurrentJob(job);
        await new Promise((resolve) => setTimeout(resolve, CONCURRENT_CLAIM_DELAY));
      } else {
        // Sequential job — run it inline then stop filling.
        await executeJob(job);
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
        break;
      }
    }
  } finally {
    fillingConcurrentSlots = false;
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
 * Reset ALL orphaned PROCESSING jobs back to PENDING.
 * Called once on startup — no job can legitimately be mid-flight when
 * the server has just started.
 */
async function resetOrphanedJobs(): Promise<number> {
  const repos = getRepositories();
  return repos.backgroundJobs.resetAllProcessingJobs();
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
  embeddingInFlight: number;
  embeddingConcurrency: number;
  memoryExtractionInFlight: number;
  memoryExtractionConcurrency: number;
} {
  return {
    running: processorRunning,
    processing: isProcessing,
    embeddingInFlight: inFlight('EMBEDDING_GENERATE'),
    embeddingConcurrency: EMBEDDING_CONCURRENCY,
    memoryExtractionInFlight: inFlight('MEMORY_EXTRACTION'),
    memoryExtractionConcurrency: memoryExtractionConcurrencyOverride,
  };
}
