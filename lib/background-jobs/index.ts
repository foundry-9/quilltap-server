/**
 * Background Jobs Module
 *
 * Provides a MongoDB-backed queue system for processing cheap LLM tasks
 * in the background, one at a time to avoid rate limiting.
 *
 * Usage:
 *
 * // Enqueue a memory extraction job
 * await enqueueMemoryExtraction(userId, {
 *   chatId: '...',
 *   characterId: '...',
 *   characterName: '...',
 *   userMessage: '...',
 *   assistantMessage: '...',
 *   sourceMessageId: '...',
 *   connectionProfileId: '...',
 * });
 *
 * // Or batch enqueue for imports
 * await enqueueMemoryExtractionBatch(userId, chatId, characterId, characterName, profileId, pairs);
 *
 * // Start the processor (usually done automatically)
 * startProcessor();
 *
 * // Check queue status
 * const stats = await getQueueStats(userId);
 */

// Queue service - enqueueing jobs
export {
  enqueueJob,
  enqueueMemoryExtraction,
  enqueueInterCharacterMemory,
  enqueueContextSummary,
  enqueueTitleUpdate,
  enqueueLLMLogCleanup,
  enqueueMemoryExtractionBatch,
  getJobStatus,
  getQueueStats,
  cancelJob,
  getPendingJobsForChat,
  cleanupOldJobs,
  type EnqueueJobOptions,
  type MemoryExtractionPayload,
  type InterCharacterMemoryPayload,
  type ContextSummaryPayload,
  type TitleUpdatePayload,
  type LLMLogCleanupPayload,
  type MessagePair,
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
