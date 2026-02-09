/**
 * Embedding Reindex All Job Handler
 *
 * Handles EMBEDDING_REINDEX_ALL background jobs by:
 * 1. Marking all embedding statuses as PENDING
 * 2. Enqueuing individual EMBEDDING_GENERATE jobs for each memory
 *
 * This is triggered after:
 * - TF-IDF vocabulary refit (for BUILTIN provider)
 * - Embedding provider/model change
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { EmbeddingReindexAllPayload } from '../queue-service';
import { enqueueEmbeddingGenerate } from '../queue-service';

/**
 * Handle an embedding reindex all job
 */
export async function handleEmbeddingReindexAll(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingReindexAllPayload;
  const repos = getRepositories();

  logger.info('[EmbeddingReindexAll] Starting reindex', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
  });

  // Get the embedding profile
  const profile = await repos.embeddingProfiles.findById(payload.profileId);
  if (!profile) {
    throw new Error(`Embedding profile not found: ${payload.profileId}`);
  }

  // Get all characters for this user
  const characters = await repos.characters.findByUserId(job.userId);

  if (characters.length === 0) {
    logger.info('[EmbeddingReindexAll] No characters found, nothing to reindex', {
      context: 'handleEmbeddingReindexAll',
      jobId: job.id,
      profileId: payload.profileId,
    });
    return;
  }

  // Get all memories for all characters
  const allMemories: import('@/lib/schemas/types').Memory[] = [];
  for (const character of characters) {
    const characterMemories = await repos.memories.findByCharacterId(character.id);
    allMemories.push(...characterMemories);
  }

  if (allMemories.length === 0) {
    logger.info('[EmbeddingReindexAll] No memories found, nothing to reindex', {
      context: 'handleEmbeddingReindexAll',
      jobId: job.id,
      profileId: payload.profileId,
    });
    return;
  }

  // Mark all existing statuses as PENDING
  const markedCount = await repos.embeddingStatus.markAllPendingByProfileId(payload.profileId);

  // Create or update embedding status records for all memories
  // and enqueue generate jobs
  let enqueuedCount = 0;

  for (const memory of allMemories) {
    // Upsert status record
    await repos.embeddingStatus.upsertByEntity(
      'MEMORY',
      memory.id,
      payload.profileId,
      {
        userId: job.userId,
        status: 'PENDING',
        embeddedAt: null,
        error: null,
      }
    );

    // Enqueue generate job
    await enqueueEmbeddingGenerate(job.userId, {
      entityType: 'MEMORY',
      entityId: memory.id,
      characterId: memory.characterId,
      profileId: payload.profileId,
    });

    enqueuedCount++;
  }

  logger.info('[EmbeddingReindexAll] Reindex jobs enqueued', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
    totalMemories: allMemories.length,
    enqueuedCount,
  });
}
