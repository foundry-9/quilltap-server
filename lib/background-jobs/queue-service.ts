/**
 * Background Job Queue Service
 *
 * Provides functions to enqueue background jobs for processing.
 * Jobs are stored in MongoDB and processed by the job processor.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { BackgroundJobType } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import type { QueueStats } from '@/lib/database/repositories';
import { ensureProcessorRunning } from './processor';

/**
 * Options for creating a job
 */
export interface EnqueueJobOptions {
  /** Higher priority jobs are processed first (default: 0) */
  priority?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** When the job should become eligible to run (default: now) */
  scheduledAt?: Date;
}

/**
 * Payload for memory extraction job
 */
export interface MemoryExtractionPayload {
  chatId: string;
  characterId: string;
  characterName: string;
  userMessage: string;
  assistantMessage: string;
  sourceMessageId: string;
  connectionProfileId: string;
  /** @deprecated Use userCharacterId instead */
  personaId?: string;
  /** User character ID - who the memory is about (the user-controlled character) */
  userCharacterId?: string;
}

/**
 * Payload for inter-character memory extraction job
 */
export interface InterCharacterMemoryPayload {
  chatId: string;
  observerCharacterId: string;
  observerCharacterName: string;
  observerMessage: string;
  subjectCharacterId: string;
  subjectCharacterName: string;
  subjectMessage: string;
  sourceMessageId: string;
  connectionProfileId: string;
}

/**
 * Payload for context summary job
 */
export interface ContextSummaryPayload {
  chatId: string;
  connectionProfileId: string;
  forceRegenerate?: boolean;
}

/**
 * Payload for title update job
 */
export interface TitleUpdatePayload {
  chatId: string;
  connectionProfileId: string;
  currentInterchange: number;
}

/**
 * Payload for LLM log cleanup job
 */
export interface LLMLogCleanupPayload {
  userId: string;
  /** Optional: override the retention days from settings (for manual cleanup) */
  retentionDays?: number;
}

/**
 * Message pair for batch memory extraction
 */
export interface MessagePair {
  userMessageId: string;
  assistantMessageId: string;
  userContent: string;
  assistantContent: string;
}

/**
 * Enqueue a single background job
 */
export async function enqueueJob(
  userId: string,
  type: BackgroundJobType,
  payload: Record<string, unknown>,
  options?: EnqueueJobOptions
): Promise<string> {
  const repos = getRepositories();
  const now = new Date().toISOString();

  const job = await repos.backgroundJobs.create({
    userId,
    type,
    status: 'PENDING',
    payload,
    priority: options?.priority ?? 0,
    attempts: 0,
    maxAttempts: options?.maxAttempts ?? 3,
    lastError: null,
    scheduledAt: options?.scheduledAt?.toISOString() ?? now,
    startedAt: null,
    completedAt: null,
  });

  logger.info('Background job enqueued', { jobId: job.id, type, userId });

  // Auto-start the processor when a job is enqueued
  ensureProcessorRunning();

  return job.id;
}

/**
 * Enqueue a memory extraction job
 */
export async function enqueueMemoryExtraction(
  userId: string,
  payload: MemoryExtractionPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'MEMORY_EXTRACTION', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue an inter-character memory extraction job
 */
export async function enqueueInterCharacterMemory(
  userId: string,
  payload: InterCharacterMemoryPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'INTER_CHARACTER_MEMORY', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue a context summary job
 */
export async function enqueueContextSummary(
  userId: string,
  payload: ContextSummaryPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'CONTEXT_SUMMARY', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue a title update job
 */
export async function enqueueTitleUpdate(
  userId: string,
  payload: TitleUpdatePayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'TITLE_UPDATE', payload as unknown as Record<string, unknown>, options);
}

/**
 * Enqueue an LLM log cleanup job
 */
export async function enqueueLLMLogCleanup(
  userId: string,
  payload: LLMLogCleanupPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'LLM_LOG_CLEANUP', payload as unknown as Record<string, unknown>, options);
}

/**
 * Batch enqueue memory extraction jobs for an imported chat
 * Creates one job per message pair
 */
export async function enqueueMemoryExtractionBatch(
  userId: string,
  chatId: string,
  characterId: string,
  characterName: string,
  connectionProfileId: string,
  messagePairs: MessagePair[],
  options?: EnqueueJobOptions
): Promise<string[]> {
  if (messagePairs.length === 0) {
    return [];
  }

  const repos = getRepositories();
  const now = new Date().toISOString();

  const jobs = messagePairs.map((pair) => ({
    userId,
    type: 'MEMORY_EXTRACTION' as const,
    status: 'PENDING' as const,
    payload: {
      chatId,
      characterId,
      characterName,
      userMessage: pair.userContent,
      assistantMessage: pair.assistantContent,
      sourceMessageId: pair.assistantMessageId,
      connectionProfileId,
    },
    priority: options?.priority ?? 0,
    attempts: 0,
    maxAttempts: options?.maxAttempts ?? 3,
    lastError: null,
    scheduledAt: options?.scheduledAt?.toISOString() ?? now,
    startedAt: null,
    completedAt: null,
  }));

  const jobIds = await repos.backgroundJobs.createBatch(jobs);

  logger.info('Memory extraction batch enqueued', {
    chatId,
    characterId,
    jobCount: jobIds.length,
  });

  // Auto-start the processor when jobs are enqueued
  if (jobIds.length > 0) {
    ensureProcessorRunning();
  }

  return jobIds;
}

/**
 * Get the status of a job
 */
export async function getJobStatus(jobId: string) {
  const repos = getRepositories();
  return repos.backgroundJobs.findById(jobId);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(userId?: string): Promise<QueueStats> {
  const repos = getRepositories();
  return repos.backgroundJobs.getStats(userId);
}

/**
 * Cancel a pending job
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const repos = getRepositories();
  return repos.backgroundJobs.cancel(jobId);
}

/**
 * Get pending jobs for a chat
 */
export async function getPendingJobsForChat(chatId: string) {
  const repos = getRepositories();
  return repos.backgroundJobs.findPendingForChat(chatId);
}

/**
 * Cleanup old completed jobs
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  const repos = getRepositories();
  const olderThan = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return repos.backgroundJobs.cleanupOldJobs(olderThan);
}
