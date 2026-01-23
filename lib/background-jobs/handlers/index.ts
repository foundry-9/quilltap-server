/**
 * Background Job Handler Registry
 *
 * Maps job types to their handler functions.
 */

import { BackgroundJobType } from '@/lib/schemas/types';
import { handleMemoryExtraction } from './memory-extraction';
import { handleInterCharacterMemory } from './inter-character-memory';
import { handleContextSummary } from './context-summary';
import { handleTitleUpdate } from './title-update';

/**
 * Job handler function type
 */
export type JobHandler = (job: import('@/lib/schemas/types').BackgroundJob) => Promise<void>;

/**
 * Handler registry
 */
const handlers: Record<BackgroundJobType, JobHandler> = {
  MEMORY_EXTRACTION: handleMemoryExtraction,
  INTER_CHARACTER_MEMORY: handleInterCharacterMemory,
  CONTEXT_SUMMARY: handleContextSummary,
  TITLE_UPDATE: handleTitleUpdate,
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

// Re-export handlers
export { handleMemoryExtraction };
export { handleInterCharacterMemory };
export { handleContextSummary };
export { handleTitleUpdate };
