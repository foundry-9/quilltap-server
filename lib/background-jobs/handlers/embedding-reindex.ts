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
import { enqueueEmbeddingGenerate } from '../queue-service';
import { syncHelpDocs } from '@/lib/help/help-doc-sync';

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

  // Mark all existing statuses as PENDING
  const markedCount = await repos.embeddingStatus.markAllPendingByProfileId(payload.profileId);
  logger.debug('[EmbeddingReindexAll] Marked existing statuses as PENDING', {
    context: 'handleEmbeddingReindexAll',
    markedCount,
  });

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
      await repos.embeddingStatus.upsertByEntity(
        'HELP_DOC',
        doc.id,
        payload.profileId,
        {
          userId: job.userId,
          status: 'PENDING',
          embeddedAt: null,
          error: null,
        }
      );

      await enqueueEmbeddingGenerate(job.userId, {
        entityType: 'HELP_DOC',
        entityId: doc.id,
        profileId: payload.profileId,
      });

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

  for (const character of characters) {
    const characterMemories = await repos.memories.findByCharacterId(character.id);

    for (const memory of characterMemories) {
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

      await enqueueEmbeddingGenerate(job.userId, {
        entityType: 'MEMORY',
        entityId: memory.id,
        characterId: memory.characterId,
        profileId: payload.profileId,
      });

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
        await repos.embeddingStatus.upsertByEntity(
          'CONVERSATION_CHUNK',
          chunk.id,
          payload.profileId,
          {
            userId: job.userId,
            status: 'PENDING',
            embeddedAt: null,
            error: null,
          }
        );

        await enqueueEmbeddingGenerate(job.userId, {
          entityType: 'CONVERSATION_CHUNK',
          entityId: chunk.id,
          chatId: chat.id,
          profileId: payload.profileId,
        });

        chunkCount++;
      }
    }
  } catch (error) {
    logger.error('[EmbeddingReindexAll] Failed to process conversation chunks', {
      context: 'handleEmbeddingReindexAll',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('[EmbeddingReindexAll] Full system reindex jobs enqueued', {
    context: 'handleEmbeddingReindexAll',
    jobId: job.id,
    profileId: payload.profileId,
    helpDocCount,
    memoryCount,
    chunkCount,
    totalEnqueued: helpDocCount + memoryCount + chunkCount,
  });
}
