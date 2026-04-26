/**
 * Background Job Queue Service
 *
 * Provides functions to enqueue background jobs for processing.
 * Jobs are stored in the database and processed by the job processor.
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
  /** Character pronouns (JSON-serialised structure or null). */
  characterPronouns?: unknown;
  userMessage: string;
  assistantMessage: string;
  sourceMessageId: string;
  connectionProfileId: string;
  /** User character name (for "X says:" labelling in extraction prompts) */
  userCharacterName?: string;
  /** User character ID - who the memory is about (the user-controlled character) */
  userCharacterId?: string;
  /** All character names in a multi-character chat (for clear identity context) */
  allCharacterNames?: string[];
  /** Map of character name -> pronouns for multi-character chats */
  allCharacterPronouns?: Record<string, unknown>;
}

/**
 * Payload for inter-character memory extraction job
 */
export interface InterCharacterMemoryPayload {
  chatId: string;
  observerCharacterId: string;
  observerCharacterName: string;
  observerCharacterPronouns?: unknown;
  observerMessage: string;
  subjectCharacterId: string;
  subjectCharacterName: string;
  subjectCharacterPronouns?: unknown;
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
 * Payload for embedding generate job
 */
export interface EmbeddingGeneratePayload {
  /** Type of entity being embedded */
  entityType: 'MEMORY' | 'CONVERSATION_CHUNK' | 'HELP_DOC' | 'MOUNT_CHUNK';
  /** ID of the entity (memory ID, conversation chunk ID, or help doc ID) */
  entityId: string;
  /** ID of the character (for memories) */
  characterId?: string;
  /** ID of the embedding profile to use */
  profileId: string;
  /** Chat ID (for conversation chunks) */
  chatId?: string;
}

/**
 * Payload for embedding refit job (TF-IDF vocabulary rebuild)
 */
export interface EmbeddingRefitPayload {
  /** ID of the embedding profile */
  profileId: string;
  /** Whether to enqueue reindex jobs after refit */
  triggerReindex?: boolean;
}

/**
 * Payload for embedding reindex all job
 */
export interface EmbeddingReindexAllPayload {
  /** ID of the embedding profile */
  profileId: string;
}

/**
 * Payload for story background generation job
 */
export interface StoryBackgroundGenerationPayload {
  /** Chat ID to generate background for */
  chatId: string;
  /** Image profile ID to use for generation */
  imageProfileId: string;
  /** Character IDs participating in the chat */
  characterIds: string[];
  /** Optional scene context (e.g., chat title or summary) */
  sceneContext?: string;
  /** Optional project ID if the chat belongs to a project */
  projectId?: string | null;
}

/**
 * Payload for character avatar generation job
 */
export interface CharacterAvatarGenerationPayload {
  /** Chat ID where the outfit changed */
  chatId: string;
  /** Character ID to generate avatar for */
  characterId: string;
  /** Image profile ID to use for generation */
  imageProfileId: string;
}

/**
 * Payload for chat danger classification job
 */
export interface ChatDangerClassificationPayload {
  chatId: string;
  connectionProfileId: string;
}

/**
 * Result of enqueueing a chat danger classification job
 */
export interface ChatDangerClassificationEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Payload for conversation render job (Scriptorium)
 */
export interface ConversationRenderPayload {
  chatId: string;
  /** If true, embed all interchange chunks (not just the newest). Used for on-demand re-render. */
  fullReembed?: boolean;
}

/**
 * Result of enqueueing a conversation render job
 */
export interface ConversationRenderEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Payload for memory-housekeeping job.
 * Leave every field undefined to fall back to the per-user autoHousekeepingSettings.
 */
export interface MemoryHousekeepingPayload {
  /** Character to housekeep. If omitted, handler sweeps every character owned by userId. */
  characterId?: string;
  /** Override the per-character cap (otherwise uses the user's autoHousekeepingSettings). */
  maxMemories?: number;
  /** Override the merge-similar threshold. */
  mergeThreshold?: number;
  /** Override whether to merge semantically similar memories. */
  mergeSimilar?: boolean;
  /** Dry run — preview deletions without applying. Default false. */
  dryRun?: boolean;
  /** Why the job was enqueued (for debug logs). */
  reason?: 'watermark' | 'scheduled' | 'manual';
}

/**
 * Payload for scene state tracking job
 */
export interface SceneStateTrackingPayload {
  chatId: string;
  characterIds: string[];
  connectionProfileId: string;
}

/**
 * Result of enqueueing a scene state tracking job
 */
export interface SceneStateTrackingEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Enqueue a chat danger classification job
 * Skips if there's already a pending/processing job for the same chat
 */
export async function enqueueChatDangerClassification(
  userId: string,
  payload: ChatDangerClassificationPayload,
  options?: EnqueueJobOptions
): Promise<ChatDangerClassificationEnqueueResult> {
  const repos = getRepositories();

  // Check for existing pending/processing classification jobs for this chat
  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existingJob = pendingJobs.find(job => job.type === 'CHAT_DANGER_CLASSIFICATION');

  if (existingJob) {
    logger.info('[ChatDangerClassification] Reusing existing pending job for chat', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      existingJobId: existingJob.id,
      existingStatus: existingJob.status,
    });
    return { jobId: existingJob.id, isNew: false };
  }

  const jobId = await enqueueJob(userId, 'CHAT_DANGER_CLASSIFICATION', payload as unknown as Record<string, unknown>, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
  return { jobId, isNew: true };
}

/**
 * Enqueue a scene state tracking job
 * Skips if there's already a pending/processing job for the same chat
 */
export async function enqueueSceneStateTracking(
  userId: string,
  payload: SceneStateTrackingPayload,
  options?: EnqueueJobOptions
): Promise<SceneStateTrackingEnqueueResult> {
  const repos = getRepositories();

  // Check for existing pending/processing scene state jobs for this chat
  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existingJob = pendingJobs.find(job => job.type === 'SCENE_STATE_TRACKING');

  if (existingJob) {
    logger.info('[SceneStateTracking] Reusing existing pending job for chat', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      existingJobId: existingJob.id,
      existingStatus: existingJob.status,
    });
    return { jobId: existingJob.id, isNew: false };
  }

  const jobId = await enqueueJob(userId, 'SCENE_STATE_TRACKING', payload as unknown as Record<string, unknown>, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
  return { jobId, isNew: true };
}

/**
 * Enqueue a conversation render job (Scriptorium)
 * Skips if there's already a pending/processing job for the same chat
 */
export async function enqueueConversationRender(
  userId: string,
  payload: ConversationRenderPayload,
  options?: EnqueueJobOptions
): Promise<ConversationRenderEnqueueResult> {
  const repos = getRepositories();

  // Check for existing pending/processing render jobs for this chat
  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existingJob = pendingJobs.find(job => job.type === 'CONVERSATION_RENDER');

  if (existingJob) {
    logger.info('[ConversationRender] Reusing existing pending job for chat', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      existingJobId: existingJob.id,
      existingStatus: existingJob.status,
    });
    return { jobId: existingJob.id, isNew: false };
  }

  const jobId = await enqueueJob(userId, 'CONVERSATION_RENDER', payload as unknown as Record<string, unknown>, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
  return { jobId, isNew: true };
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
 * Enqueue a memory-housekeeping job for a character (or all characters of a user).
 *
 * Dedupes: if there's already a PENDING or PROCESSING MEMORY_HOUSEKEEPING job
 * for the same (userId, characterId) pair, this is a no-op returning the
 * existing job ID.
 */
export async function enqueueMemoryHousekeeping(
  userId: string,
  payload: MemoryHousekeepingPayload = {},
  options?: EnqueueJobOptions
): Promise<string> {
  const repos = getRepositories();

  // De-dupe against in-flight jobs for the same (userId, characterId)
  try {
    const pending = await repos.backgroundJobs.findByUserId(userId, 'PENDING');
    const processing = await repos.backgroundJobs.findByUserId(userId, 'PROCESSING');
    const existing = [...pending, ...processing].find(j => {
      if (j.type !== 'MEMORY_HOUSEKEEPING') return false;
      const existingCharId = (j.payload as Record<string, unknown>).characterId;
      return existingCharId === payload.characterId;
    });
    if (existing) {
      logger.debug('[Housekeeping] Skipping enqueue — job already in-flight', {
        jobId: existing.id,
        userId,
        characterId: payload.characterId ?? '(all)',
      });
      return existing.id;
    }
  } catch (error) {
    logger.warn('[Housekeeping] Failed to check for existing jobs during enqueue', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fall through to enqueue anyway — double work is better than none.
  }

  // Housekeeping is retry-hostile: each retry re-runs the whole sweep from
  // scratch, and a single sweep on a character with tens of thousands of
  // memories can burn minutes of main-thread time. The daily scheduler
  // re-enqueues anyway, so we cap attempts at 1 and let failures wait for
  // the next natural pass rather than thrashing.
  return enqueueJob(
    userId,
    'MEMORY_HOUSEKEEPING',
    payload as unknown as Record<string, unknown>,
    { ...options, maxAttempts: options?.maxAttempts ?? 1 },
  );
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
 * Result of enqueueing an embedding generate job
 */
export interface EmbeddingGenerateEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Default priorities for embedding entity types.
 * Chat-related embeddings (memories, conversation chunks) run before
 * batch operations (document mount chunks, help docs) so that chat
 * responsiveness is never blocked by background indexing.
 */
const EMBEDDING_ENTITY_PRIORITIES: Record<EmbeddingGeneratePayload['entityType'], number> = {
  MEMORY: 10,
  CONVERSATION_CHUNK: 10,
  HELP_DOC: 0,
  MOUNT_CHUNK: 0,
};

/**
 * Enqueue an embedding generate job
 * Skips if there's already a pending/processing job for the same entity.
 * Priority defaults based on entity type: chat-related types (MEMORY,
 * CONVERSATION_CHUNK) get higher priority than batch types.
 */
export async function enqueueEmbeddingGenerate(
  userId: string,
  payload: EmbeddingGeneratePayload,
  options?: EnqueueJobOptions
): Promise<EmbeddingGenerateEnqueueResult> {
  const repos = getRepositories();

  // Check for existing pending/processing embedding jobs for this entity
  const pendingJobs = await repos.backgroundJobs.findPendingForEntity(payload.entityId);
  const existingJob = pendingJobs.find(job => job.type === 'EMBEDDING_GENERATE');

  if (existingJob) {
    return { jobId: existingJob.id, isNew: false };
  }

  const priority = options?.priority ?? EMBEDDING_ENTITY_PRIORITIES[payload.entityType] ?? 0;
  const jobId = await enqueueJob(userId, 'EMBEDDING_GENERATE', payload as unknown as Record<string, unknown>, {
    ...options,
    priority,
  });
  return { jobId, isNew: true };
}

/**
 * Enqueue an embedding refit job (TF-IDF vocabulary rebuild)
 */
export async function enqueueEmbeddingRefit(
  userId: string,
  payload: EmbeddingRefitPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'EMBEDDING_REFIT', payload as unknown as Record<string, unknown>, {
    // Refit is lower priority than individual generates
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Enqueue an embedding reindex all job
 */
export async function enqueueEmbeddingReindexAll(
  userId: string,
  payload: EmbeddingReindexAllPayload,
  options?: EnqueueJobOptions
): Promise<string> {
  return enqueueJob(userId, 'EMBEDDING_REINDEX_ALL', payload as unknown as Record<string, unknown>, {
    // Reindex is lower priority
    priority: options?.priority ?? -1,
    ...options,
  });
}

/**
 * Result of enqueueing a story background job
 */
export interface StoryBackgroundEnqueueResult {
  jobId: string;
  isNew: boolean;
}

/**
 * Enqueue a story background generation job
 * Skips if there's already a pending/processing job for the same chat
 */
export async function enqueueStoryBackgroundGeneration(
  userId: string,
  payload: StoryBackgroundGenerationPayload,
  options?: EnqueueJobOptions
): Promise<StoryBackgroundEnqueueResult> {
  const repos = getRepositories();

  // Check for existing pending/processing story background jobs for this chat
  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existingJob = pendingJobs.find(job => job.type === 'STORY_BACKGROUND_GENERATION');

  if (existingJob) {
    logger.info('[StoryBackground] Reusing existing pending job for chat', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      existingJobId: existingJob.id,
      existingStatus: existingJob.status,
    });
    return { jobId: existingJob.id, isNew: false };
  }

  const jobId = await enqueueJob(userId, 'STORY_BACKGROUND_GENERATION', payload as unknown as Record<string, unknown>, {
    // Lower priority than interactive tasks
    priority: options?.priority ?? -1,
    ...options,
  });
  return { jobId, isNew: true };
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
 * Get active (PENDING + PROCESSING) job counts grouped by type
 */
export async function getActiveCountsByType(userId?: string): Promise<Record<string, number>> {
  const repos = getRepositories();
  return repos.backgroundJobs.getActiveCountsByType(userId);
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
 * Enqueue a character avatar generation job.
 * Skips if there's already a pending/processing avatar job for the same chat+character.
 */
export async function enqueueCharacterAvatarGeneration(
  userId: string,
  payload: CharacterAvatarGenerationPayload,
  options?: EnqueueJobOptions
): Promise<{ jobId: string; isNew: boolean }> {
  const repos = getRepositories();

  // Dedup: skip if there's already a pending/processing avatar job for this chat+character
  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existingJob = pendingJobs.find(
    job => job.type === 'CHARACTER_AVATAR_GENERATION'
      && (job.payload as unknown as CharacterAvatarGenerationPayload).characterId === payload.characterId
  );

  if (existingJob) {
    logger.info('[CharacterAvatar] Reusing existing pending job', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      characterId: payload.characterId,
      existingJobId: existingJob.id,
    });
    return { jobId: existingJob.id, isNew: false };
  }

  const jobId = await enqueueJob(
    userId,
    'CHARACTER_AVATAR_GENERATION',
    payload as unknown as Record<string, unknown>,
    options
  );

  logger.info('[CharacterAvatar] Avatar generation job enqueued', {
    context: 'background-jobs.queue',
    chatId: payload.chatId,
    characterId: payload.characterId,
    jobId,
  });

  return { jobId, isNew: true };
}

/**
 * Payload for wardrobe outfit announcement job
 */
export interface WardrobeOutfitAnnouncementPayload {
  /** Chat where the outfit change occurred */
  chatId: string;
  /** Character whose outfit changed */
  characterId: string;
}

/**
 * Debounce window for outfit announcements. Each new wardrobe change for the
 * same (chatId, characterId) pair pushes the existing pending job's
 * scheduledAt forward by this much, so a flurry of slot edits collapses into
 * a single announcement once the dust settles.
 */
const WARDROBE_ANNOUNCEMENT_DEBOUNCE_MS = 60_000;

/**
 * Enqueue a wardrobe outfit announcement job, debounced per (chatId, characterId).
 *
 * If a pending job already exists for this pair, its scheduledAt is pushed
 * forward by WARDROBE_ANNOUNCEMENT_DEBOUNCE_MS rather than enqueuing a duplicate.
 * The job, when it finally fires, reads the chat's current equipped outfit and
 * posts an Aurora system message visible to everyone in the chat.
 */
export async function enqueueWardrobeOutfitAnnouncement(
  userId: string,
  payload: WardrobeOutfitAnnouncementPayload,
): Promise<{ jobId: string; isNew: boolean }> {
  const repos = getRepositories();
  const scheduledAt = new Date(Date.now() + WARDROBE_ANNOUNCEMENT_DEBOUNCE_MS);

  const pendingJobs = await repos.backgroundJobs.findPendingForChat(payload.chatId);
  const existing = pendingJobs.find(
    job => job.type === 'WARDROBE_OUTFIT_ANNOUNCEMENT'
      && (job.payload as unknown as WardrobeOutfitAnnouncementPayload).characterId === payload.characterId
  );

  if (existing) {
    await repos.backgroundJobs.update(existing.id, { scheduledAt: scheduledAt.toISOString() });
    logger.info('[WardrobeAnnouncement] Rescheduled pending announcement', {
      context: 'background-jobs.queue',
      chatId: payload.chatId,
      characterId: payload.characterId,
      jobId: existing.id,
      newScheduledAt: scheduledAt.toISOString(),
    });
    return { jobId: existing.id, isNew: false };
  }

  const jobId = await enqueueJob(
    userId,
    'WARDROBE_OUTFIT_ANNOUNCEMENT',
    payload as unknown as Record<string, unknown>,
    { scheduledAt, priority: -1 }
  );

  logger.info('[WardrobeAnnouncement] Announcement job enqueued', {
    context: 'background-jobs.queue',
    chatId: payload.chatId,
    characterId: payload.characterId,
    jobId,
    scheduledAt: scheduledAt.toISOString(),
  });

  return { jobId, isNew: true };
}

/**
 * Cleanup old completed jobs
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  const repos = getRepositories();
  const olderThan = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return repos.backgroundJobs.cleanupOldJobs(olderThan);
}
