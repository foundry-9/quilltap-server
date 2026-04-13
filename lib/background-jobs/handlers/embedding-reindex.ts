/**
 * Embedding Reindex All Job Handler
 *
 * Handles EMBEDDING_REINDEX_ALL background jobs — a full embedding swap.
 * Re-embeds everything in the system:
 * 1. Help docs (first priority — needed for help search)
 * 2. Character memories
 * 3. Conversation chunks (Scriptorium)
 *
 * This is triggered after:
 * - TF-IDF vocabulary refit (for BUILTIN provider)
 * - Embedding provider/model change
 * - Manual reindex from the UI
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { EmbeddingReindexAllPayload } from '../queue-service';
import { ensureProcessorRunning } from '../processor';
import { syncHelpDocs } from '@/lib/help/help-doc-sync';
import { getVectorStoreManager } from '@/lib/embedding/vector-store';

/** Max jobs per batch insert (SQLite variable limit is 999; stay well under). */
const BATCH_SIZE = 200;

/**
 * Build a raw job record ready for batch insert.
 */
function buildJobRecord(
  userId: string,
  payload: Record<string, unknown>,
): Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString();
  return {
    userId,
    type: 'EMBEDDING_GENERATE',
    status: 'PENDING',
    payload,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    scheduledAt: now,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Handle an embedding reindex all job — full system-wide re-embedding
 */
export async function handleEmbeddingReindexAll(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingReindexAllPayload;
  const repos = getRepositories();

  logger.info('[EmbeddingReindexAll] Starting full system reindex', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
  });

  // Get the embedding profile
  const profile = await repos.embeddingProfiles.findById(payload.profileId);
  if (!profile) {
    throw new Error(`Embedding profile not found: ${payload.profileId}`);
  }

  // Cancel any stale EMBEDDING_GENERATE jobs from a previous run so they
  // don't compete with the fresh ones we're about to enqueue.
  const cancelledCount = await repos.backgroundJobs.cancelByType('EMBEDDING_GENERATE');
  if (cancelledCount > 0) {
    logger.info('[EmbeddingReindexAll] Cancelled stale embedding jobs', {
      context: 'handleEmbeddingReindexAll',
      cancelledCount,
    });
  }

  // Mark all existing statuses as PENDING
  const markedCount = await repos.embeddingStatus.markAllPendingByProfileId(payload.profileId);
  logger.debug('[EmbeddingReindexAll] Marked existing statuses as PENDING', {
    context: 'handleEmbeddingReindexAll',
    markedCount,
  });

  // Collect all job records, then batch-insert them at the end.
  const jobRecords: Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  let helpDocCount = 0;
  let memoryCount = 0;
  let chunkCount = 0;

  // ============================================================================
  // Phase 1: Help docs (highest priority — embed first)
  // ============================================================================
  try {
    // Sync help docs from disk to DB first
    const syncResult = await syncHelpDocs();
    logger.info('[EmbeddingReindexAll] Help docs synced from disk', {
      context: 'handleEmbeddingReindexAll',
      created: syncResult.created,
      updated: syncResult.updated,
      unchanged: syncResult.unchanged,
      totalOnDisk: syncResult.totalOnDisk,
    });

    // Get all help docs and enqueue embeddings
    const allHelpDocs = await repos.helpDocs.findAll();

    // Clear all help doc embeddings to force re-generation
    await repos.helpDocs.clearAllEmbeddings();

    for (const doc of allHelpDocs) {
      jobRecords.push(buildJobRecord(job.userId, {
        entityType: 'HELP_DOC',
        entityId: doc.id,
        profileId: payload.profileId,
      }));
      helpDocCount++;
    }
  } catch (error) {
    logger.error('[EmbeddingReindexAll] Failed to process help docs', {
      context: 'handleEmbeddingReindexAll',
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with memories and chunks even if help docs fail
  }

  // ============================================================================
  // Phase 2: Character memories
  // ============================================================================
  const characters = await repos.characters.findByUserId(job.userId);
  const vectorStoreManager = getVectorStoreManager();

  // Clear all character vector indices (entries + meta) so the dimension
  // constraint resets.  Without this, switching to an embedding model with
  // a different vector size (e.g. 1536 → 4096) will fail every job with
  // "Vector dimension mismatch".
  for (const character of characters) {
    await vectorStoreManager.deleteStore(character.id);
    logger.debug('[EmbeddingReindexAll] Cleared vector index for character', {
      context: 'handleEmbeddingReindexAll',
      characterId: character.id,
    });
  }

  for (const character of characters) {
    const characterMemories = await repos.memories.findByCharacterId(character.id);

    for (const memory of characterMemories) {
      jobRecords.push(buildJobRecord(job.userId, {
        entityType: 'MEMORY',
        entityId: memory.id,
        characterId: memory.characterId,
        profileId: payload.profileId,
      }));
      memoryCount++;
    }
  }

  // ============================================================================
  // Phase 3: Conversation chunks (Scriptorium)
  // ============================================================================
  try {
    const chats = await repos.chats.findByUserId(job.userId);

    for (const chat of chats) {
      const chunks = await repos.conversationChunks.findByChatId(chat.id);

      for (const chunk of chunks) {
        jobRecords.push(buildJobRecord(job.userId, {
          entityType: 'CONVERSATION_CHUNK',
          entityId: chunk.id,
          chatId: chat.id,
          profileId: payload.profileId,
        }));
        chunkCount++;
      }
    }
  } catch (error) {
    logger.error('[EmbeddingReindexAll] Failed to process conversation chunks', {
      context: 'handleEmbeddingReindexAll',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ============================================================================
  // Batch insert all jobs
  // ============================================================================
  const totalJobs = jobRecords.length;
  let inserted = 0;

  for (let i = 0; i < totalJobs; i += BATCH_SIZE) {
    const batch = jobRecords.slice(i, i + BATCH_SIZE);
    await repos.backgroundJobs.createBatch(batch);
    inserted += batch.length;

    if (inserted % 1000 === 0 || inserted === totalJobs) {
      logger.debug('[EmbeddingReindexAll] Batch insert progress', {
        context: 'handleEmbeddingReindexAll',
        inserted,
        total: totalJobs,
      });
    }
  }

  // Start the processor now that all jobs are enqueued
  ensureProcessorRunning();

  logger.info('[EmbeddingReindexAll] Full system reindex jobs enqueued', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
    helpDocCount,
    memoryCount,
    chunkCount,
    totalEnqueued: totalJobs,
  });
}
