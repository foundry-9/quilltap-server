/**
 * Background Job Handler Registry
 *
 * Maps job types to their handler functions.
 */

import { BackgroundJob, BackgroundJobType } from '@/lib/schemas/types';
import { handleMemoryExtraction } from './memory-extraction';
import { logger } from '@/lib/logger';

/**
 * Job handler function type
 */
export type JobHandler = (job: BackgroundJob) => Promise<void>;

/**
 * Handler registry
 */
const handlers: Record<BackgroundJobType, JobHandler> = {
  MEMORY_EXTRACTION: handleMemoryExtraction,
  INTER_CHARACTER_MEMORY: handleInterCharacterMemoryPlaceholder,
  CONTEXT_SUMMARY: handleContextSummaryPlaceholder,
  TITLE_UPDATE: handleTitleUpdatePlaceholder,
};

/**
 * Get the handler for a job type
 */
export function getHandler(type: BackgroundJobType): JobHandler {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`No handler registered for job type: ${type}`);
  }
  return handler;
}

/**
 * Placeholder handler for inter-character memory (to be implemented)
 */
async function handleInterCharacterMemoryPlaceholder(job: BackgroundJob): Promise<void> {
  logger.warn('[JobHandler] Inter-character memory handler not yet implemented', {
    jobId: job.id,
  });
  // For now, just log and complete - will be implemented in future
}

/**
 * Placeholder handler for context summary (to be implemented)
 */
async function handleContextSummaryPlaceholder(job: BackgroundJob): Promise<void> {
  logger.warn('[JobHandler] Context summary handler not yet implemented', {
    jobId: job.id,
  });
  // For now, just log and complete - will be implemented in future
}

/**
 * Placeholder handler for title update (to be implemented)
 */
async function handleTitleUpdatePlaceholder(job: BackgroundJob): Promise<void> {
  logger.warn('[JobHandler] Title update handler not yet implemented', {
    jobId: job.id,
  });
  // For now, just log and complete - will be implemented in future
}

// Re-export handlers
export { handleMemoryExtraction };
