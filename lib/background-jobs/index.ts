/**
 * Background Jobs Module
 *
 * Provides a database-backed queue system for processing cheap LLM tasks
 * in the background, one at a time to avoid rate limiting.
 *
 * Memory extraction runs once per chat turn (not once per assistant
 * message); jobs are dedup'd at enqueue time on (chatId,
 * turnOpenerMessageId).
 */

// Queue service - enqueueing jobs
export {
  enqueueJob,
  enqueueMemoryExtraction,
  enqueueContextSummary,
  enqueueTitleUpdate,
  enqueueLLMLogCleanup,
  enqueueMemoryExtractionBatch,
  getJobStatus,
  getQueueStats,
  getActiveCountsByType,
  cancelJob,
  getPendingJobsForChat,
  cleanupOldJobs,
  type EnqueueJobOptions,
  type MemoryExtractionPayload,
  type ContextSummaryPayload,
  type TitleUpdatePayload,
  type LLMLogCleanupPayload,
} from './queue-service';

// Processor - processing jobs
export {
  startProcessor,
  stopProcessor,
  isProcessorRunning,
  processNextJob,
  processJobs,
  resetStuckJobs,
  ensureProcessorRunning,
  getProcessorStatus,
} from './processor';

// Handler types
export type { JobHandler } from './handlers';

// Scheduled cleanup
export {
  scheduleCleanup,
  stopCleanupScheduler,
  isCleanupSchedulerRunning,
  runScheduledCleanup,
  triggerUserCleanup,
} from './scheduled-cleanup';

// Scheduled danger scan
export {
  scheduleDangerScan,
  stopDangerScanScheduler,
  isDangerScanSchedulerRunning,
  runScheduledDangerScan,
} from './scheduled-danger-scan';
